use serde::{Deserialize, Serialize};
use std::collections::HashMap;
#[cfg(target_os = "linux")]
use std::{fs, path::PathBuf};

#[cfg(any(target_os = "linux", test))]
const OUR_DESKTOP_IDS: &[&str] = &["xfileviewer.desktop", "com.xfileviewer.app.desktop"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AssociationQuery {
    os_managed: bool,
    granted: HashMap<String, bool>,
}

#[tauri::command]
pub(crate) fn query_file_associations(extensions: Vec<String>) -> AssociationQuery {
    let mut granted = HashMap::new();
    for ext in extensions {
        let key = ext.to_lowercase();
        #[cfg(target_os = "linux")]
        let is_ours = mime_for_ext(&key).map(association_is_ours).unwrap_or(false);
        #[cfg(not(target_os = "linux"))]
        let is_ours = false;
        granted.insert(key, is_ours);
    }
    AssociationQuery {
        os_managed: cfg!(target_os = "linux"),
        granted,
    }
}

#[tauri::command]
pub(crate) fn grant_file_associations(extensions: Vec<String>) -> Result<(), String> {
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
    #[cfg(not(target_os = "linux"))]
    {
        let _ = mimes;
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn revoke_file_associations(extensions: Vec<String>) -> Result<(), String> {
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
    #[cfg(not(target_os = "linux"))]
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

#[cfg(target_os = "linux")]
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

#[cfg(any(target_os = "linux", test))]
fn desktop_is_ours(name: &str) -> bool {
    OUR_DESKTOP_IDS.contains(&name)
}

#[cfg(target_os = "linux")]
fn desktop_is_active(name: &str) -> bool {
    desktop_is_active_with(name, &installed_desktop_ids())
}

#[cfg(any(target_os = "linux", test))]
fn desktop_is_active_with(name: &str, installed: &[&str]) -> bool {
    desktop_is_ours(name) && installed.contains(&name)
}

#[cfg(target_os = "linux")]
fn installed_desktop_ids() -> Vec<&'static str> {
    OUR_DESKTOP_IDS
        .iter()
        .copied()
        .filter(|id| desktop_file_exists(id))
        .collect()
}

#[cfg(target_os = "linux")]
fn desktop_file_exists(id: &str) -> bool {
    application_dirs().iter().any(|dir| dir.join(id).is_file())
}

#[cfg(target_os = "linux")]
fn application_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(home) = std::env::var("HOME") {
        dirs.push(PathBuf::from(home).join(".local/share/applications"));
    }
    dirs.push(PathBuf::from("/usr/local/share/applications"));
    dirs.push(PathBuf::from("/usr/share/applications"));
    dirs
}

#[cfg(target_os = "linux")]
fn preferred_desktop_id() -> &'static str {
    OUR_DESKTOP_IDS
        .iter()
        .copied()
        .find(|id| desktop_file_exists(id))
        .unwrap_or(OUR_DESKTOP_IDS[0])
}

#[cfg(target_os = "linux")]
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

#[cfg(target_os = "linux")]
fn set_gio_defaults(desktop: &str, mimes: &[String]) {
    for mime in mimes {
        let _ = std::process::Command::new("gio")
            .args(["mime", mime, desktop])
            .status();
    }
}

#[cfg(target_os = "linux")]
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

#[cfg(any(target_os = "linux", test))]
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

#[cfg(any(target_os = "linux", test))]
fn grant_mime_defaults(text: &str, desktop: &str, mimes: &[String]) -> String {
    if mimes.is_empty() {
        return text.to_string();
    }
    let mut remaining: std::collections::HashSet<&str> = mimes.iter().map(String::as_str).collect();
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

#[cfg(any(target_os = "linux", test))]
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

#[cfg(target_os = "linux")]
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

#[cfg(target_os = "linux")]
fn mimeapps_list_path() -> PathBuf {
    if let Ok(dir) = std::env::var("XDG_CONFIG_HOME") {
        if !dir.is_empty() {
            return PathBuf::from(dir).join("mimeapps.list");
        }
    }
    dirs_home().join(".config/mimeapps.list")
}

#[cfg(target_os = "linux")]
fn dirs_home() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

#[cfg(any(target_os = "linux", test))]
fn revoke_mime_defaults(text: &str, desktops: &[&str], mimes: &[String]) -> String {
    let mime_set: std::collections::HashSet<&str> = mimes.iter().map(String::as_str).collect();
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
        if section != "[Default Applications]" || trimmed.is_empty() || trimmed.starts_with('#') {
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

#[cfg(test)]
mod tests {
    use super::*;
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
