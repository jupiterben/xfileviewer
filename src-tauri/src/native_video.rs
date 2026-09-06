//! libmpv owns decoding and a child HWND; the WebView owns playback controls.
use percent_encoding::{utf8_percent_encode, AsciiSet, CONTROLS};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, ffi::{c_char, c_void, CStr, CString}, path::Path, ptr, sync::Mutex, time::Instant};
use tauri::Manager;
use windows_sys::Win32::{Foundation::*, System::LibraryLoader::GetModuleHandleW, UI::WindowsAndMessaging::*};

use crate::video_drop::{self, DropGuard};

// RFC 3986 path component: unreserved + sub-delims (excluding '#' and '?') + ':' + '@' + '/'.
const PATH_SET: &AsciiSet = &CONTROLS.add(b' ').add(b'"').add(b'#').add(b'$').add(b'%').add(b'&').add(b'\'').add(b'(').add(b')').add(b'*').add(b'+').add(b',').add(b':').add(b';').add(b'<').add(b'=').add(b'>').add(b'?').add(b'[').add(b'\\').add(b']').add(b'^').add(b'`').add(b'{').add(b'|').add(b'}').add(b'~').remove(b'/').remove(b':');

type Handle = *mut c_void;
#[repr(C)]
struct Event { id: i32, error: i32, userdata: u64, data: *mut c_void }
#[repr(C)]
struct EndFile { reason: i32, error: i32 }

struct Api {
    create: unsafe extern "C" fn() -> Handle,
    initialize: unsafe extern "C" fn(Handle) -> i32,
    destroy: unsafe extern "C" fn(Handle),
    option: unsafe extern "C" fn(Handle, *const c_char, *const c_char) -> i32,
    set: unsafe extern "C" fn(Handle, *const c_char, *const c_char) -> i32,
    get: unsafe extern "C" fn(Handle, *const c_char, i32, *mut c_void) -> i32,
    command: unsafe extern "C" fn(Handle, *const *const c_char) -> i32,
    wait: unsafe extern "C" fn(Handle, f64) -> *const Event,
    error: unsafe extern "C" fn(i32) -> *const c_char,
    _library: libloading::Library,
}
impl Api {
    unsafe fn load(path: &Path) -> Result<Self, String> {
        let library = libloading::Library::new(path).map_err(|e| format!("无法加载内置解码器：{e}"))?;
        macro_rules! symbol { ($name:literal) => { *library.get(concat!($name, "\0").as_bytes()).map_err(|e| e.to_string())? }; }
        Ok(Self {
            create: symbol!("mpv_create"), initialize: symbol!("mpv_initialize"),
            destroy: symbol!("mpv_terminate_destroy"), option: symbol!("mpv_set_option_string"),
            set: symbol!("mpv_set_property_string"), get: symbol!("mpv_get_property"),
            command: symbol!("mpv_command"), wait: symbol!("mpv_wait_event"),
            error: symbol!("mpv_error_string"), _library: library,
        })
    }
    fn check(&self, code: i32) -> Result<(), String> {
        if code >= 0 { Ok(()) } else {
            Err(unsafe { CStr::from_ptr((self.error)(code)) }.to_string_lossy().into_owned())
        }
    }
}

struct Player {
    api: Api,
    handle: Handle,
    hwnd: HWND,
    bounds: Bounds,
    ended: bool,
    error: Option<String>,
    last_used: Instant,
    /// OLE drop target on our host window (the video rectangle).
    host_drop: Option<DropGuard>,
    /// OLE drop target on mpv's own render child, registered lazily once the
    /// child window appears (mpv creates it during the first loadfile).
    mpv_drop: Option<DropGuard>,
}
// All access is serialized by NativeVideo. libmpv's client API is thread-safe.
// HWND creation/layout/destruction is performed by synchronous main-thread commands.
unsafe impl Send for Player {}
impl Drop for Player {
    fn drop(&mut self) {
        // Revoke the drop targets while the windows are still alive; the
        // guards would otherwise fire after DestroyWindow.
        self.mpv_drop = None;
        self.host_drop = None;
        unsafe { (self.api.destroy)(self.handle); DestroyWindow(self.hwnd); }
    }
}

