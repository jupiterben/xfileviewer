//! Windows-only: forward OLE file drops that land on the libmpv video windows.
//!
//! Why this exists: wry registers its drag-drop handler via `EnumChildWindows`
//! + `RegisterDragDrop` on the child HWNDs that exist when the webview is
//! created (i.e. the WebView2 window). The libmpv host window and mpv's own
//! render child are created *later*, and `DoDragDrop` only consults the drop
//! target registered on the window actually under the cursor — it does not
//! fall through to the WebView2 below. So drops over the video area resolve
//! to unregistered windows and are silently discarded.
//!
//! This module registers an `IDropTarget` on those video windows and replays
//! the dropped paths into the webview as a `video-file-drop` event.

use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;

use tauri::{AppHandle, Emitter};
use windows::core::{implement, Ref, Result as WinResult};
use windows::Win32::Foundation::{HWND, POINTL};
use windows::Win32::System::Com::{
    FORMATETC, IDataObject, STGMEDIUM, DVASPECT_CONTENT, TYMED_HGLOBAL,
};
use windows::Win32::System::Ole::{
    RegisterDragDrop, RevokeDragDrop, ReleaseStgMedium, CF_HDROP, DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_NONE,
    IDropTarget, IDropTarget_Impl,
};
use windows::Win32::System::SystemServices::MODIFIERKEYS_FLAGS;
use windows::Win32::UI::Shell::{DragQueryFileW, HDROP};

// GetData transfers a storage medium, not a WM_DROPFILES handle. OLE must
// honor pUnkForRelease even when the data provider retains the HGLOBAL.
struct OwnedMedium(STGMEDIUM);
impl Drop for OwnedMedium {
    fn drop(&mut self) { unsafe { ReleaseStgMedium(&mut self.0); } }
}

/// Event name the frontend listens on; payload is the dropped paths.
const DROP_EVENT: &str = "video-file-drop";

#[implement(IDropTarget)]
struct DropForwarder {
    app: AppHandle,
}

impl DropForwarder {
    /// Extract file paths from a dropped data object. Returns `None` when the
    /// payload is not a file list (e.g. dragged text), in which case OLE gets
    /// `DROPEFFECT_NONE` and the drop is a no-op.
    fn extract_paths(&self, data_obj: &IDataObject) -> Option<Vec<String>> {
        let format = FORMATETC {
            cfFormat: CF_HDROP.0,
            ptd: std::ptr::null_mut(),
            dwAspect: DVASPECT_CONTENT.0,
            lindex: -1,
            tymed: TYMED_HGLOBAL.0 as u32,
        };
        let medium = OwnedMedium(unsafe { data_obj.GetData(&format) }.ok()?);
        // DragQueryFileW consumes the HGLOBAL handle itself (same convention
        // as WM_DROPFILES wParam); no GlobalLock needed.
        let hdrop = HDROP(unsafe { medium.0.u.hGlobal }.0);
        let mut paths = Vec::new();
        unsafe {
            // 0xFFFFFFFF asks for the item count.
            let count = DragQueryFileW(hdrop, 0xFFFF_FFFF, None);
            for i in 0..count {
                let len = DragQueryFileW(hdrop, i, None) as usize;
                if len == 0 {
                    continue;
                }
                let mut buf = vec![0u16; len + 1];
                DragQueryFileW(hdrop, i, Some(&mut buf));
                paths.push(OsString::from_wide(&buf[..len]).to_string_lossy().into_owned());
            }
        }
        if paths.is_empty() { None } else { Some(paths) }
    }
}

#[allow(non_snake_case)]
impl IDropTarget_Impl for DropForwarder_Impl {
    fn DragEnter(
        &self,
        pdataobj: Ref<'_, IDataObject>,
        _grfkeystate: MODIFIERKEYS_FLAGS,
        _pt: &POINTL,
        pdweffect: *mut DROPEFFECT,
    ) -> WinResult<()> {
        let effect = pdataobj
            .ok()
            .ok()
            .and_then(|data| self.extract_paths(data))
            .map(|_| DROPEFFECT_COPY)
            .unwrap_or(DROPEFFECT_NONE);
        unsafe { *pdweffect = effect };
        Ok(())
    }

    fn DragOver(
        &self,
        _grfkeystate: MODIFIERKEYS_FLAGS,
        _pt: &POINTL,
        pdweffect: *mut DROPEFFECT,
    ) -> WinResult<()> {
        // Only reached after DragEnter accepted; keep advertising copy.
        unsafe { *pdweffect = DROPEFFECT_COPY };
        Ok(())
    }

