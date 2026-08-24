mod media_server;
mod windows_assoc;

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

struct LaunchState {
    path: Mutex<Option<String>>,
}

struct MediaServer {
    port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct AssociationSettings {
    granted: Vec<String>,
    denied: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WindowSize {
    width: f64,
    height: f64,
}

type WindowSizes = HashMap<String, WindowSize>;

const OUR_DESKTOP_IDS: &[&str] = &[
    "xfileviewer.desktop",
    "com.xfileviewer.app.desktop",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssociationQuery {
    os_managed: bool,
    granted: HashMap<String, bool>,
}

fn first_file_arg<I>(args: I) -> Option<String>
where
    I: IntoIterator<Item = String>,
{
    args.into_iter().skip(1).find_map(|arg| {
        if arg.starts_with('-') {
            return None;
        }
        let path = normalize_launch_arg(&arg);
        Path::new(&path).exists().then_some(path)
    })
}

fn normalize_launch_arg(arg: &str) -> String {
    let trimmed = arg.trim().trim_matches('"');
    if let Some(encoded) = trimmed.strip_prefix("file:") {
        let decoded = percent_decode_str(encoded).decode_utf8_lossy().into_owned();
        return file_uri_to_path(&decoded);
    }
    trimmed.to_string()
}

fn file_uri_to_path(after_scheme: &str) -> String {
    let path = if let Some(rest) = after_scheme.strip_prefix("//") {
        match rest.split_once('/') {
            Some((host, path)) if host.is_empty() || host.eq_ignore_ascii_case("localhost") => {
                format!("/{path}")
            }
            Some((host, path)) => format!("//{host}/{path}"),
            None => rest.to_string(),
        }
    } else if after_scheme.starts_with('/') {
        after_scheme.to_string()
    } else {
        format!("/{after_scheme}")
    };
    if path.len() >= 3 {
        let bytes = path.as_bytes();
        if bytes[0] == b'/' && bytes[1].is_ascii_alphabetic() && bytes[2] == b':' {
            return path[1..].to_string();
        }
    }
    path
}

fn file_name_title(path: &str) -> String {
    path.rsplit(['/', '\\'])
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or(path)
        .to_string()
}

fn set_window_file_title(app: &AppHandle, path: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_title(&file_name_title(path));
    }
}

fn config_file(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(name))
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn take_launch_path(state: tauri::State<LaunchState>) -> Option<String> {
    state.path.lock().ok()?.clone()
}

#[tauri::command]
fn parent_dir(path: String) -> Result<String, String> {
    Path::new(&path)
        .parent()
        .map(|dir| dir.to_string_lossy().into_owned())
        .ok_or_else(|| "path has no parent directory".into())
}

#[tauri::command]
fn list_dir_files(dir: String) -> Result<Vec<String>, String> {
    let mut files = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        if path.is_file() {
            files.push(path.to_string_lossy().into_owned());
        }
    }
    Ok(files)
}

#[tauri::command]
fn load_association_settings(app: AppHandle) -> Result<AssociationSettings, String> {
    let path = config_file(&app, "associations.json")?;
    if !path.exists() {
        return Ok(AssociationSettings::default());
    }
    let raw = fs::read_to_string(path).map_err(|err| err.to_string())?;
    serde_json::from_str(&raw).map_err(|err| err.to_string())
}

#[tauri::command]
fn save_association_settings(
    app: AppHandle,
    settings: AssociationSettings,
) -> Result<(), String> {
    let path = config_file(&app, "associations.json")?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|err| err.to_string())?;
    }
    let raw = serde_json::to_string_pretty(&settings).map_err(|err| err.to_string())?;
    fs::write(path, raw).map_err(|err| err.to_string())
}

#[tauri::command]
fn load_window_sizes(app: AppHandle) -> Result<WindowSizes, String> {
    let path = config_file(&app, "window-sizes.json")?;
    if !path.exists() {
        return Ok(WindowSizes::default());
    }
    let raw = fs::read_to_string(path).map_err(|err| err.to_string())?;
    serde_json::from_str(&raw).map_err(|err| err.to_string())
}

