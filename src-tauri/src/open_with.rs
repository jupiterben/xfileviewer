//! Enumerate applications that can open a file and launch one of them,
//! without changing the system's default association.

#[derive(serde::Serialize, Clone)]
pub struct OpenWithApp {
    /// Stable identifier used to launch the app later (executable path or
    /// shell handler name on Windows, desktop-file id on Linux).
    pub id: String,
    /// Human-readable application name.
    pub name: String,
    /// PNG data URL of the application icon, when one could be resolved.
    pub icon: Option<String>,
}

/// True when the handler's executable is this application itself — listing
/// "open with me" inside the viewer is useless. Matches the canonical path,
/// falling back to the (distinctive) executable file name so a dev build
/// still filters out an installed copy registered as the handler.
#[cfg(any(windows, target_os = "linux"))]
fn is_self_executable(candidate: &std::path::Path) -> bool {
    let Ok(exe) = std::env::current_exe() else {
        return false;
    };
    if let (Ok(a), Ok(b)) = (candidate.canonicalize(), exe.canonicalize()) {
        if a == b {
            return true;
        }
    }
    match (candidate.file_name(), exe.file_name()) {
        (Some(a), Some(b)) => a.eq_ignore_ascii_case(b),
        _ => false,
    }
}

#[cfg(windows)]
mod windows_impl {
    use super::OpenWithApp;
    use base64::Engine;
    use windows::core::{HSTRING, PWSTR};
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, BITMAP, BITMAPINFO,
        BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
    };
    use windows::Win32::System::Com::{
        CoInitializeEx, CoTaskMemFree, CoUninitialize, IBindCtx, IDataObject,
        COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{
        IAssocHandler, SHAssocEnumHandlers, SHCreateItemFromParsingName, SHDefExtractIconW,
        ASSOC_FILTER_RECOMMENDED, BHID_DataObject, IShellItem,
    };
    use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, HICON, ICONINFO};

    /// The shell association APIs are COM-based and apartment-sensitive; run
    /// them on a dedicated STA thread instead of whichever runtime thread the
    /// command lands on.
    pub fn with_com<T: Send + 'static>(
        f: impl FnOnce() -> Result<T, String> + Send + 'static,
    ) -> Result<T, String> {
        std::thread::spawn(move || unsafe {
            let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let result = f();
            if hr.is_ok() {
                CoUninitialize();
            }
            result
        })
        .join()
        .map_err(|_| "枚举程序的线程异常退出".to_string())?
    }

    unsafe fn take_string(value: PWSTR) -> String {
        let text = value.to_string().unwrap_or_default();
        CoTaskMemFree(Some(value.0 as _));
        text
    }

    fn extension_filter(path: &str) -> Result<HSTRING, String> {
        let ext = std::path::Path::new(path)
            .extension()
            .and_then(|ext| ext.to_str())
            .ok_or_else(|| "该文件没有扩展名，无法查询关联程序".to_string())?;
        Ok(HSTRING::from(format!(".{ext}")))
    }

    /// Pixels of the icon's color bitmap as top-down RGBA, plus its size.
    unsafe fn icon_rgba(icon: HICON) -> Option<(Vec<u8>, u32)> {
        let mut info = ICONINFO::default();
        GetIconInfo(icon, &mut info).ok()?;
        // Both bitmaps must be released regardless of the outcome below.
        let color = info.hbmColor;
        let mask = info.hbmMask;
        let result = (|| {
            let mut bitmap = BITMAP::default();
            if GetObjectW(
                color.into(),
                std::mem::size_of::<BITMAP>() as i32,
                Some(&mut bitmap as *mut _ as *mut _),
            ) == 0
            {
                return None;
            }
            let (width, height) = (bitmap.bmWidth, bitmap.bmHeight);
            if width <= 0 || height <= 0 || width != height || width > 256 {
                return None;
            }
            let hdc = CreateCompatibleDC(None);
            if hdc.is_invalid() {
                return None;
            }
            let mut bmi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: width,
                    biHeight: -height, // negative: top-down rows
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut pixels = vec![0u8; (width * height * 4) as usize];
            let lines = GetDIBits(
                hdc,
                color,
                0,
                height as u32,
                Some(pixels.as_mut_ptr() as *mut _),
                &mut bmi,
                DIB_RGB_COLORS,
            );
            let _ = DeleteDC(hdc);
            if lines == 0 {
                return None;
            }
            // BGRA -> RGBA. Legacy icons carry no alpha channel at all; making
            // them fully opaque beats rendering an invisible icon.
            if pixels.chunks_exact(4).all(|px| px[3] == 0) {
                for px in pixels.chunks_exact_mut(4) {
                    px[3] = 255;
                }
            }
            for px in pixels.chunks_exact_mut(4) {
                px.swap(0, 2);
            }
            Some((pixels, width as u32))
        })();
        let _ = DeleteObject(color.into());
        let _ = DeleteObject(mask.into());
        result
    }

    fn encode_png(pixels: &[u8], size: u32) -> Option<Vec<u8>> {
        let mut buffer = Vec::new();
        let mut encoder = png::Encoder::new(&mut buffer, size, size);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().ok()?;
        writer.write_image_data(pixels).ok()?;
        writer.finish().ok()?;
        Some(buffer)
    }

    fn handler_icon(handler: &IAssocHandler) -> Option<String> {
        unsafe {
            let mut location = PWSTR::null();
            let mut index = 0i32;
            handler.GetIconLocation(&mut location, &mut index).ok()?;
            let location = take_string(location);
            if location.is_empty() {
                return None;
            }
            let mut icon = HICON::default();
            // LOWORD of the size argument is the "large" icon edge in pixels.
            if SHDefExtractIconW(
                &HSTRING::from(location),
                index,
                0,
                Some(&mut icon),
                None,
                32,
            )
            .is_err()
            {
                return None;
            }
            if icon.is_invalid() {
                return None;
            }
            let rgba = icon_rgba(icon);
            let _ = DestroyIcon(icon);
            let (pixels, size) = rgba?;
            let png = encode_png(&pixels, size)?;
            Some(format!(
                "data:image/png;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(png)
            ))
        }
    }

    fn for_each_handler(
        path: &str,
        mut visit: impl FnMut(&IAssocHandler, String, String) -> Result<bool, String>,
    ) -> Result<(), String> {
        let ext = extension_filter(path)?;
        unsafe {
            let enumerator = SHAssocEnumHandlers(&ext, ASSOC_FILTER_RECOMMENDED)
                .map_err(|e| e.to_string())?;
            loop {
                let mut slot: [Option<IAssocHandler>; 1] = [None];
                let mut fetched = 0u32;
                let _ = enumerator.Next(&mut slot, Some(&mut fetched));
                if fetched == 0 {
                    break;
                }
                let Some(handler) = slot[0].take() else { break };
                let id = handler.GetName().map(|n| take_string(n)).unwrap_or_default();
                let name = handler
                    .GetUIName()
                    .map(|n| take_string(n))
                    .unwrap_or_default();
                if id.is_empty() {
                    continue;
                }
                if !visit(&handler, id, name)? {
                    break;
                }
            }
        }
        Ok(())
    }

    pub fn list(path: String) -> Result<Vec<OpenWithApp>, String> {
        with_com(move || {
            let mut apps = Vec::new();
            for_each_handler(&path, |handler, id, name| {
                if super::is_self_executable(std::path::Path::new(&id)) {
                    return Ok(true);
                }
                if !apps.iter().any(|app: &OpenWithApp| app.id == id) {
                    let name = if name.is_empty() { id.clone() } else { name };
                    let icon = handler_icon(handler);
                    apps.push(OpenWithApp { id, name, icon });
                }
                Ok(true)
            })?;
            Ok(apps)
        })
    }

    pub fn open(path: String, app_id: String) -> Result<(), String> {
        with_com(move || {
            let mut launched = false;
            for_each_handler(&path.clone(), |handler, id, _| {
                if id != app_id {
                    return Ok(true);
                }
                unsafe {
                    let item: IShellItem =
                        SHCreateItemFromParsingName(&HSTRING::from(path.as_str()), None::<&IBindCtx>)
                            .map_err(|e| e.to_string())?;
                    let data: IDataObject = item
                        .BindToHandler(None::<&IBindCtx>, &BHID_DataObject)
                        .map_err(|e| e.to_string())?;
                    handler.Invoke(&data).map_err(|e| e.to_string())?;
                }
                launched = true;
                Ok(false)
            })?;
            if launched {
                Ok(())
            } else {
                Err("未找到该程序，可能已被卸载".into())
            }
        })
    }
}

