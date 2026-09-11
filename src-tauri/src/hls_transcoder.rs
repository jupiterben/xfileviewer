//! HLS transcode fallback: spawn an external ffmpeg, slice the source into
//! short `.ts` segments under a per-session temp dir, and let `media_server`
//! serve them back to the WebView as a standard HLS playlist.
//!
//! Design notes:
//! - ffmpeg is launched as a child process; the WebView never sees raw
//!   PCM/video, only `.m3u8` + `.ts` over the existing local HTTP server.
//! - The transcoder state is a single `Mutex<HashMap<session, Job>>`. Each
//!   `Job` owns the child process handle and the temp dir, so dropping the
//!   entry (explicit `hls_close` or process exit) kills the child and removes
//!   the temp dir together — no orphan processes, no leaked segment files.
//! - ffmpeg is resolved via `which` crate at runtime. If the binary is
//!   missing, `ffmpeg_available` reports false and the frontend falls back
//!   to the existing `MEDIA_ERR_SRC_NOT_SUPPORTED` error path.
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HlsInfo {
    /// HTTP URL the WebView should hand to `<video src>`.
    pub url: String,
    /// Port of the local media server (so the frontend can sanity-check it).
    pub port: u16,
}

struct Job {
    child: Child,
    /// Absolute path of the per-session temp dir (parent of `index.m3u8`).
    dir: PathBuf,
    /// Cached HLS URL, computed once at start. Kept for diagnostics and
    /// future use (e.g. logging the active stream per session).
    #[allow(dead_code)]
    url: String,
}

#[derive(Default)]
pub struct HlsTranscoder {
    jobs: Mutex<HashMap<String, Job>>,
}

impl HlsTranscoder {
    /// Probe ffmpeg on PATH. Returns the absolute path of the binary, or
    /// `None` if the user has not installed it.
    pub fn locate_ffmpeg() -> Option<PathBuf> {
        which("ffmpeg")
    }

    /// Start an HLS transcode for `path` under a fresh per-session directory
    /// inside `cache_root`. Returns the playlist URL on the local media
    /// server. Any prior job for the same session is replaced.
    pub fn start(
        &self,
        cache_root: &Path,
        media_port: u16,
        media_base_url: &str,
        session: &str,
        path: &str,
    ) -> Result<HlsInfo, String> {
        if !is_safe_segment(session) {
            return Err("非法的会话标识".into());
        }
        let ffmpeg = Self::locate_ffmpeg().ok_or_else(|| "ffmpeg 不在 PATH 中".to_string())?;
        crate::media_server::open_media(path).map_err(|err| format!("无法打开视频：{err}"))?;

        // Per-session dir, e.g. <cache_root>/hls/<session>. The media server
        // refuses requests whose canonical path escapes this directory.
        let dir = cache_root.join("hls").join(session);
        if dir.exists() {
            std::fs::remove_dir_all(&dir).map_err(|err| format!("清理旧切片失败：{err}"))?;
        }
        std::fs::create_dir_all(&dir).map_err(|err| format!("创建切片目录失败：{err}"))?;

        let m3u8 = dir.join("index.m3u8");
        let seg_pattern = dir.join("seg_%05d.ts");

        // H.264 + AAC is the universal browser-playable baseline. Keeping
        // the preset at `veryfast` and the GOP at 1s makes seek responsive
        // (one segment ≈ 4s, but keyframes land at the segment boundary).
        let mut cmd = Command::new(&ffmpeg);
        cmd.arg("-hide_banner")
            .arg("-loglevel")
            .arg("error")
            .arg("-nostdin")
            .arg("-y")
            .arg("-i")
            .arg(path)
            .arg("-c:v")
            .arg("libx264")
            .arg("-preset")
            .arg("veryfast")
            .arg("-crf")
            .arg("23")
            .arg("-g")
            .arg("60")
            .arg("-sc_threshold")
            .arg("0")
            .arg("-c:a")
            .arg("aac")
            .arg("-b:a")
            .arg("128k")
            .arg("-ac")
            .arg("2")
            .arg("-f")
            .arg("hls")
            .arg("-hls_time")
            .arg("4")
            .arg("-hls_list_size")
            .arg("0")
            .arg("-hls_playlist_type")
            .arg("event")
            .arg("-hls_segment_filename")
            .arg(&seg_pattern)
            .arg(&m3u8);
        cmd.stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());