#[tauri::command]
fn save_window_sizes(app: AppHandle, sizes: WindowSizes) -> Result<(), String> {
    let path = config_file(&app, "window-sizes.json")?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|err| err.to_string())?;
    }
    let raw = serde_json::to_string_pretty(&sizes).map_err(|err| err.to_string())?;
    fs::write(path, raw).map_err(|err| err.to_string())
}

#[tauri::command]
fn query_file_associations(extensions: Vec<String>) -> AssociationQuery {
    let mut granted = HashMap::new();
    for ext in extensions {
        let key = ext.to_lowercase();
        #[cfg(target_os = "linux")]
        let is_ours = mime_for_ext(&key)
            .map(association_is_ours)
            .unwrap_or(false);
        #[cfg(target_os = "windows")]
        let is_ours = windows_assoc::association_is_ours(&key);
        #[cfg(not(any(target_os = "linux", target_os = "windows")))]
        let is_ours = false;
        granted.insert(key, is_ours);
    }
    AssociationQuery {
        os_managed: cfg!(any(target_os = "linux", target_os = "windows")),
        granted,
    }
}

#[tauri::command]
fn grant_file_associations(extensions: Vec<String>) -> Result<(), String> {
    let mimes: Vec<String> = extensions
        .iter()
        .map(|ext| {
            mime_for_ext(ext)
                .map(str::to_string)
                .ok_or_else(|| "无法关联".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    #[cfg(target_os = "linux")]
    {
        let _ = ensure_user_desktop_file();
        let desktop = preferred_desktop_id();
        for mime in &mimes {
            let _ = std::process::Command::new("xdg-mime")
                .args(["default", desktop, mime])
                .status();
        }
        write_mimeapps_list(|raw| grant_mime_defaults(&raw, desktop, &mimes))?;
        set_gio_defaults(desktop, &mimes);
    }
    #[cfg(target_os = "windows")]
    {
        let _ = &mimes;
        windows_assoc::grant(&extensions)?;
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        let _ = mimes;
    }
    Ok(())
}

#[tauri::command]
fn revoke_file_associations(extensions: Vec<String>) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let mimes: Vec<String> = extensions
            .iter()
            .filter_map(|ext| mime_for_ext(ext).map(str::to_string))
            .collect();
        if mimes.is_empty() {
            return Ok(());
        }
        write_mimeapps_list(|raw| revoke_mime_defaults(&raw, OUR_DESKTOP_IDS, &mimes))?;
    }
    #[cfg(target_os = "windows")]
    {
        windows_assoc::revoke(&extensions)?;
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        let _ = extensions;
    }
    Ok(())
}

fn mime_for_ext(ext: &str) -> Option<&'static str> {
    Some(match ext.to_lowercase().as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "mov" => "video/quicktime",
        "avi" => "video/x-msvideo",
        "md" | "markdown" => "text/markdown",
        "psd" | "psb" => "image/vnd.adobe.photoshop",
        "tif" | "tiff" => "image/tiff",
        "heic" => "image/heic",
        "avif" => "image/avif",
        _ => return None,
    })
}

fn association_is_ours(mime: &str) -> bool {
    if let Ok(raw) = fs::read_to_string(mimeapps_list_path()) {
        if let Some(desktop) = mimeapps_default_desktop(&raw, mime) {
            if desktop_is_active(&desktop) {
                return true;
            }
        }
    }
    query_default_desktop(mime)
        .map(|desktop| desktop_is_active(&desktop))
        .unwrap_or(false)
}

fn desktop_is_ours(name: &str) -> bool {
    OUR_DESKTOP_IDS.contains(&name)
}

fn desktop_is_active(name: &str) -> bool {
    desktop_is_active_with(name, &installed_desktop_ids())
}

fn desktop_is_active_with(name: &str, installed: &[&str]) -> bool {
    desktop_is_ours(name) && installed.contains(&name)
}

fn installed_desktop_ids() -> Vec<&'static str> {
    OUR_DESKTOP_IDS
        .iter()
        .copied()
        .filter(|id| desktop_file_exists(id))
        .collect()
}

fn desktop_file_exists(id: &str) -> bool {
    application_dirs().iter().any(|dir| dir.join(id).is_file())
}

fn application_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(home) = std::env::var("HOME") {
        dirs.push(PathBuf::from(home).join(".local/share/applications"));
    }
    dirs.push(PathBuf::from("/usr/local/share/applications"));
    dirs.push(PathBuf::from("/usr/share/applications"));
    dirs
}

