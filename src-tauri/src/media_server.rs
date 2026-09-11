use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;

use uuid::Uuid;

/// Shared HLS cache root, used by `handle_client` to resolve `/hls/...`
/// requests into absolute file paths under the per-session directories
/// owned by `hls_transcoder`. The value is filled in by the Tauri setup
/// hook (it needs `app.path().app_cache_dir()`), so the server thread
/// reads it lazily on every request.
pub type HlsCacheRoot = Arc<Mutex<Option<PathBuf>>>;

pub struct MediaServer {
    pub port: u16,
    access: Arc<MediaAccess>,
}

struct MediaAccess {
    token: String,
    files: Mutex<HashMap<String, PathBuf>>,
}

impl Default for MediaAccess {
    fn default() -> Self {
        Self {
            token: Uuid::new_v4().simple().to_string(),
            files: Mutex::new(HashMap::new()),
        }
    }
}

impl MediaServer {
    pub fn register(&self, session: &str, path: &str) -> Result<String, String> {
        if !safe_session(session) {
            return Err("Invalid media session".into());
        }
        let path = Path::new(path)
            .canonicalize()
            .map_err(|err| err.to_string())?;
        open_media(&path.to_string_lossy()).map_err(|err| err.to_string())?;
        self.access
            .files
            .lock()
            .map_err(|err| err.to_string())?
            .insert(session.to_string(), path);
        Ok(format!("{}/media/{session}", self.base_url()))
    }

    pub fn revoke(&self, session: &str) -> Result<(), String> {
        self.access
            .files
            .lock()
            .map_err(|err| err.to_string())?
            .remove(session);
        Ok(())
    }

    pub fn base_url(&self) -> String {
        format!("http://127.0.0.1:{}/{}", self.port, self.access.token)
    }
}

fn safe_session(session: &str) -> bool {
    !session.is_empty()
        && session.len() <= 128
        && session
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}

fn allowed_origin(origin: &str) -> bool {
    matches!(
        origin,
        "tauri://localhost" | "http://tauri.localhost" | "https://tauri.localhost"
    ) || (cfg!(debug_assertions)
        && matches!(origin, "http://localhost:1420" | "http://127.0.0.1:1420"))
}

pub fn open_media(path: &str) -> std::io::Result<(File, std::fs::Metadata)> {
    // Query the opened handle, so validation and streaming use the same object.
    let file = File::open(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("opened path is not a regular file: {metadata:?}"),
        ));
    }
    Ok((file, metadata))
}

pub fn parse_byte_range(header: &str, len: u64) -> Option<(u64, u64)> {
    let spec = header
        .split(',')
        .next()?
        .trim()
        .strip_prefix("bytes=")?
        .trim();
    if spec.is_empty() || len == 0 {
        return None;
    }
    if let Some(suffix) = spec.strip_prefix('-') {
        let n: u64 = suffix.parse().ok()?;
        if n == 0 {
            return None;
        }
        return Some((len.saturating_sub(n), len - 1));
    }
    let (start_s, end_s) = spec.split_once('-')?;
    let start: u64 = start_s.parse().ok()?;
    let end = if end_s.is_empty() {
        len.saturating_sub(1)
    } else {
        end_s.parse().ok()?
    };
    if start >= len || end < start {
        return None;
    }
    Some((start, end.min(len - 1)))
}

fn content_type(path: &str) -> &'static str {
    match Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        _ => "application/octet-stream",
    }
}

fn read_headers(stream: &mut TcpStream) -> std::io::Result<String> {
    let mut data = Vec::new();
    let mut buf = [0u8; 1024];
    loop {
        let n = stream.read(&mut buf)?;
        if n == 0 {
            break;
        }
        data.extend_from_slice(&buf[..n]);
        if data.windows(4).any(|w| w == b"\r\n\r\n") || data.len() > 64 * 1024 {
            break;
        }
    }
    Ok(String::from_utf8_lossy(&data).into_owned())
}

fn header_value<'a>(headers: &'a str, name: &str) -> Option<&'a str> {
    for line in headers.lines().skip(1) {
        let line = line.trim_end();
        if line.is_empty() {
            break;
        }
        if let Some((k, v)) = line.split_once(':') {
            if k.eq_ignore_ascii_case(name) {
                return Some(v.trim());
            }
        }
    }
    None
}

