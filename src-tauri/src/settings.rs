use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub(crate) struct AssociationSettings {
    granted: Vec<String>,
    denied: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct WindowSize {
    width: f64,
    height: f64,
}

pub(crate) type WindowSizes = HashMap<String, WindowSize>;

pub(crate) fn config_file(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(name))
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub(crate) fn load_association_settings(app: AppHandle) -> Result<AssociationSettings, String> {
    let path = config_file(&app, "associations.json")?;
    if !path.exists() {
        return Ok(AssociationSettings::default());
    }
    let raw = fs::read_to_string(path).map_err(|err| err.to_string())?;
    serde_json::from_str(&raw).map_err(|err| err.to_string())
}

#[tauri::command]
pub(crate) fn save_association_settings(
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
pub(crate) fn load_window_sizes(app: AppHandle) -> Result<WindowSizes, String> {
    let path = config_file(&app, "window-sizes.json")?;
    if !path.exists() {
        return Ok(WindowSizes::default());
    }
    let raw = fs::read_to_string(path).map_err(|err| err.to_string())?;
    serde_json::from_str(&raw).map_err(|err| err.to_string())
}

#[tauri::command]
pub(crate) fn save_window_sizes(app: AppHandle, sizes: WindowSizes) -> Result<(), String> {
    let path = config_file(&app, "window-sizes.json")?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|err| err.to_string())?;
    }
    let raw = serde_json::to_string_pretty(&sizes).map_err(|err| err.to_string())?;
    fs::write(path, raw).map_err(|err| err.to_string())
}