    fn DragLeave(&self) -> WinResult<()> {
        Ok(())
    }

    fn Drop(
        &self,
        pdataobj: Ref<'_, IDataObject>,
        _grfkeystate: MODIFIERKEYS_FLAGS,
        _pt: &POINTL,
        pdweffect: *mut DROPEFFECT,
    ) -> WinResult<()> {
        unsafe { *pdweffect = DROPEFFECT_COPY };
        if let Ok(data) = pdataobj.ok() {
            // Not extracted during DragEnter (which frees its copy), so pull
            // the paths here; the cursor effect was already advertised.
            if let Some(paths) = self.extract_paths(data) {
                let _ = self.app.emit(DROP_EVENT, paths);
            }
        }
        Ok(())
    }
}

/// Owns one registration for as long as the underlying window lives.
pub struct DropGuard {
    hwnd: HWND,
    // Keeps the COM object alive; OLE holds its own reference but dropping
    // ours first would leave the registration pointing at a dangling object.
    _target: IDropTarget,
}

impl Drop for DropGuard {
    fn drop(&mut self) {
        // The window may already be destroyed (child windows die with the
        // parent); RevokeDragDrop then reports an invalid HWND, which is fine.
        unsafe {
            let _ = RevokeDragDrop(self.hwnd);
        }
    }
}

/// Register the forwarding drop target on `hwnd`. `RevokeDragDrop` first so a
/// stale registration (e.g. re-opened session reusing an HWND) never fails the
/// call with `DRAGDROP_E_ALREADYREGISTERED`.
pub fn register_drop_forwarder(hwnd: HWND, app: AppHandle) -> Result<DropGuard, String> {
    let target: IDropTarget = DropForwarder { app }.into();
    unsafe {
        let _ = RevokeDragDrop(hwnd);
        RegisterDragDrop(hwnd, &target).map_err(|err| format!("无法注册拖放目标：{err}"))?;
    }
    Ok(DropGuard { hwnd, _target: target })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn storage_medium_releases_the_provider_instead_of_its_shared_memory() {
        use std::{ffi::c_void, mem::ManuallyDrop, sync::atomic::{AtomicU32, Ordering}};
        use windows::core::{IUnknown, IUnknown_Vtbl, Interface, GUID, HRESULT};
        use windows::Win32::System::{Com::STGMEDIUM_0, Memory::{GlobalAlloc, GlobalSize, GMEM_MOVEABLE}};

        #[repr(C)]
        struct Provider { vtable: *const IUnknown_Vtbl, releases: AtomicU32 }
        unsafe extern "system" fn query(_: *mut c_void, _: *const GUID, out: *mut *mut c_void) -> HRESULT {
            *out = std::ptr::null_mut();
            HRESULT(0x80004002u32 as i32)
        }
        unsafe extern "system" fn add_ref(_: *mut c_void) -> u32 { 2 }
        unsafe extern "system" fn release(this: *mut c_void) -> u32 {
            (*(this as *mut Provider)).releases.fetch_add(1, Ordering::SeqCst);
            1 // The provider keeps its own reference and owns the allocation.
        }
        let vtable = IUnknown_Vtbl { QueryInterface: query, AddRef: add_ref, Release: release };
        let mut provider = Provider { vtable: &vtable, releases: AtomicU32::new(0) };
        unsafe {
            let memory = GlobalAlloc(GMEM_MOVEABLE, 64).unwrap();
            let owner = IUnknown::from_raw(&mut provider as *mut _ as *mut c_void);
            drop(OwnedMedium(STGMEDIUM {
                tymed: TYMED_HGLOBAL.0 as u32,
                u: STGMEDIUM_0 { hGlobal: memory },
                pUnkForRelease: ManuallyDrop::new(Some(owner)),
            }));
            assert_eq!(provider.releases.load(Ordering::SeqCst), 1);
            assert!(GlobalSize(memory) >= 64, "the provider's memory must stay alive");
            assert!(windows_sys::Win32::Foundation::GlobalFree(memory.0).is_null());
        }
    }

    #[test]
    fn event_name_is_stable() {
        // The frontend listens for this exact name; a rename would silently
        // break drops over the video area, hence the guard.
        assert_eq!(DROP_EVENT, "video-file-drop");
    }
}