fn preferred_desktop_id() -> &'static str {
    OUR_DESKTOP_IDS
        .iter()
        .copied()
        .find(|id| desktop_file_exists(id))
        .unwrap_or(OUR_DESKTOP_IDS[0])
}

fn ensure_user_desktop_file() -> Result<(), String> {
    let Some(home) = std::env::var("HOME").ok() else {
        return Ok(());
    };
    let dir = PathBuf::from(home).join(".local/share/applications");
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    let path = dir.join("xfileviewer.desktop");
    let body = "\
[Desktop Entry]
Name=xfileviewer
Comment=本机图片/视频/Markdown 打开器
Exec=xfileviewer %F
Icon=xfileviewer
Terminal=false
Type=Application
StartupWMClass=xfileviewer
Categories=Utility;Viewer;
MimeType=image/jpeg;image/png;image/gif;image/webp;image/bmp;image/svg+xml;video/mp4;video/webm;video/x-matroska;video/quicktime;video/x-msvideo;text/markdown;text/x-markdown;
";
    fs::write(&path, body).map_err(|err| err.to_string())?;
    let _ = std::process::Command::new("update-desktop-database")
        .arg(&dir)
        .status();
    Ok(())
}

fn set_gio_defaults(desktop: &str, mimes: &[String]) {
    for mime in mimes {
        let _ = std::process::Command::new("gio")
            .args(["mime", mime, desktop])
            .status();
    }
}

fn write_mimeapps_list(edit: impl FnOnce(String) -> String) -> Result<(), String> {
    let path = mimeapps_list_path();
    let raw = if path.exists() {
        fs::read_to_string(&path).map_err(|err| err.to_string())?
    } else {
        String::new()
    };
    let next = edit(raw.clone());
    if next == raw {
        return Ok(());
    }
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|err| err.to_string())?;
    }
    fs::write(path, next).map_err(|err| err.to_string())
}

fn mimeapps_default_desktop(text: &str, mime: &str) -> Option<String> {
    let mut section = String::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            section = trimmed.to_string();
            continue;
        }
        if section != "[Default Applications]" {
            continue;
        }
        let Some((key, value)) = trimmed.split_once('=') else {
            continue;
        };
        if key.trim() != mime {
            continue;
        }
        return value
            .split(';')
            .map(str::trim)
            .find(|item| !item.is_empty())
            .map(str::to_string);
    }
    None
}

fn grant_mime_defaults(text: &str, desktop: &str, mimes: &[String]) -> String {
    if mimes.is_empty() {
        return text.to_string();
    }
    let mut remaining: std::collections::HashSet<&str> =
        mimes.iter().map(String::as_str).collect();
    let mut section = String::new();
    let mut out: Vec<String> = Vec::new();
    let mut saw_default = false;
    let ends_with_nl = text.ends_with('\n');
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            if section == "[Default Applications]" {
                append_remaining_defaults(&mut out, desktop, mimes, &mut remaining);
            }
            section = trimmed.to_string();
            if section == "[Default Applications]" {
                saw_default = true;
            }
            out.push(line.to_string());
            continue;
        }
        if section == "[Default Applications]" {
            if let Some((key, _)) = trimmed.split_once('=') {
                let key = key.trim();
                if remaining.contains(key) {
                    remaining.remove(key);
                    out.push(format!("{key}={desktop};"));
                    continue;
                }
            }
        }
        out.push(line.to_string());
    }
    if section == "[Default Applications]" {
        append_remaining_defaults(&mut out, desktop, mimes, &mut remaining);
    }
    if !saw_default {
        if !out.is_empty() && out.last().is_some_and(|line| !line.is_empty()) {
            out.push(String::new());
        }
        out.push("[Default Applications]".into());
        append_remaining_defaults(&mut out, desktop, mimes, &mut remaining);
    }
    let mut joined = out.join("\n");
    if ends_with_nl || !joined.ends_with('\n') {
        if !joined.ends_with('\n') {
            joined.push('\n');
        }
    }
    joined
}