/// Register the drop forwarder on mpv's render child window. mpv creates that
/// window asynchronously during the first loadfile, so this is retried from
/// the status/layout polling until it succeeds.
fn register_mpv_child_drop(player: &mut Player, app: &tauri::AppHandle) {
    if player.mpv_drop.is_some() { return; }
    let mut found: Option<HWND> = None;
    unsafe extern "system" fn take_first(hwnd: HWND, lparam: LPARAM) -> windows_sys::core::BOOL {
        let slot = &mut *(lparam as *mut Option<HWND>);
        if slot.is_none() { *slot = Some(hwnd); }
        0 // FALSE: stop enumerating after the first child
    }
    unsafe {
        EnumChildWindows(player.hwnd, Some(take_first), &mut found as *mut _ as LPARAM);
    }
    let Some(child) = found else { return };
    match video_drop::register_drop_forwarder(windows::Win32::Foundation::HWND(child as _), app.clone()) {
        Ok(guard) => player.mpv_drop = Some(guard),
        Err(err) => eprintln!("[native_video] register drop target on mpv child: {err}"),
    }
}
impl Player {
    fn set(&self, name: &str, value: &str, option: bool) -> Result<(), String> {
        let name = CString::new(name).map_err(|e| e.to_string())?;
        let value = CString::new(value).map_err(|e| e.to_string())?;
        self.api.check(unsafe {
            (if option { self.api.option } else { self.api.set })(self.handle, name.as_ptr(), value.as_ptr())
        })
    }
    fn command(&self, args: &[&str]) -> Result<(), String> {
        let strings = args.iter().map(|s| CString::new(*s)).collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        let mut pointers: Vec<_> = strings.iter().map(|s| s.as_ptr()).collect();
        pointers.push(ptr::null());
        self.api.check(unsafe { (self.api.command)(self.handle, pointers.as_ptr()) })
    }
    fn number(&self, name: &str) -> f64 {
        let name = CString::new(name).unwrap();
        let mut value = 0f64;
        let result = unsafe { (self.api.get)(self.handle, name.as_ptr(), 5, &mut value as *mut _ as _) };
        if result >= 0 && value.is_finite() { value } else { 0.0 }
    }
    fn flag(&self, name: &str) -> bool {
        let name = CString::new(name).unwrap();
        let mut value = 0i32;
        unsafe { (self.api.get)(self.handle, name.as_ptr(), 3, &mut value as *mut _ as _); }
        value != 0
    }
    fn events(&mut self) {
        for _ in 0..100 {
            let event = unsafe { &*(self.api.wait)(self.handle, 0.0) };
            if event.id == 0 { break; }
            if event.id == 7 && !event.data.is_null() {
                let end = unsafe { &*(event.data as *const EndFile) };
                if end.reason == 0 { self.ended = true; }
                if end.reason == 4 { self.error = Some(format!("视频解码失败：{}", self.api.check(end.error).err().unwrap_or_else(|| "未知错误".into()))); }
            }
        }
    }
}

/// Hard cap on the number of libmpv instances kept alive at once. The WebView only
/// drives a single active session, but preview/overlay/orphan pipelines can pile up
/// before close() catches up. Exceeding the cap evicts the least-recently-used session.
const MAX_PLAYERS: usize = 4;

#[derive(Default)]
pub struct NativeVideo {
    sessions: Mutex<HashMap<String, Player>>,
    // Only worker threads take this lock; never hold sessions while creating a WebView.
    overlay_init: Mutex<()>,
}
#[derive(Clone, Deserialize)]
pub struct Bounds { pub(crate) x: f64, pub(crate) y: f64, pub(crate) width: f64, pub(crate) height: f64, pub(crate) visible: bool }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot { time: f64, duration: f64, paused: bool, volume: f64, muted: bool, width: f64, height: f64,
    video_width: f64, video_height: f64, ended: bool, error: Option<String> }

fn apply_bounds(hwnd: HWND, bounds: &Bounds) -> Result<(), String> {
    if ![bounds.x, bounds.y, bounds.width, bounds.height].iter().all(|v| v.is_finite() && v.abs() <= 100_000.0) {
        return Err("无效的视频区域".into());
    }
    unsafe {
        SetWindowPos(hwnd, HWND_TOP, bounds.x.round() as i32, bounds.y.round() as i32,
            bounds.width.max(1.0).round() as i32, bounds.height.max(1.0).round() as i32,
            SWP_NOACTIVATE | if bounds.visible && bounds.width > 0.0 && bounds.height > 0.0 { SWP_SHOWWINDOW } else { SWP_HIDEWINDOW });
    }
    Ok(())
}

