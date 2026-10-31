use crate::directory;
use serde::Serialize;
use std::path::Path;

#[tauri::command]
pub(crate) fn parent_dir(path: String) -> Result<String, String> {
    Path::new(&path)
        .parent()
        .map(|dir| dir.to_string_lossy().into_owned())
        .ok_or_else(|| "path has no parent directory".into())
}

#[tauri::command]
pub(crate) async fn list_dir_files(
    dir: String,
    on_batch: tauri::ipc::Channel<ScanBatch>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        scan_dir_files(&dir, |batch| {
            on_batch
                .send(batch)
                .map_err(|err| format!("[发送扫描消息] {err}"))
        })
    })
    .await
    .map_err(|err| format!("目录扫描失败：{err}"))?
}

#[derive(Clone, Serialize)]
pub(crate) struct ScanBatch {
    files: Vec<String>,
    directories: Vec<String>,
    scanned: usize,
    done: bool,
}

fn scan_io_error(stage: &str, path: &str, err: std::io::Error) -> String {
    let code = err
        .raw_os_error()
        .map(|code| format!("0x{:08X}", code as u32))
        .unwrap_or_else(|| "无系统错误码".into());
    // ERROR_DIRECTORY (267) on a mapped network drive is usually a transient
    // SMB failure (session renegotiation, redirector hiccup) rather than a bad
    // path — the same path typically opens again moments later.
    let hint = if err.raw_os_error() == Some(267) {
        "；目录位于网络驱动器时多为瞬时故障，可稍后重试"
    } else {
        ""
    };
    let message = format!("[{stage}] {path}：{err}（{code}）{hint}");
    eprintln!("[list_dir_files] {message}");
    message
}

/// Files per IPC batch. One channel message per file floods the webview on
/// large folders; 50 keeps latency low while cutting message count ~50x.
const BATCH_SIZE: usize = 50;

