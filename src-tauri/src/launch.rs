use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub(crate) struct LaunchState {
    pub(crate) path: Mutex<Option<String>>,
}

pub(crate) fn first_file_arg<I>(args: I) -> Option<String>
where
    I: IntoIterator<Item = String>,
{
    args.into_iter()
        .skip(1)
        .find(|arg| !arg.starts_with('-') && Path::new(arg).exists())
}

fn file_name_title(path: &str) -> String {
    path.rsplit(['/', '\\'])
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or(path)
        .to_string()
}

pub(crate) fn set_window_file_title(app: &AppHandle, path: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_title(&file_name_title(path));
    }
}

#[tauri::command]
pub(crate) fn take_launch_path(state: tauri::State<LaunchState>) -> Option<String> {
    state.path.lock().ok()?.take()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn file_name_title_uses_basename() {
        assert_eq!(file_name_title("/home/u/photo.jpg"), "photo.jpg");
        assert_eq!(file_name_title("C:\\tmp\\clip.mp4"), "clip.mp4");
        assert_eq!(file_name_title("readme"), "readme");
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn open_file(app: &AppHandle, path: String) {
    use tauri::Emitter;
    let state = app.state::<LaunchState>();
    // Store before notifying: startup requests survive until the frontend is ready.
    if let Ok(mut pending) = state.path.lock() {
        *pending = Some(path.clone());
    }
    set_window_file_title(app, &path);
    let _ = app.emit("launch-file-ready", ());
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
