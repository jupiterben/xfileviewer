use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;

use percent_encoding::{percent_decode_str, utf8_percent_encode, NON_ALPHANUMERIC};

/// Shared HLS cache root, used by `handle_client` to resolve `/hls/...`
/// requests into absolute file paths under the per-session directories
/// owned by `hls_transcoder`. The value is filled in by the Tauri setup
/// hook (it needs `app.path().app_cache_dir()`), so the server thread
/// reads it lazily on every request.
pub type HlsCacheRoot = Arc<Mutex<Option<PathBuf>>>;

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

fn query_path(target: &str) -> Option<String> {
    let query = target.split_once('?')?.1;
    for part in query.split('&') {
        if let Some(value) = part.strip_prefix("path=") {
            let decoded = percent_decode_str(value).decode_utf8().ok()?.into_owned();
            return Some(decoded);
        }
    }
    None
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
    write!(stream, "Access-Control-Allow-Origin: *\r\n")?;
    write!(stream, "Accept-Ranges: bytes\r\n")?;
    write!(stream, "Connection: close\r\n")?;
    for (k, v) in extra {
        write!(stream, "{k}: {v}\r\n")?;
    }
    write!(stream, "Content-Length: {body_len}\r\n\r\n")?;
    Ok(())
}

fn copy_range(file: &mut File, stream: &mut TcpStream, start: u64, end: u64) -> std::io::Result<()> {
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

fn handle_client(mut stream: TcpStream, hls_root: HlsCacheRoot) {
    let Ok(req) = read_headers(&mut stream) else {
        return;
    };
    let Some(first) = req.lines().next() else {
        return;
    };
    let mut parts = first.split_whitespace();
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");

    // HLS path takes precedence over the legacy /media handler because the
    // frontend always sets `path=` for /media; any missing path means the
    // request is for a different route.
    if target.starts_with("/hls/") {
        serve_hls(&mut stream, method, target, &hls_root);
        return;
    }

    if method == "OPTIONS" {
        let _ = write!(
            stream,
            "HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: range, content-type\r\nAccess-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nConnection: close\r\n\r\n"
        );
        return;
    }

    if method != "GET" && method != "HEAD" {
        let _ = write_response(&mut stream, "405 Method Not Allowed", &[], 0);
        return;
    }

    let Some(raw_path) = query_path(target) else {
        let _ = write_response(&mut stream, "400 Bad Request", &[], 0);
        return;
    };
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
    let mut extra = vec![("Content-Type", mime.to_string())];
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

/// Convenience entry point: start the media server with a deferred HLS
/// root. Kept for external integrations that do not need to inject the
/// shared cache directory.
#[allow(dead_code)]
pub fn start() -> std::io::Result<u16> {
    start_with_hls_root(Arc::new(Mutex::new(None)))
}

pub fn start_with_hls_root(hls_root: HlsCacheRoot) -> std::io::Result<u16> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    listener.set_nonblocking(false)?;
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let root = hls_root.clone();
            thread::spawn(move || handle_client(stream, root));
        }
    });
    Ok(port)
}

pub fn stream_url(port: u16, path: &str) -> String {
    format!(
        "http://127.0.0.1:{port}/media?path={}",
        utf8_percent_encode(path, NON_ALPHANUMERIC)
    )
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

fn serve_hls(stream: &mut TcpStream, method: &str, target: &str, hls_root: &HlsCacheRoot) {
    if method == "OPTIONS" {
        let _ = write!(
            stream,
            "HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: range, content-type\r\nAccess-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nConnection: close\r\n\r\n"
        );
        return;
    }
    if method != "GET" && method != "HEAD" {
        let _ = write_response(stream, "405 Method Not Allowed", &[], 0);
        return;
    }
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
    let extra = [("Content-Type", mime.to_string())];
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
    use super::parse_byte_range;

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