#[cfg(target_os = "linux")]
mod linux_impl {
    use super::OpenWithApp;
    use gtk::gio;
    use gtk::prelude::*;

    fn content_type(path: &str) -> String {
        let (ctype, _uncertain) = gio::functions::content_type_guess(Some(path), &[]);
        ctype.to_string()
    }

    pub fn list(path: String) -> Result<Vec<OpenWithApp>, String> {
        let ctype = content_type(&path);
        Ok(gio::AppInfo::recommended_for_type(&ctype)
            .into_iter()
            .filter(|app| !super::is_self_executable(&app.executable()))
            .filter_map(|app| {
                Some(OpenWithApp {
                    id: app.id()?.to_string(),
                    name: app.display_name().to_string(),
                    // Themed-icon lookup needs GTK's main-thread icon theme;
                    // the frontend falls back to a letter avatar.
                    icon: None,
                })
            })
            .collect())
    }

    pub fn open(path: String, app_id: String) -> Result<(), String> {
        let ctype = content_type(&path);
        let app = gio::AppInfo::recommended_for_type(&ctype)
            .into_iter()
            .find(|app| app.id().is_some_and(|id| id == app_id.as_str()))
            .ok_or_else(|| "未找到该程序，可能已被卸载".to_string())?;
        app.launch(
            &[gio::File::for_path(&path)],
            None::<&gio::AppLaunchContext>,
        )
        .map_err(|e| e.to_string())
    }
}

