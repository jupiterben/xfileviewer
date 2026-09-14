#[derive(serde::Serialize)]
pub struct MenuChromeOffset {
    pub x: f64,
    pub y: f64,
}

/// Origin of the window's content widget in the native window's coordinate
/// space. muda's GTK `popup_at_rect` is GdkWindow-relative and that window
/// includes the CSD header; HTML `clientX/Y` start at the WebView.
#[tauri::command]
pub fn menu_popup_chrome_offset(
    current: tauri::Window,
    app: tauri::AppHandle,
    label: Option<String>,
) -> Result<MenuChromeOffset, String> {
    #[cfg(target_os = "linux")]
    {
        use gtk::prelude::*;
        use tauri::Manager;
        let window = match label.as_deref() {
            Some(name) => app
                .get_window(name)
                .ok_or_else(|| format!("窗口不存在：{name}"))?,
            None => current,
        };
        let gtk_window = window.gtk_window().map_err(|e| e.to_string())?;
        let Some(child) = gtk_window.child() else {
            return Ok(MenuChromeOffset { x: 0.0, y: 0.0 });
        };
        let (x, y) = child
            .translate_coordinates(&gtk_window, 0, 0)
            .unwrap_or_else(|| {
                let alloc = child.allocation();
                (alloc.x(), alloc.y())
            });
        Ok(MenuChromeOffset {
            x: f64::from(x),
            y: f64::from(y),
        })
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (current, app, label);
        Ok(MenuChromeOffset { x: 0.0, y: 0.0 })
    }
}

/// Ask the OS for applications supporting this file type, without changing associations.
#[tauri::command]
pub fn choose_file_application(window: tauri::Window, path: String) -> Result<(), String> {
    if !std::path::Path::new(&path).is_file() {
        return Err("文件不存在或不是普通文件".into());
    }
    #[cfg(target_os = "linux")]
    {
        use gtk::prelude::*;
        let parent = window.gtk_window().map_err(|e| e.to_string())?;
        let file = gtk::gio::File::for_path(path);
        let dialog = gtk::AppChooserDialog::new(Some(&parent), gtk::DialogFlags::MODAL, &file);
        dialog.set_title("使用其他程序打开");
        dialog.connect_response(move |dialog, response| {
            if response == gtk::ResponseType::Ok {
                if let Some(app) = dialog.app_info() {
                    if let Err(error) = app.launch(&[file.clone()], None::<&gtk::gio::AppLaunchContext>) {
                        let alert = gtk::MessageDialog::new(Some(dialog), gtk::DialogFlags::MODAL,
                            gtk::MessageType::Error, gtk::ButtonsType::Close, &error.to_string());
                        alert.run();
                        alert.close();
                    }
                }
            }
            dialog.close();
        });
        dialog.show_all();
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        let _ = window;
        std::process::Command::new("rundll32.exe")
            .arg("shell32.dll,OpenAs_RunDLL").arg(path)
            .spawn().map(|_| ()).map_err(|e| e.to_string())
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        let _ = (window, path);
        Err("当前系统暂不支持程序选择器".into())
    }
}
