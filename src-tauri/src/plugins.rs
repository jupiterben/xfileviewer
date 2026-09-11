use crate::settings::config_file;
use std::{fs, path::PathBuf};
use tauri::AppHandle;

#[tauri::command]
pub(crate) fn list_plugin_dirs(app: AppHandle) -> Result<Vec<String>, String> {
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
pub(crate) fn read_plugin_file(app: AppHandle, path: String) -> Result<String, String> {
    let root = config_file(&app, "plugins")?;
    let requested = PathBuf::from(&path);
    let root_canon = root.canonicalize().unwrap_or(root);
    let requested_canon = requested.canonicalize().map_err(|err| err.to_string())?;
    if !requested_canon.starts_with(&root_canon) {
        return Err("plugin path outside plugin dir".into());
    }
    fs::read_to_string(requested_canon).map_err(|err| err.to_string())
}