/// Screen rectangle of the active video's mpv host window, if any session
/// exists. The overlay window aligns itself to this rect — it is a top-level
/// window, so screen coordinates need no client-area conversion.
pub(crate) fn active_video_screen_rect(app: &tauri::AppHandle) -> Option<(i32, i32, i32, i32)> {
    let state = app.try_state::<NativeVideo>()?;
    let guard = state.sessions.lock().ok()?;
    let player = guard.values().next()?;
    let mut rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
    if unsafe { GetWindowRect(player.hwnd, &mut rect) } == 0 { return None; }
    Some((rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top))
}

// Unit-test dummy: LRU logic only needs `last_used`; the rest of the struct
// is irrelevant to eviction. Building a full Player would require loading
// libmpv, so use a tagged-enum wrapper instead.
trait Evictable {
    fn last_used(&self) -> Instant;
}
impl Evictable for Player {
    fn last_used(&self) -> Instant { self.last_used }
}

fn evict_lru_by<K, V: Evictable>(map: &mut HashMap<K, V>)
where
    K: std::hash::Hash + Eq + Clone,
{
    if map.len() <= MAX_PLAYERS { return; }
    let victim = map.iter().min_by_key(|(_, v)| v.last_used()).map(|(k, _)| k.clone());
    if let Some(key) = victim { map.remove(&key); }
}

/// Turn a Windows path into a percent-encoded `file://` URL for libmpv.
///
/// mpv parses the loadfile argument as a URL. The literal sequence `#` would be
/// treated as a fragment delimiter and the rest of the path discarded, so
/// filenames containing `#` (e.g. downloaded clips from Douyin) silently fail
/// to open. Wrap the path in `file://`, normalize backslashes to forward
/// slashes, and percent-encode everything outside the URL-safe set.
fn path_to_mpv_url(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    format!(
        "file:///{}",
        utf8_percent_encode(&normalized, PATH_SET)
    )
}

#[tauri::command]
pub fn native_video_open(window: tauri::Window, state: tauri::State<NativeVideo>, session: String, path: String, bounds: Bounds, volume: f64, muted: bool) -> Result<(), String> {
    // This is a multi-WebView window once video-overlay exists. Injecting
    // WebviewWindow here (or in layout/close) makes Tauri reject subsequent
    // commands with "current webview is not a WebviewWindow".
    if !volume.is_finite() || !(0.0..=1.0).contains(&volume) { return Err("无效音量".into()); }
    crate::media_server::open_media(&path).map_err(|e| e.to_string())?;
    let library = if cfg!(debug_assertions) {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/mpv/libmpv-2.dll")
    } else { window.app_handle().path().resource_dir().map_err(|e| e.to_string())?.join("native/mpv/libmpv-2.dll") };
    let mut guard = state.sessions.lock().map_err(|e| e.to_string())?;
    // Re-opening the same session refreshes the player in place; any other session
    // is replaced so we never leak an mpv instance on the window's child tree.
    guard.remove(&session);
    let api = unsafe { Api::load(&library)? };
    let parent = window.hwnd().map_err(|e| e.to_string())?.0 as HWND;
    let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
    let hwnd = unsafe { CreateWindowExW(WS_EX_NOACTIVATE | WS_EX_TRANSPARENT, class.as_ptr(), ptr::null(),
        WS_CHILD | WS_CLIPCHILDREN | WS_CLIPSIBLINGS | WS_DISABLED, 0, 0, 1, 1, parent, ptr::null_mut(), GetModuleHandleW(ptr::null()), ptr::null()) };
    if hwnd.is_null() { return Err("无法创建视频显示区域".into()); }
    // wry only registered drop targets on the windows that existed at webview
    // creation, so drops over the video rectangle would die on this HWND.
    // Register our forwarder; failure is non-fatal (playback still works).
    let host_drop = match video_drop::register_drop_forwarder(
        windows::Win32::Foundation::HWND(hwnd as _),
        window.app_handle().clone(),
    ) {
        Ok(guard) => Some(guard),
        Err(err) => {
            eprintln!("[native_video] register drop target on host window: {err}");
            None
        }
    };
    let handle = unsafe { (api.create)() };
    if handle.is_null() { unsafe { DestroyWindow(hwnd); } return Err("无法创建解码器".into()); }
    let player = Player { api, handle, hwnd, bounds: bounds.clone(), ended: false, error: None, last_used: Instant::now(), host_drop, mpv_drop: None };
    for (name, value) in [("config", "no"), ("terminal", "no"), ("input-default-bindings", "no"),
        ("input-vo-keyboard", "no"), ("input-cursor", "no"), ("osc", "no"), ("osd-level", "0"),
        ("idle", "yes"), ("keep-open", "yes"), ("hwdec", "auto-safe"), ("vo", "gpu"), ("gpu-api", "d3d11")] {
        player.set(name, value, true)?;
    }
    player.set("wid", &(hwnd as usize as u32).to_string(), true)?;
    player.set("volume", &(volume * 100.0).to_string(), true)?;
    player.set("mute", if muted { "yes" } else { "no" }, true)?;
    player.api.check(unsafe { (player.api.initialize)(handle) })?;
    apply_bounds(hwnd, &bounds)?;
    player.command(&["loadfile", &path_to_mpv_url(&path)])?;
    guard.insert(session, player);
    evict_lru_by(&mut guard);
    Ok(())
}