fn append_remaining_defaults(
    out: &mut Vec<String>,
    desktop: &str,
    mimes: &[String],
    remaining: &mut std::collections::HashSet<&str>,
) {
    for mime in mimes {
        if remaining.remove(mime.as_str()) {
            out.push(format!("{mime}={desktop};"));
        }
    }
}

fn query_default_desktop(mime: &str) -> Option<String> {
    let output = std::process::Command::new("xdg-mime")
        .args(["query", "default", mime])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn mimeapps_list_path() -> PathBuf {
    if let Ok(dir) = std::env::var("XDG_CONFIG_HOME") {
        if !dir.is_empty() {
            return PathBuf::from(dir).join("mimeapps.list");
        }
    }
    dirs_home().join(".config/mimeapps.list")
}

fn dirs_home() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn revoke_mime_defaults(text: &str, desktops: &[&str], mimes: &[String]) -> String {
    let mime_set: std::collections::HashSet<&str> =
        mimes.iter().map(String::as_str).collect();
    let mut section = String::new();
    let mut out: Vec<String> = Vec::new();
    let ends_with_nl = text.ends_with('\n');
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            section = trimmed.to_string();
            out.push(line.to_string());
            continue;
        }
        if section != "[Default Applications]"
            || trimmed.is_empty()
            || trimmed.starts_with('#')
        {
            out.push(line.to_string());
            continue;
        }
        let Some((key, value)) = trimmed.split_once('=') else {
            out.push(line.to_string());
            continue;
        };
        let key = key.trim();
        if !mime_set.contains(key) {
            out.push(line.to_string());
            continue;
        }
        let items: Vec<&str> = value
            .split(';')
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .collect();
        let rest: Vec<&str> = items
            .iter()
            .copied()
            .filter(|item| !desktops.contains(item))
            .collect();
        if rest.len() == items.len() {
            out.push(line.to_string());
            continue;
        }
        if rest.is_empty() {
            continue;
        }
        out.push(format!("{}={};", key, rest.join(";")));
    }
    let mut joined = out.join("\n");
    if ends_with_nl && !joined.ends_with('\n') {
        joined.push('\n');
    }
    joined
}

#[tauri::command]
fn video_stream_url(state: tauri::State<MediaServer>, path: String) -> Result<String, String> {
    if !Path::new(&path).is_file() {
        return Err("video file not found".into());
    }
    Ok(media_server::stream_url(state.port, &path))
}

#[tauri::command]
fn list_plugin_dirs(app: AppHandle) -> Result<Vec<String>, String> {
    let root = config_file(&app, "plugins")?;
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut dirs = Vec::new();
    for entry in fs::read_dir(root).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        if path.is_dir() && path.join("manifest.json").is_file() {
            dirs.push(path.to_string_lossy().into_owned());
        }
    }
    Ok(dirs)
}

