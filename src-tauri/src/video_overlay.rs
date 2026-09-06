//! Floating popup layer above the native video surface.
//!
//! A transparent WebView2 CHILD window cannot alpha-composite over sibling
//! HWNDs: its transparent pixels render opaque (verified 2026-09-06 with a
//! semi-transparent red probe — a solid red slab covered the video). So the
//! popup layer is a separate TRANSPARENT TOP-LEVEL window instead; DWM
//! composites top-level alpha over everything beneath it, including mpv's
//! D3D11 presentation.
//!
//! Lifecycle: created once by `native_video_overlay` (async command, because
//! window creation must not run inside a synchronous IPC handler), kept for
//! the whole app run. It hugs the video rectangle — synced from the mpv host
//! window's own `GetWindowRect`, so no client-area conversion is needed —
//! hides whenever the main window loses focus (an invisible window must not
//! intercept clicks meant for other apps), and is shown WITHOUT activation
//! so interacting with the popup never steals keyboard focus from the main
//! webview.

use tauri::{
    Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use windows_sys::Win32::Foundation::HWND;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, ShowWindow, GWL_EXSTYLE, HWND_TOP,
    SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SW_HIDE, SW_SHOWNOACTIVATE, WS_EX_NOACTIVATE,
};

pub const OVERLAY_LABEL: &str = "video-overlay";

/// Create the overlay window if it does not exist yet, then align it to the
/// active video rectangle. Idempotent; called from a blocking worker, never
/// a synchronous command.
pub fn ensure(app: &tauri::AppHandle) -> Result<(), String> {
    if app.get_webview_window(OVERLAY_LABEL).is_some() {
        return sync(app);
    }
    let main = app.get_window("main").ok_or("主窗口不存在")?;
    let window = WebviewWindowBuilder::new(app, OVERLAY_LABEL, WebviewUrl::App("index.html".into()))
        .transparent(true)
        .decorations(false)
        // A DWM shadow would draw a visible halo around the (otherwise
        // transparent) window rect sitting on top of the video.
        .shadow(false)
        .skip_taskbar(true)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .visible(false)
        .focused(false)
        .build()
        .map_err(|err| format!("创建视频浮层失败：{err}"))?;
    // Clicks on the popup must not deactivate the main window: the overlay
    // hides itself when the main window loses focus, so activation here would
    // close the popup under the pointer. WS_EX_NOACTIVATE keeps mouse input
    // (hover, wheel, slider drags) working without ever taking focus.
    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            let ex = GetWindowLongPtrW(hwnd.0 as HWND, GWL_EXSTYLE);
            SetWindowLongPtrW(hwnd.0 as HWND, GWL_EXSTYLE, ex | WS_EX_NOACTIVATE as isize);
        }
    }
    // Track the main window so the popup stays glued to the video rect and
    // never floats over unrelated content when the app loses focus.
    let hook = app.clone();
    main.on_window_event(move |event| match event {
        // Re-raise on activation: activating the main window would otherwise
        // bury the overlay below it.
        WindowEvent::Focused(true) => {
            let _ = sync(&hook);
        }
        WindowEvent::Focused(false) => hide(&hook),
        // During move/resize the overlay is fully transparent (the popup is
        // not shown), so a few events of lag are invisible.
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            let _ = sync(&hook);
        }
        _ => {}
    });
    eprintln!("[video_overlay] top-level overlay window created");
    sync(app)
}

/// Align the overlay to the active video's screen rectangle and show it
/// (without activation) right above the main window. Hides it when no video
/// session exists.
pub fn sync(app: &tauri::AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window(OVERLAY_LABEL) else {
        return Ok(());
    };
    match crate::native_video::active_video_screen_rect(app) {
        Some((x, y, w, h)) => {
            if let Err(err) = window.set_position(PhysicalPosition::new(x, y)) {
                eprintln!("[video_overlay] set_position({x},{y}): {err}");
            }
            if let Err(err) = window.set_size(PhysicalSize::new(w.max(1) as u32, h.max(1) as u32)) {
                eprintln!("[video_overlay] set_size({w}x{h}): {err}");
            }
            show_no_activate(&window);
            raise_overlay(app, &window);
        }
        None => hide(app),
    }
    Ok(())
}

/// Hide the overlay: an invisible-but-present window would otherwise keep
/// intercepting clicks over whatever is now on the video rectangle.
pub fn hide(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
        if let Ok(hwnd) = window.hwnd() {
            unsafe { ShowWindow(hwnd.0 as HWND, SW_HIDE) };
        }
    }
}

fn show_no_activate(window: &tauri::WebviewWindow) {
    if let Ok(hwnd) = window.hwnd() {
        // SW_SHOWNOACTIVATE, not tauri's show(): ShowWindow(SW_SHOW) would
        // activate the window and steal focus on every popup appearance.
        unsafe { ShowWindow(hwnd.0 as HWND, SW_SHOWNOACTIVATE) };
    }
}

/// Put the overlay at the top of the (non-topmost) z-band so it sits above
/// the main window. NOACTIVATE so the raise itself never steals focus.
///
/// Note the direction: `SetWindowPos(hWndInsertAfter = main)` would place the
/// overlay directly *below* the main window (insert-after semantics), which
/// silently buried the whole popup behind the opaque main window. HWND_TOP is
/// the same raise the mpv window uses; when another app activates it moves
/// above the overlay, and the focus hook hides the overlay anyway.
fn raise_overlay(app: &tauri::AppHandle, overlay: &tauri::WebviewWindow) {
    if let Ok(overlay_hwnd) = overlay.hwnd() {
        unsafe {
            SetWindowPos(
                overlay_hwnd.0 as HWND,
                HWND_TOP,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
        }
    }
}