fn scan_dir_files(
    dir: &str,
    mut emit: impl FnMut(ScanBatch) -> Result<(), String>,
) -> Result<(), String> {
    let mut found = 0;
    let mut scanned = 0;
    let mut system_files = 0;
    let mut non_files = 0;
    let mut pending: Vec<String> = Vec::new();
    let mut directories: Vec<String> = Vec::new();
    let mut last_progress = std::time::Instant::now();
    eprintln!("[list_dir_files] starting dir={dir:?}");
    emit(ScanBatch {
        files: Vec::new(),
        directories: Vec::new(),
        scanned: 0,
        done: false,
    })?;
    for entry in directory::read_dir(dir).map_err(|err| scan_io_error("打开目录", dir, err))? {
        // Flush on batch size or a 250ms heartbeat, whichever comes first —
        // the heartbeat keeps the "scanned" counter moving on slow drives.
        if pending.len() + directories.len() >= BATCH_SIZE
            || last_progress.elapsed() >= std::time::Duration::from_millis(250)
        {
            emit(ScanBatch {
                files: std::mem::take(&mut pending),
                directories: std::mem::take(&mut directories),
                scanned,
                done: false,
            })?;
            last_progress = std::time::Instant::now();
        }
        let entry = entry.map_err(|err| scan_io_error("枚举目录条目", dir, err))?;
        scanned += 1;
        let name = &entry.name;
        let name = name.to_string_lossy();
        // AppleDouble sidecars retain the media extension but contain metadata.
        if name.starts_with("._")
            || name.eq_ignore_ascii_case(".DS_Store")
            || name.eq_ignore_ascii_case("Thumbs.db")
            || name.eq_ignore_ascii_case("ehthumbs.db")
            || name.eq_ignore_ascii_case("desktop.ini")
        {
            system_files += 1;
            continue;
        }
        let path = entry.path;
        if entry.is_file {
            pending.push(path.to_string_lossy().into_owned());
            found += 1;
        } else if entry.is_dir {
            directories.push(path.to_string_lossy().into_owned());
        } else {
            non_files += 1;
        }
    }
    eprintln!(
        "[list_dir_files] dir={dir:?}, scanned={scanned}, files={}, system_files={system_files}, non_files={non_files}",
        found
    );
    // The final batch carries whatever is still pending, so no discovery is
    // ever lost between the last flush and completion.
    emit(ScanBatch {
        files: pending,
        directories,
        scanned,
        done: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn directory_scan_streams_files_and_filters_system_entries() {
        let root = std::env::temp_dir().join(format!(
            "xfileviewer-scan-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        fs::write(root.join("正常视频.mp4"), b"test").unwrap();
        fs::write(root.join("._正常视频.mp4"), b"metadata").unwrap();
        fs::create_dir(root.join("folder.mp4")).unwrap();
        let nested_file = root.join("folder.mp4").join("nested.mp4");
        fs::write(&nested_file, b"nested").unwrap();
        let result = || {
            let mut batches = Vec::new();
            scan_dir_files(root.to_str().unwrap(), |batch| {
                batches.push(batch);
                Ok(())
            })
            .unwrap();
            assert!(batches.last().unwrap().done);
            assert_eq!(batches.last().unwrap().scanned, 3);
            let discoveries: Vec<_> = batches
                .iter()
                .filter(|batch| !batch.files.is_empty())
                .collect();
            assert_eq!(discoveries.len(), 1);
            // A lone discovery rides the final done batch; no separate
            // per-file message is emitted.
            assert!(discoveries[0].done);
            assert_eq!(
                discoveries[0].files,
                vec![root.join("正常视频.mp4").to_string_lossy().into_owned()]
            );
            let directories: Vec<_> = batches
                .iter()
                .flat_map(|batch| batch.directories.iter().cloned())
                .collect();
            assert_eq!(
                directories,
                vec![root.join("folder.mp4").to_string_lossy().into_owned()]
            );
            let nested_path = nested_file.to_string_lossy().into_owned();
            assert!(batches
                .iter()
                .all(|batch| !batch.files.contains(&nested_path)));
            assert_eq!(
                directory::read_dir(root.join("folder.mp4").to_str().unwrap())
                    .unwrap()
                    .count(),
                1
            );
            assert!(directory::read_dir(root.join("missing").to_str().unwrap()).is_err());
        };
        // Only this test's uniquely created temporary fixture is removed.
        let outcome = std::panic::catch_unwind(result);
        fs::remove_file(root.join("正常视频.mp4")).unwrap();
        fs::remove_file(root.join("._正常视频.mp4")).unwrap();
        fs::remove_file(&nested_file).unwrap();
        fs::remove_dir(root.join("folder.mp4")).unwrap();
        fs::remove_dir(&root).unwrap();
        if let Err(panic) = outcome {
            std::panic::resume_unwind(panic);
        }
    }

    #[test]
    fn directory_scan_batches_large_folders() {
        let root = std::env::temp_dir().join(format!(
            "xfileviewer-scan-batch-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        let count = BATCH_SIZE * 2 + 7;
        for i in 0..count {
            fs::write(root.join(format!("clip{i:04}.mp4")), b"test").unwrap();
        }
        let mut total = 0usize;
        let mut batches = 0usize;
        let result = || {
            scan_dir_files(root.to_str().unwrap(), |batch| {
                if !batch.files.is_empty() {
                    batches += 1;
                    assert!(
                        batch.files.len() <= BATCH_SIZE,
                        "batch {} exceeds the cap",
                        batch.files.len()
                    );
                }
                for file in &batch.files {
                    assert!(file.ends_with(".mp4"));
                    total += 1;
                }
                if batch.done {
                    // All files must have been flushed by the final batch.
                    assert_eq!(total, count);
                }
                Ok(())
            })
            .unwrap();
        };
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(result));
        for i in 0..count {
            fs::remove_file(root.join(format!("clip{i:04}.mp4"))).unwrap();
        }
        fs::remove_dir(&root).unwrap();
        if let Err(panic) = outcome {
            std::panic::resume_unwind(panic);
        }
        // 257 files must batch down to a handful of messages, not 257.
        assert!(batches <= 8, "expected batching, got {batches} batches");
    }

    #[test]
    fn directory_scan_batches_mixed_files_and_directories() {
        let root = std::env::temp_dir().join(format!(
            "xfileviewer-scan-mixed-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        let count = BATCH_SIZE + 7;
        let mut expected_files = Vec::new();
        let mut expected_directories = Vec::new();
        for i in 0..count {
            let file = root.join(format!("clip{i:04}.mp4"));
            let dir = root.join(format!("folder{i:04}"));
            fs::write(&file, b"test").unwrap();
            fs::create_dir(&dir).unwrap();
            expected_files.push(file.to_string_lossy().into_owned());
            expected_directories.push(dir.to_string_lossy().into_owned());
        }
        let result = || {
            let mut batches = Vec::new();
            scan_dir_files(root.to_str().unwrap(), |batch| {
                batches.push(batch);
                Ok(())
            })
            .unwrap();
            assert!(batches.last().unwrap().done);
            assert_eq!(batches.last().unwrap().scanned, count * 2);
            assert_eq!(batches.iter().filter(|batch| batch.done).count(), 1);
            let mut files = Vec::new();
            let mut directories = Vec::new();
            for batch in &batches {
                let size = batch.files.len() + batch.directories.len();
                assert!(size <= BATCH_SIZE, "batch {size} exceeds the cap");
                files.extend(batch.files.iter().cloned());
                directories.extend(batch.directories.iter().cloned());
            }
            files.sort();
            directories.sort();
            assert_eq!(files, expected_files);
            assert_eq!(directories, expected_directories);
        };
        let outcome = std::panic::catch_unwind(result);
        for i in 0..count {
            fs::remove_file(root.join(format!("clip{i:04}.mp4"))).unwrap();
            fs::remove_dir(root.join(format!("folder{i:04}"))).unwrap();
        }
        fs::remove_dir(&root).unwrap();
        if let Err(panic) = outcome {
            std::panic::resume_unwind(panic);
        }
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn directory_scan_excludes_directory_symlinks() {
        let root = std::env::temp_dir().join(format!(
            "xfileviewer-scan-symlink-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        let target = root.join("folder");
        let link = root.join("linked-folder");
        let file = root.join("clip.mp4");
        let nested_file = target.join("nested.mp4");
        fs::create_dir(&target).unwrap();
        fs::write(&file, b"test").unwrap();
        fs::write(&nested_file, b"nested").unwrap();
        let mut link_created = false;
        let result = || {
            #[cfg(unix)]
            std::os::unix::fs::symlink(&target, &link).unwrap();
            #[cfg(windows)]
            match std::os::windows::fs::symlink_dir(&target, &link) {
                Ok(()) => {}
                Err(err)
                    if err.kind() == std::io::ErrorKind::PermissionDenied
                        || err.raw_os_error() == Some(1314) =>
                {
                    eprintln!(
                        "SKIPPED directory_scan_excludes_directory_symlinks: symlink permission unavailable: {err}"
                    );
                    return;
                }
                Err(err) => panic!("failed to create directory symlink: {err}"),
            }
            link_created = true;
            assert!(fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
            let mut batches = Vec::new();
            scan_dir_files(root.to_str().unwrap(), |batch| {
                batches.push(batch);
                Ok(())
            })
            .unwrap();
            assert!(batches.last().unwrap().done);
            assert_eq!(batches.last().unwrap().scanned, 3);
            let files: Vec<_> = batches
                .iter()
                .flat_map(|batch| batch.files.iter().cloned())
                .collect();
            let directories: Vec<_> = batches
                .iter()
                .flat_map(|batch| batch.directories.iter().cloned())
                .collect();
            assert!(!directories.contains(&link.to_string_lossy().into_owned()));
            assert_eq!(files, vec![file.to_string_lossy().into_owned()]);
            assert_eq!(directories, vec![target.to_string_lossy().into_owned()]);
        };
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(result));
        if link_created {
            #[cfg(unix)]
            fs::remove_file(&link).unwrap();
            #[cfg(windows)]
            fs::remove_dir(&link).unwrap();
        }
        fs::remove_file(&nested_file).unwrap();
        fs::remove_file(&file).unwrap();
        fs::remove_dir(&target).unwrap();
        fs::remove_dir(&root).unwrap();
        if let Err(panic) = outcome {
            std::panic::resume_unwind(panic);
        }
    }

    #[test]
    #[ignore = "Requires an explicitly supplied SMB directory"]
    fn directory_scan_network_probe() {
        let dir = std::env::var("XFILEVIEWER_TEST_DIR").expect("set XFILEVIEWER_TEST_DIR");
        let mut discovered = 0;
        let mut completed = false;
        let mut seen = std::collections::HashSet::new();
        scan_dir_files(&dir, |batch| {
            assert!(batch.files.len() + batch.directories.len() <= BATCH_SIZE);
            for file in batch.files {
                assert!(seen.insert(file));
                discovered += 1;
            }
            if batch.done {
                completed = true;
                println!(
                    "NETWORK SCAN OK: scanned={}, emitted={discovered}",
                    batch.scanned
                );
            }
            Ok(())
        })
        .unwrap();
        assert!(completed);
        assert!(discovered > 1);
    }
}
