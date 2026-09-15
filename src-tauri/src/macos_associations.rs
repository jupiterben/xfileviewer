//! Launch Services owns macOS defaults; local preferences are not authoritative.
use std::{ffi::c_void, ptr};

type Ref = *const c_void;
const OUR_ID: &str = "com.xfileviewer.app";
const ALL_ROLES: u32 = u32::MAX;
const UTF8: u32 = 0x08000100;

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFStringCreateWithBytes(
        alloc: Ref,
        bytes: *const u8,
        len: isize,
        encoding: u32,
        external: bool,
    ) -> Ref;
    fn CFStringGetLength(value: Ref) -> isize;
    fn CFStringGetMaximumSizeForEncoding(len: isize, encoding: u32) -> isize;
    fn CFStringGetCString(value: Ref, buffer: *mut u8, size: isize, encoding: u32) -> bool;
    fn CFArrayGetCount(array: Ref) -> isize;
    fn CFArrayGetValueAtIndex(array: Ref, index: isize) -> Ref;
    fn CFRelease(value: Ref);
}

#[link(name = "CoreServices", kind = "framework")]
extern "C" {
    static kUTTagClassFilenameExtension: Ref;
    fn UTTypeCreatePreferredIdentifierForTag(class: Ref, tag: Ref, conforms: Ref) -> Ref;
    fn LSCopyDefaultRoleHandlerForContentType(content: Ref, roles: u32) -> Ref;
    fn LSCopyAllRoleHandlersForContentType(content: Ref, roles: u32) -> Ref;
    fn LSSetDefaultRoleHandlerForContentType(content: Ref, roles: u32, handler: Ref) -> i32;
}

struct Owned(Ref);
impl Drop for Owned {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { CFRelease(self.0) };
        }
    }
}

fn cf_string(value: &str) -> Owned {
    Owned(unsafe {
        CFStringCreateWithBytes(
            ptr::null(),
            value.as_ptr(),
            value.len() as isize,
            UTF8,
            false,
        )
    })
}

// Only call with a CFString reference owned by a live Copy result or array.
unsafe fn string(value: Ref) -> Option<String> {
    if value.is_null() {
        return None;
    }
    let size = CFStringGetMaximumSizeForEncoding(CFStringGetLength(value), UTF8) + 1;
    let mut bytes = vec![0; size as usize];
    if !CFStringGetCString(value, bytes.as_mut_ptr(), size, UTF8) {
        return None;
    }
    let end = bytes.iter().position(|b| *b == 0)?;
    String::from_utf8(bytes[..end].to_vec()).ok()
}

fn content_type(ext: &str) -> Result<Owned, String> {
    let extension = cf_string(&ext.trim_start_matches('.').to_lowercase());
    let content = Owned(unsafe {
        UTTypeCreatePreferredIdentifierForTag(
            kUTTagClassFilenameExtension,
            extension.0,
            ptr::null(),
        )
    });
    if content.0.is_null() {
        Err(format!("无法识别文件类型 .{ext}"))
    } else {
        Ok(content)
    }
}

fn default_handler(content: &Owned) -> Option<String> {
    let handler = Owned(unsafe { LSCopyDefaultRoleHandlerForContentType(content.0, ALL_ROLES) });
    unsafe { string(handler.0) }
}

pub(crate) fn is_ours(ext: &str) -> bool {
    content_type(ext)
        .ok()
        .and_then(|content| default_handler(&content))
        .is_some_and(|id| id.eq_ignore_ascii_case(OUR_ID))
}

fn set_handler(content: &Owned, id: &str) -> Result<(), String> {
    let handler = cf_string(id);
    let status = unsafe { LSSetDefaultRoleHandlerForContentType(content.0, ALL_ROLES, handler.0) };
    if status != 0 {
        return Err(format!(
            "macOS 文件关联失败（{status}），请先将应用安装到“应用程序”文件夹"
        ));
    }
    if !default_handler(content).is_some_and(|current| current.eq_ignore_ascii_case(id)) {
        return Err("macOS 尚未应用此关联，请在 Finder“显示简介 → 打开方式”中确认".into());
    }
    Ok(())
}

pub(crate) fn grant(extensions: &[String]) -> Result<(), String> {
    for ext in extensions {
        set_handler(&content_type(ext)?, OUR_ID)?;
    }
    Ok(())
}

pub(crate) fn revoke(extensions: &[String]) -> Result<(), String> {
    for ext in extensions {
        let content = content_type(ext)?;
        if !default_handler(&content).is_some_and(|id| id.eq_ignore_ascii_case(OUR_ID)) {
            continue;
        }
        let handlers = Owned(unsafe { LSCopyAllRoleHandlersForContentType(content.0, ALL_ROLES) });
        let replacement = if handlers.0.is_null() {
            None
        } else {
            (0..unsafe { CFArrayGetCount(handlers.0) })
                .filter_map(|index| unsafe { string(CFArrayGetValueAtIndex(handlers.0, index)) })
                .find(|id| !id.eq_ignore_ascii_case(OUR_ID))
        };
        let replacement = replacement.ok_or_else(|| {
            format!("没有其他应用可打开 .{ext}，请先在 Finder 中选择其他默认应用")
        })?;
        set_handler(&content, &replacement)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resolves_extensions_and_unicode_strings() {
        assert_eq!(
            unsafe { string(cf_string("中文 空格").0) }.as_deref(),
            Some("中文 空格")
        );
        let jpg = content_type("JPG").unwrap();
        let jpeg = content_type("jpeg").unwrap();
        assert_eq!(unsafe { string(jpg.0) }, unsafe { string(jpeg.0) });
        assert_eq!(unsafe { string(jpg.0) }.as_deref(), Some("public.jpeg"));
    }
}