/// WebView2 creation must originate outside synchronous IPC handlers. HWND
/// and OLE work stays in the synchronous commands on the UI thread.
#[tauri::command]
pub async fn native_video_overlay(app: tauri::AppHandle, session: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<NativeVideo>();
        let _init = state.overlay_init.lock().map_err(|e| e.to_string())?;
        // A fast file switch may have closed the session while the command
        // was in flight; don't create the overlay for a ghost session.
        if !state.sessions.lock().map_err(|e| e.to_string())?.contains_key(&session) {
            return Ok(());
        }
        crate::video_overlay::ensure(&app)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn native_video_layout(window: tauri::Window, state: tauri::State<NativeVideo>, session: String, bounds: Bounds) -> Result<(), String> {
    let has_video = {
        let mut guard = state.sessions.lock().map_err(|e| e.to_string())?;
        match guard.get_mut(&session) {
            Some(player) => {
                apply_bounds(player.hwnd, &bounds)?;
                player.bounds = bounds.clone();
                true
            }
            None => false,
        }
    };
    // Outside the sessions lock: sync re-locks it internally (non-reentrant)
    // and may also run from window-event hooks on this same thread.
    if has_video {
        let _ = crate::video_overlay::sync(window.app_handle());
    }
    Ok(())
}
#[tauri::command]
pub fn native_video_close(window: tauri::Window, state: tauri::State<NativeVideo>, session: String) -> Result<(), String> {
    let result = close_session(&state.sessions, &session);
    // Keep one reusable WebView. A stale close must not hide a newer session,
    // and closing during asynchronous creation must not race its label reuse.
    if state.sessions.lock().map_err(|e| e.to_string())?.is_empty() {
        crate::video_overlay::hide(window.app_handle());
    }
    result
}

fn close_session(state: &Mutex<HashMap<String, Player>>, session: &str) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    if guard.remove(session).is_none() { return Err("会话不存在".into()); }
    Ok(())
}
#[tauri::command]
pub fn native_video_control(state: tauri::State<NativeVideo>, session: String, paused: Option<bool>, volume: Option<f64>, muted: Option<bool>, time: Option<f64>) -> Result<(), String> {
    let mut guard = state.sessions.lock().map_err(|e| e.to_string())?;
    let Some(player) = guard.get_mut(&session) else { return Err("会话不存在".into()); };
    player.last_used = Instant::now();
    if let Some(v) = volume { if !v.is_finite() || !(0.0..=1.0).contains(&v) { return Err("无效音量".into()); } player.set("volume", &(v * 100.0).to_string(), false)?; }
    if let Some(v) = muted { player.set("mute", if v { "yes" } else { "no" }, false)?; }
    if let Some(v) = time { if !v.is_finite() || v < 0.0 { return Err("无效播放位置".into()); } player.command(&["seek", &v.to_string(), "absolute+exact"])?; player.ended = false; }
    if let Some(v) = paused { player.set("pause", if v { "yes" } else { "no" }, false)?; }
    Ok(())
}
#[tauri::command]
pub fn native_video_status(app: tauri::AppHandle, state: tauri::State<NativeVideo>, session: String) -> Result<Option<Snapshot>, String> {
    let mut guard = state.sessions.lock().map_err(|e| e.to_string())?;
    let Some(player) = guard.get_mut(&session) else { return Ok(None); };
    player.last_used = Instant::now();
    register_mpv_child_drop(player, &app);
    player.events();
    Ok(Some(Snapshot { time: player.number("time-pos"), duration: player.number("duration"),
        paused: player.flag("pause"), volume: player.number("volume") / 100.0, muted: player.flag("mute"),
        width: player.number("dwidth"), height: player.number("dheight"),
        video_width: player.number("width"), video_height: player.number("height"),
        ended: player.ended || player.flag("eof-reached"), error: player.error.clone() }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> NativeVideo { NativeVideo::default() }

    #[test]
    fn evict_lru_is_a_noop_under_capacity() {
        struct Stub(Instant);
        impl Evictable for Stub {
            fn last_used(&self) -> Instant { self.0 }
        }
        let mut map: HashMap<&str, Stub> = HashMap::new();
        map.insert("only".into(), Stub(Instant::now()));
        evict_lru_by(&mut map);
        assert!(map.contains_key("only"));
    }

    /// Filling the map past the cap MUST drop entries in age order, even
    /// when only the *first* insertion is too old. Belt-and-braces check
    /// against the previous "exactly MAX" under-capacity assertion.
    #[test]
    fn evict_lru_trims_when_over_capacity() {
        struct Stub(Instant);
        impl Evictable for Stub {
            fn last_used(&self) -> Instant { self.0 }
        }
        let now = Instant::now();
        let mut map: HashMap<usize, Stub> = HashMap::new();
        for (i, age) in [60, 50, 40, 30, 20].iter().enumerate() {
            map.insert(i, Stub(now - std::time::Duration::from_secs(*age)));
        }
        assert_eq!(map.len(), 5);
        evict_lru_by(&mut map);
        assert_eq!(map.len(), MAX_PLAYERS);
        // The oldest entry (60s) is gone; the four most-recent remain.
        assert!(!map.contains_key(&0));
        for i in 1..5 {
            assert!(map.contains_key(&i));
        }
    }

    #[test]
    fn close_returns_error_when_session_missing() {
        // Validates that the backend distinguishes "stale destroy after reopen"
        // from a normal close. The frontend swallows the error in destroy().
        let state = store();
        let result = close_session(&state.sessions, "ghost");
        assert!(result.is_err());
    }

    #[test]
    fn path_to_mpv_url_encodes_hash_in_filename() {
        // Douyin downloads often contain '#' in the filename. Without encoding
        // mpv would treat '#' as a fragment delimiter and discard the rest.
        let url = path_to_mpv_url(r"Y:\NewG\douyin\济南最后的深情\2026\当我意识到00后也开始对口型 #简约日常穿搭 #越素越帅 #简约穿搭分享 #简约干净 #简约氛围感_7666671267526130338.mp4");
        assert!(url.starts_with("file:///Y:/"));
        assert!(!url.contains("对口型 "), "raw text after '#' would leak through: {url}");
        assert!(url.contains("%E5%8F%A3"), "first three UTF-8 bytes of '口' should appear: {url}");
        // No unescaped '#' survives anywhere in the URL body.
        let body = &url["file://".len()..];
        assert!(!body.contains('#'), "raw '#' must be percent-encoded: {url}");
    }

    #[test]
    fn path_to_mpv_url_normalizes_separators() {
        let url = path_to_mpv_url(r"C:\videos\clip.mp4");
        assert_eq!(url, "file:///C:/videos/clip.mp4");
    }

    #[test]
    fn path_to_mpv_url_handles_spaces_and_unicode() {
        let url = path_to_mpv_url(r"D:\Movies\假期 2026\旅行.mp4");
        assert!(url.starts_with("file:///D:/"));
        assert!(url.contains("%E5%81%87%E6%9C%9F"));
        assert!(url.contains("%20"));
    }
}
