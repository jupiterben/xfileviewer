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

fn scan_dir_files(
    dir: &str,
    mut emit: impl FnMut(ScanBatch) -> Result<(), String>,
) -> Result<(), String> {
    let mut found = 0;
    let mut scanned = 0;
    let mut system_files = 0;
    let mut non_files = 0;
    let mut last_progress = std::time::Instant::now();
    eprintln!("[list_dir_files] starting dir={dir:?}");
    emit(ScanBatch {
        files: Vec::new(),
        scanned: 0,
        done: false,
    })?;
    for entry in directory::read_dir(dir).map_err(|err| scan_io_error("打开目录", dir, err))? {
        if last_progress.elapsed() >= std::time::Duration::from_millis(250) {
            emit(ScanBatch {
                files: Vec::new(),
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
            emit(ScanBatch {
                files: vec![path.to_string_lossy().into_owned()],
                scanned,
                done: false,
            })?;
            found += 1;
        } else {
            non_files += 1;
        }
    }
    eprintln!(
        "[list_dir_files] dir={dir:?}, scanned={scanned}, files={}, system_files={system_files}, non_files={non_files}",
        found
    );
    emit(ScanBatch {
        files: Vec::new(),
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
            assert!(!discoveries[0].done);
            assert_eq!(
                discoveries[0].files,
                vec![root.join("正常视频.mp4").to_string_lossy().into_owned()]
            );
            assert_eq!(
                directory::read_dir(root.join("folder.mp4").to_str().unwrap())
                    .unwrap()
                    .count(),
                0
            );
            assert!(directory::read_dir(root.join("missing").to_str().unwrap()).is_err());
        };
        // Only this test's uniquely created temporary fixture is removed.
        let outcome = std::panic::catch_unwind(result);
        fs::remove_file(root.join("正常视频.mp4")).unwrap();
        fs::remove_file(root.join("._正常视频.mp4")).unwrap();
        fs::remove_dir(root.join("folder.mp4")).unwrap();
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
            assert!(batch.files.len() <= 1);
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