fn write_response(
    stream: &mut TcpStream,
    status: &str,
    extra: &[(&str, String)],
    body_len: u64,
) -> std::io::Result<()> {
    write!(stream, "HTTP/1.1 {status}\r\n")?;
    write!(stream, "Cache-Control: no-store\r\n")?;
    write!(stream, "Referrer-Policy: no-referrer\r\n")?;
    write!(stream, "Accept-Ranges: bytes\r\n")?;
    write!(stream, "Connection: close\r\n")?;
    for (k, v) in extra {
        write!(stream, "{k}: {v}\r\n")?;
    }
    write!(stream, "Content-Length: {body_len}\r\n\r\n")?;
    Ok(())
}

fn copy_range(
    file: &mut File,
    stream: &mut TcpStream,
    start: u64,
    end: u64,
) -> std::io::Result<()> {
    file.seek(SeekFrom::Start(start))?;
    let mut left = end.saturating_sub(start) + 1;
    let mut buf = [0u8; 64 * 1024];
    while left > 0 {
        let chunk = left.min(buf.len() as u64) as usize;
        let n = file.read(&mut buf[..chunk])?;
        if n == 0 {
            break;
        }
        stream.write_all(&buf[..n])?;
        left -= n as u64;
    }
    Ok(())
}

fn handle_client(mut stream: TcpStream, hls_root: HlsCacheRoot, access: Arc<MediaAccess>) {
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(10)));
    let _ = stream.set_write_timeout(Some(std::time::Duration::from_secs(30)));
    let Ok(req) = read_headers(&mut stream) else {
        return;
    };
    let Some(first) = req.lines().next() else {
        return;
    };
    let mut parts = first.split_whitespace();
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("").split('?').next().unwrap_or("");
    let prefix = format!("/{}/", access.token);
    let Some(route) = target.strip_prefix(&prefix) else {
        let _ = write_response(&mut stream, "403 Forbidden", &[], 0);
        return;
    };
    let origin = header_value(&req, "Origin");
    if origin.is_some_and(|value| !allowed_origin(value)) {
        let _ = write_response(&mut stream, "403 Forbidden", &[], 0);
        return;
    }
    let mut cors = Vec::new();
    if let Some(origin) = origin {
        cors.push(("Access-Control-Allow-Origin", origin.to_string()));
        cors.push(("Vary", "Origin".to_string()));
    }

    if method == "OPTIONS" {
        cors.push(("Access-Control-Allow-Headers", "range, content-type".into()));
        cors.push(("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS".into()));
        let _ = write_response(&mut stream, "204 No Content", &cors, 0);
        return;
    }

    if method != "GET" && method != "HEAD" {
        let _ = write_response(&mut stream, "405 Method Not Allowed", &[], 0);
        return;
    }

    if route.starts_with("hls/") {
        serve_hls(&mut stream, method, &format!("/{route}"), &hls_root, cors);
        return;
    }
    let Some(session) = route
        .strip_prefix("media/")
        .filter(|session| safe_session(session))
    else {
        let _ = write_response(&mut stream, "404 Not Found", &[], 0);
        return;
    };
    let path = access
        .files
        .lock()
        .ok()
        .and_then(|files| files.get(session).cloned());
    let Some(path) = path else {
        let _ = write_response(&mut stream, "404 Not Found", &[], 0);
        return;
    };
    let raw_path = path.to_string_lossy();
    let (mut file, meta) = match open_media(&raw_path) {
        Ok(opened) => opened,
        Err(err) => {
            eprintln!("[media_server] path={raw_path:?}, error={err}");
            let _ = write_response(&mut stream, "404 Not Found", &[], 0);
            return;
        }
    };
    let len = meta.len();
    let mime = content_type(&raw_path);
    let range_hdr = header_value(&req, "Range");
    let (status, start, end) = if let Some(h) = range_hdr {
        match parse_byte_range(h, len) {
            Some((s, e)) => ("206 Partial Content", s, e),
            None => {
                let extra = [("Content-Range", format!("bytes */{len}"))];
                let _ = write_response(&mut stream, "416 Range Not Satisfiable", &extra, 0);
                return;
            }
        }
    } else {
        ("200 OK", 0, len.saturating_sub(1))
    };
    let nbytes = if len == 0 { 0 } else { end - start + 1 };
    let mut extra = cors;
    extra.push(("Content-Type", mime.to_string()));
    if range_hdr.is_some() {
        extra.push(("Content-Range", format!("bytes {start}-{end}/{len}")));
    }
    if write_response(&mut stream, status, &extra, nbytes).is_err() {
        return;
    }
    if method == "HEAD" || nbytes == 0 {
        return;
    }
    let _ = copy_range(&mut file, &mut stream, start, end);
}