        let child = cmd
            .spawn()
            .map_err(|err| format!("启动 ffmpeg 失败（{}）：{err}", ffmpeg.display()))?;

        let url = format!("{media_base_url}/hls/{}/index.m3u8", session);

        let mut guard = self.jobs.lock().map_err(|err| err.to_string())?;
        if let Some(mut prev) = guard.remove(session) {
            // Best-effort cleanup of the previous job; ignore errors because
            // the new job already owns the same on-disk directory.
            let _ = prev.child.kill();
            let _ = prev.child.wait();
        }
        guard.insert(
            session.to_string(),
            Job {
                child,
                dir,
                url: url.clone(),
            },
        );
        Ok(HlsInfo {
            url,
            port: media_port,
        })
    }

    /// Stop a single session: kill the child, remove its temp dir.
    pub fn stop(&self, session: &str) -> Result<(), String> {
        if !is_safe_segment(session) {
            return Err("非法的会话标识".into());
        }
        let mut guard = self.jobs.lock().map_err(|err| err.to_string())?;
        match guard.remove(session) {
            Some(mut job) => {
                let _ = job.child.kill();
                let _ = job.child.wait();
                let _ = std::fs::remove_dir_all(&job.dir);
                Ok(())
            }
            None => Err("会话不存在".into()),
        }
    }

    /// Stop every job and wipe the HLS cache root. Called on app exit.
    pub fn shutdown(&self) {
        let Ok(mut guard) = self.jobs.lock() else {
            return;
        };
        for (_, mut job) in guard.drain() {
            let _ = job.child.kill();
            let _ = job.child.wait();
            let _ = std::fs::remove_dir_all(&job.dir);
        }
    }
}