/// List applications the OS recommends for opening this file.
#[tauri::command]
pub async fn list_open_with_apps(path: String) -> Result<Vec<OpenWithApp>, String> {
    if !std::path::Path::new(&path).is_file() {
        return Err("文件不存在或不是普通文件".into());
    }
    #[cfg(windows)]
    // The Windows impl joins a dedicated STA thread and extracts shell icons,
    // which can block for seconds (worse on network drives). Keep it off the
    // async runtime's worker threads and away from the main thread entirely.
    return tauri::async_runtime::spawn_blocking(move || windows_impl::list(path))
        .await
        .map_err(|err| err.to_string())?;
    #[cfg(target_os = "linux")]
    return linux_impl::list(path);
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        let _ = path;
        Err("当前系统暂不支持列出关联程序".into())
    }
}

/// Open the file with one of the applications returned by
/// `list_open_with_apps`, identified by its `id`.
#[tauri::command]
pub async fn open_file_with(path: String, app_id: String) -> Result<(), String> {
    if !std::path::Path::new(&path).is_file() {
        return Err("文件不存在或不是普通文件".into());
    }
    #[cfg(windows)]
    return tauri::async_runtime::spawn_blocking(move || windows_impl::open(path, app_id))
        .await
        .map_err(|err| err.to_string())?;
    #[cfg(target_os = "linux")]
    return linux_impl::open(path, app_id);
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        let _ = (path, app_id);
        Err("当前系统暂不支持指定程序打开".into())
    }
}