pub fn start_with_hls_root(hls_root: HlsCacheRoot) -> std::io::Result<MediaServer> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    listener.set_nonblocking(false)?;
    let access = Arc::new(MediaAccess::default());
    let clients = access.clone();
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let root = hls_root.clone();
            let access = clients.clone();
            thread::spawn(move || handle_client(stream, root, access));
        }
    });
    Ok(MediaServer { port, access })
}

fn hls_mime(path: &Path) -> &'static str {
    // Match by suffix on the file name; `.m3u8` and `.ts` are the only
    // formats the HLS muxer emits here.
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if name.ends_with(".m3u8") {
        "application/vnd.apple.mpegurl"
    } else if name.ends_with(".ts") {
        "video/mp2t"
    } else {
        "application/octet-stream"
    }
}

fn serve_hls(
    stream: &mut TcpStream,
    method: &str,
    target: &str,
    hls_root: &HlsCacheRoot,
    mut extra: Vec<(&str, String)>,
) {
    // Strip query string and "/hls/" prefix, then split "<session>/<rest>".
    let path_part = target.split_once('?').map_or(target, |(p, _)| p);
    let stripped = path_part.strip_prefix("/hls/").unwrap_or("");
    let (session, rest) = match stripped.split_once('/') {
        Some((s, r)) => (s, r),
        None => (stripped, ""),
    };
    let cache_root = match hls_root.lock() {
        Ok(guard) => match guard.as_ref() {
            Some(p) => p.clone(),
            None => {
                let _ = write_response(stream, "503 Service Unavailable", &[], 0);
                return;
            }
        },
        Err(_) => {
            let _ = write_response(stream, "500 Internal Server Error", &[], 0);
            return;
        }
    };
    let resolved = match crate::hls_transcoder::resolve_hls_path(&cache_root, session, rest) {
        Some(p) => p,
        None => {
            let _ = write_response(stream, "404 Not Found", &[], 0);
            return;
        }
    };
    let meta = match std::fs::metadata(&resolved) {
        Ok(m) if m.is_file() => m,
        _ => {
            let _ = write_response(stream, "404 Not Found", &[], 0);
            return;
        }
    };
    let len = meta.len();
    let mime = hls_mime(&resolved);
    extra.push(("Content-Type", mime.to_string()));
    if write_response(stream, "200 OK", &extra, len).is_err() {
        return;
    }
    if method == "HEAD" || len == 0 {
        return;
    }
    let Ok(mut file) = File::open(&resolved) else {
        return;
    };
    let _ = copy_range(&mut file, stream, 0, len.saturating_sub(1));
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        root: PathBuf,
        server: MediaServer,
    }

    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("xfileviewer-http-{}", Uuid::new_v4()));
            std::fs::create_dir(&root).unwrap();
            std::fs::write(root.join("clip.mp4"), b"0123456789").unwrap();
            Self {
                root,
                server: MediaServer {
                    port: 0,
                    access: Arc::new(MediaAccess::default()),
                },
            }
        }

        fn register(&self) -> String {
            let url = self
                .server
                .register("session-1", self.root.join("clip.mp4").to_str().unwrap())
                .unwrap();
            url.strip_prefix("http://127.0.0.1:0").unwrap().to_string()
        }

        fn request(&self, method: &str, target: &str, headers: &str) -> String {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let mut client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
            client
                .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                .unwrap();
            let access = self.server.access.clone();
            let root = Arc::new(Mutex::new(Some(self.root.clone())));
            let worker = thread::spawn(move || {
                let (stream, _) = listener.accept().unwrap();
                handle_client(stream, root, access);
            });
            write!(
                client,
                "{method} {target} HTTP/1.1\r\nHost: localhost\r\n{headers}\r\n"
            )
            .unwrap();
            let mut response = String::new();
            client.read_to_string(&mut response).unwrap();
            worker.join().unwrap();
            response
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            // Remove only the unique fixture directory created by this test.
            std::fs::remove_dir_all(&self.root).unwrap();
        }
    }

    #[test]
    fn rejects_raw_paths_and_missing_tokens() {
        let fixture = Fixture::new();
        fixture.register();
        assert!(fixture
            .request("GET", "/media?path=clip.mp4", "")
            .starts_with("HTTP/1.1 403"));
        assert!(fixture
            .request("GET", "/wrong/media/session-1", "")
            .starts_with("HTTP/1.1 403"));
    }

    #[test]
    fn serves_only_registered_files_and_revokes_them() {
        let fixture = Fixture::new();
        let target = fixture.register();
        let response = fixture.request("GET", &format!("{target}?path=another-file"), "");
        assert!(response.starts_with("HTTP/1.1 200"));
        assert!(response.ends_with("0123456789"));
        assert!(!response.contains("Access-Control-Allow-Origin: *"));
        fixture.server.revoke("session-1").unwrap();
        assert!(fixture
            .request("GET", &target, "")
            .starts_with("HTTP/1.1 404"));
    }

    #[test]
    fn preserves_range_head_and_origin_validation() {
        let fixture = Fixture::new();
        let target = fixture.register();
        let response = fixture.request(
            "GET",
            &target,
            "Range: bytes=2-4\r\nOrigin: http://tauri.localhost\r\n",
        );
        assert!(response.starts_with("HTTP/1.1 206"));
        assert!(response.contains("Content-Range: bytes 2-4/10"));
        assert!(response.contains("Access-Control-Allow-Origin: http://tauri.localhost"));
        assert!(response.ends_with("234"));
        let head = fixture.request("HEAD", &target, "");
        assert!(head.contains("Content-Length: 10"));
        assert!(head.ends_with("\r\n\r\n"));
        assert!(fixture
            .request("GET", &target, "Origin: https://untrusted.example\r\n")
            .starts_with("HTTP/1.1 403"));
        assert!(fixture
            .request("GET", &target, "Range: bytes=100-\r\n")
            .starts_with("HTTP/1.1 416"));
    }

    #[test]
    fn hls_playlists_and_relative_segments_share_the_token_prefix() {
        let fixture = Fixture::new();
        let dir = fixture.root.join("hls").join("s1");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("index.m3u8"), b"#EXTM3U\nseg_00001.ts\n").unwrap();
        std::fs::write(dir.join("seg_00001.ts"), b"segment").unwrap();
        let prefix = format!("/{}/hls/s1", fixture.server.access.token);
        assert!(fixture
            .request("GET", &format!("{prefix}/index.m3u8"), "")
            .ends_with("seg_00001.ts\n"));
        assert!(fixture
            .request("GET", &format!("{prefix}/seg_00001.ts"), "")
            .ends_with("segment"));
        assert!(fixture
            .request("GET", "/hls/s1/index.m3u8", "")
            .starts_with("HTTP/1.1 403"));
        assert!(fixture
            .request("GET", &format!("{prefix}/../../clip.mp4"), "")
            .starts_with("HTTP/1.1 404"));
    }

    #[test]
    fn rejects_invalid_sessions_and_non_files() {
        let fixture = Fixture::new();
        assert!(fixture
            .server
            .register("../bad", fixture.root.to_str().unwrap())
            .is_err());
        assert!(fixture
            .server
            .register("valid", fixture.root.to_str().unwrap())
            .is_err());
    }

    #[test]
    fn closed_range() {
        assert_eq!(parse_byte_range("bytes=0-499", 1000), Some((0, 499)));
    }

    #[test]
    fn open_end() {
        assert_eq!(parse_byte_range("bytes=200-", 1000), Some((200, 999)));
    }

    #[test]
    fn suffix() {
        assert_eq!(parse_byte_range("bytes=-100", 1000), Some((900, 999)));
    }
}
