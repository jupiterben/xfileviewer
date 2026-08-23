use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::thread;

use percent_encoding::{percent_decode_str, utf8_percent_encode, NON_ALPHANUMERIC};

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

fn handle_client(mut stream: TcpStream) {
    let Ok(req) = read_headers(&mut stream) else {
        return;
    };
    let Some(first) = req.lines().next() else {
        return;
    };
    let mut parts = first.split_whitespace();
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");

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
    let Ok(path) = Path::new(&raw_path).canonicalize() else {
        let _ = write_response(&mut stream, "404 Not Found", &[], 0);
        return;
    };
    if !path.is_file() {
        let _ = write_response(&mut stream, "404 Not Found", &[], 0);
        return;
    }
    let Ok(mut file) = File::open(&path) else {
        let _ = write_response(&mut stream, "404 Not Found", &[], 0);
        return;
    };
    let Ok(meta) = file.metadata() else {
        return;
    };
    let len = meta.len();
    let mime = content_type(&path.to_string_lossy());
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

pub fn start() -> std::io::Result<u16> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    listener.set_nonblocking(false)?;
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            thread::spawn(move || handle_client(stream));
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