#[tauri::command]
fn read_plugin_file(app: AppHandle, path: String) -> Result<String, String> {
    let root = config_file(&app, "plugins")?;
    let requested = PathBuf::from(&path);
    let root_canon = root.canonicalize().unwrap_or(root);
    let requested_canon = requested
        .canonicalize()
        .map_err(|err| err.to_string())?;
    if !requested_canon.starts_with(&root_canon) {
        return Err("plugin path outside plugin dir".into());
    }
    fs::read_to_string(requested_canon).map_err(|err| err.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let launch = first_file_arg(std::env::args());
    let media_port = media_server::start().expect("start local media server");
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(LaunchState {
            path: Mutex::new(launch.clone()),
        })
        .manage(MediaServer { port: media_port })
        .setup(move |app| {
            if let Some(path) = launch.as_deref() {
                set_window_file_title(app.handle(), path);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            take_launch_path,
            parent_dir,
            list_dir_files,
            load_association_settings,
            save_association_settings,
            load_window_sizes,
            save_window_sizes,
            query_file_associations,
            grant_file_associations,
            revoke_file_associations,
            video_stream_url,
            list_plugin_dirs,
            read_plugin_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_launch_arg_strips_file_uri_and_quotes() {
        assert_eq!(
            normalize_launch_arg(r#""file:///C:/Users/a/My%20Pic.jpg""#),
            "C:/Users/a/My Pic.jpg"
        );
        assert_eq!(
            normalize_launch_arg("file:///home/u/photo.jpg"),
            "/home/u/photo.jpg"
        );
        assert_eq!(normalize_launch_arg(r"C:\tmp\clip.mp4"), r"C:\tmp\clip.mp4");
    }

    #[test]
    fn first_file_arg_opens_file_uri_that_exists() {
        let dir = std::env::temp_dir();
        let file = dir.join("xfileviewer-launch-arg.jpg");
        fs::write(&file, b"x").unwrap();
        let uri = format!("file://{}", file.display());
        let expected = file.to_string_lossy().into_owned();
        let found = first_file_arg(["app".into(), uri]);
        let _ = fs::remove_file(&file);
        assert_eq!(found, Some(expected));
    }

    #[test]
    fn windows_prog_id_is_recognized() {
        assert_eq!(windows_assoc::prog_id("PNG"), "xfileviewer.png");
        assert!(windows_assoc::is_ours("xfileviewer.png"));
        assert!(windows_assoc::is_ours("com.xfileviewer.app.jpg"));
        assert!(!windows_assoc::is_ours("AppX.Photos"));
        assert_eq!(
            windows_assoc::open_command(Path::new(r"C:\Program Files\xfileviewer.exe")),
            r#""C:\Program Files\xfileviewer.exe" "%1""#,
        );
    }

    #[test]
    fn file_name_title_uses_basename() {
        assert_eq!(file_name_title("/home/u/photo.jpg"), "photo.jpg");
        assert_eq!(file_name_title("C:\\tmp\\clip.mp4"), "clip.mp4");
        assert_eq!(file_name_title("readme"), "readme");
    }

    #[test]
    fn mime_maps_builtin_and_known_plugin_exts() {
        assert_eq!(mime_for_ext("JPG"), Some("image/jpeg"));
        assert_eq!(mime_for_ext("png"), Some("image/png"));
        assert_eq!(mime_for_ext("mp4"), Some("video/mp4"));
        assert_eq!(mime_for_ext("md"), Some("text/markdown"));
        assert_eq!(mime_for_ext("psd"), Some("image/vnd.adobe.photoshop"));
        assert_eq!(mime_for_ext("xyz"), None);
    }

    #[test]
    fn revoke_drops_our_desktop_and_keeps_others() {
        let input = "[Default Applications]\nimage/jpeg=com.xfileviewer.app.desktop;\nimage/png=other.desktop;com.xfileviewer.app.desktop;\n";
        let out = revoke_mime_defaults(
            input,
            OUR_DESKTOP_IDS,
            &["image/jpeg".into(), "image/png".into()],
        );
        assert!(!out.contains("image/jpeg"));
        assert!(out.contains("image/png=other.desktop;"));
    }

    #[test]
    fn revoke_leaves_unrelated_defaults() {
        let input = "[Default Applications]\nimage/gif=other.desktop\n";
        let out = revoke_mime_defaults(input, OUR_DESKTOP_IDS, &["image/gif".into()]);
        assert_eq!(out, input);
    }

    #[test]
    fn listed_association_is_inactive_when_desktop_file_missing() {
        assert!(!desktop_is_active_with(
            "com.xfileviewer.app.desktop",
            &["xfileviewer.desktop"],
        ));
        assert!(desktop_is_active_with(
            "xfileviewer.desktop",
            &["xfileviewer.desktop"],
        ));
    }

    #[test]
    fn grant_writes_default_applications() {
        let out = grant_mime_defaults("", "xfileviewer.desktop", &["image/jpeg".into()]);
        assert!(out.contains("[Default Applications]"));
        assert!(out.contains("image/jpeg=xfileviewer.desktop;"));
    }

    #[test]
    fn grant_replaces_existing_default() {
        let input = "[Default Applications]\nimage/jpeg=other.desktop;\n";
        let out = grant_mime_defaults(input, "xfileviewer.desktop", &["image/jpeg".into()]);
        assert!(out.contains("image/jpeg=xfileviewer.desktop;"));
        assert!(!out.contains("other.desktop"));
    }

    #[test]
    fn mimeapps_default_reads_first_desktop() {
        let input = "[Default Applications]\nimage/jpeg=xfileviewer.desktop;other.desktop;\n";
        assert_eq!(
            mimeapps_default_desktop(input, "image/jpeg").as_deref(),
            Some("xfileviewer.desktop")
        );
    }
}