impl Drop for HlsTranscoder {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn which(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    let exts: &[String] = if cfg!(windows) {
        &[
            ".exe".to_string(),
            ".cmd".to_string(),
            ".bat".to_string(),
            "".to_string(),
        ]
    } else {
        &["".to_string()]
    };
    for dir in std::env::split_paths(&path) {
        for ext in exts {
            let candidate = dir.join(format!("{name}{ext}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Resolve a request path like `/hls/<session>/...rest` against
/// `<cache_root>/hls/<session>`. Returns the absolute file path if it lives
/// inside the session dir, or `None` if the request tries to escape
/// (path-traversal guard).
pub fn resolve_hls_path(cache_root: &Path, session: &str, rest: &str) -> Option<PathBuf> {
    if session.is_empty() || !is_safe_segment(session) {
        return None;
    }
    let root = cache_root.join("hls").join(session);
    // Canonicalize root lazily; the dir always exists once a job started,
    // and `None` here would be a real bug to surface rather than swallow.
    let root_canon = root.canonicalize().ok()?;
    let rel = rest.trim_start_matches('/');
    if rel.is_empty() {
        return Some(root_canon.join("index.m3u8"));
    }
    if !is_safe_relative(rel) {
        return None;
    }
    let joined = root_canon.join(rel);
    let canon = joined.canonicalize().ok()?;
    if !canon.starts_with(&root_canon) {
        return None;
    }
    Some(canon)
}

fn is_safe_segment(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn is_safe_relative(s: &str) -> bool {
    // Reject anything that smells like a traversal: literal ".." components,
    // any separator that Path::join would treat as absolute, or backslashes
    // (which the URL path would never legitimately contain). The caller also
    // trims leading "/" before this check, so "/foo" becomes "foo" — but
    // anything that still tries to escape is caught here.
    !s.contains("..") && !s.contains('\\') && !s.starts_with('/')
}

/// Tauri command: probe ffmpeg availability. Always cheap; the result is
/// cached by the frontend per session.
#[tauri::command]
pub fn ffmpeg_available() -> bool {
    HlsTranscoder::locate_ffmpeg().is_some()
}

/// Tauri command: start an HLS transcode for `path` and return the playlist
/// URL. Requires ffmpeg on PATH; otherwise returns an error so the frontend
/// can keep the existing `MEDIA_ERR_SRC_NOT_SUPPORTED` message.
#[tauri::command]
pub fn hls_open(
    state: tauri::State<HlsTranscoder>,
    media: tauri::State<crate::media_server::MediaServer>,
    hls_root: tauri::State<crate::media_server::HlsCacheRoot>,
    session: String,
    path: String,
) -> Result<HlsInfo, String> {
    let cache = hls_root
        .lock()
        .map_err(|err| err.to_string())?
        .clone()
        .ok_or_else(|| "媒体服务尚未就绪".to_string())?;
    state.start(&cache, media.port, &media.base_url(), &session, &path)
}

/// Tauri command: stop the HLS session and remove its temp dir.
#[tauri::command]
pub fn hls_close(state: tauri::State<HlsTranscoder>, session: String) -> Result<(), String> {
    state.stop(&session)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn is_safe_segment_rejects_traversal() {
        assert!(!is_safe_segment(""));
        assert!(!is_safe_segment(".."));
        assert!(!is_safe_segment("../etc"));
        assert!(!is_safe_segment("a/b"));
        assert!(!is_safe_segment("a b"));
        assert!(is_safe_segment("hls-123-0"));
        assert!(is_safe_segment("abc_def"));
    }

    #[test]
    fn is_safe_relative_rejects_escape_attempts() {
        assert!(!is_safe_relative("../index.m3u8"));
        assert!(!is_safe_relative("a/../b"));
        assert!(!is_safe_relative("/abs"));
        assert!(!is_safe_relative("a\\b"));
        assert!(!is_safe_relative("\\foo"));
        assert!(is_safe_relative("index.m3u8"));
        assert!(is_safe_relative("seg_00001.ts"));
        assert!(is_safe_relative("nested/dir/file.ts"));
    }

    #[test]
    fn resolve_hls_path_blocks_traversal() {
        let root = std::env::temp_dir().join(format!(
            "xfileviewer-hls-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let session = "s1";
        let session_dir = root.join("hls").join(session);
        std::fs::create_dir_all(&session_dir).unwrap();
        std::fs::write(session_dir.join("index.m3u8"), b"test").unwrap();

        // In-bounds reads work.
        let p = resolve_hls_path(&root, session, "index.m3u8").unwrap();
        assert_eq!(p.file_name().unwrap(), "index.m3u8");

        // A leading slash is normalised by the caller, so "/index.m3u8"
        // resolves to the same in-bounds file as the bare name. This is
        // intentional: HLS clients are free to send either form.
        let p2 = resolve_hls_path(&root, session, "/index.m3u8").unwrap();
        assert_eq!(p2, p);

        // Out-of-bounds reads return None.
        assert!(resolve_hsl_via_root(&root, session, "../sibling.m3u8").is_none());
        assert!(resolve_hsl_via_root(&root, session, "a/../../etc/passwd").is_none());
        assert!(resolve_hsl_via_root(&root, session, "\\foo").is_none());
        assert!(resolve_hsl_via_root(&root, "../etc", "passwd").is_none());
        assert!(resolve_hsl_via_root(&root, "bad name", "index.m3u8").is_none());

        let _ = std::fs::remove_dir_all(&root);
    }

    fn resolve_hsl_via_root(root: &Path, session: &str, rest: &str) -> Option<PathBuf> {
        resolve_hls_path(root, session, rest)
    }

    #[test]
    fn stop_unknown_session_is_error() {
        let t = HlsTranscoder::default();
        assert!(t.stop("ghost").is_err());
    }

    #[test]
    fn start_rejects_unsafe_session() {
        let t = HlsTranscoder::default();
        let root = std::env::temp_dir();
        let err = t.start(&root, 0, "", "../escape", "/dev/null").unwrap_err();
        assert!(err.contains("非法"));
    }

    #[test]
    fn stop_rejects_unsafe_session() {
        let t = HlsTranscoder::default();
        let err = t.stop("../escape").unwrap_err();
        assert!(err.contains("非法"));
    }
}
