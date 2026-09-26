use crate::media_server::MediaServer;

#[tauri::command]
pub(crate) fn native_video_available() -> bool {
    cfg!(windows)
}

/// `async` annotation: canonicalize() on a slow or disconnected network
/// drive can block for tens of seconds; it must never run on the main thread.
#[tauri::command(async)]
pub(crate) fn video_stream_url(
    state: tauri::State<MediaServer>,
    path: String,
    session: String,
) -> Result<String, String> {
    eprintln!("[video_stream_url] path={path:?}");
    state.register(&session, &path).map_err(|err| {
        let message = format!("无法打开视频文件：{path}\n系统错误：{err}");
        eprintln!("[video_stream_url] {message}");
        message
    })
}

#[tauri::command]
pub(crate) fn video_stream_close(
    state: tauri::State<MediaServer>,
    session: String,
) -> Result<(), String> {
    state.revoke(&session)
}
