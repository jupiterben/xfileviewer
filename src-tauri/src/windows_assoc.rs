use std::path::Path;

pub fn prog_id(ext: &str) -> String {
    format!(
        "xfileviewer.{}",
        ext.trim_start_matches('.').to_ascii_lowercase()
    )
}

pub fn is_ours(prog_id: &str) -> bool {
    let p = prog_id.trim().to_ascii_lowercase();
    p == "xfileviewer"
        || p == "com.xfileviewer.app"
        || p.starts_with("xfileviewer.")
        || p.starts_with("com.xfileviewer.app.")
}

pub fn open_command(exe: &Path) -> String {
    format!("\"{}\" \"%1\"", exe.display())
}

#[cfg(windows)]
pub fn association_is_ours(ext: &str) -> bool {
    read_effective_prog_id(ext).is_some_and(|id| is_ours(&id))
}

#[cfg(windows)]
pub fn grant(extensions: &[String]) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|err| err.to_string())?;
    let mut failed = Vec::new();
    for ext in extensions {
        let ext = ext.trim_start_matches('.').to_ascii_lowercase();
        if let Err(err) = grant_one(&exe, &ext) {
            failed.push(format!(".{ext}: {err}"));
        }
    }
    notify_assoc_changed();
    if failed.is_empty() {
        Ok(())
    } else {
        open_default_apps_settings();
        Err(failed.join("; "))
    }
}

#[cfg(windows)]
pub fn revoke(extensions: &[String]) -> Result<(), String> {
    let mut failed = Vec::new();
    for ext in extensions {
        let ext = ext.trim_start_matches('.').to_ascii_lowercase();
        if let Err(err) = revoke_one(&ext) {
            failed.push(format!(".{ext}: {err}"));
        }
    }
    notify_assoc_changed();
    if failed.is_empty() {
        Ok(())
    } else {
        open_default_apps_settings();
        Err(failed.join("; "))
    }
}

#[cfg(windows)]
fn grant_one(exe: &Path, ext: &str) -> Result<(), String> {
    let pid = prog_id(ext);
    backup_current(ext)?;
    write_prog_id(exe, ext, &pid)?;
    set_hkcu_ext_default(ext, &pid)?;
    if !association_is_ours(ext) {
        return Err("系统仍使用其他默认程序，已打开 Windows 默认应用设置".into());
    }
    Ok(())
}

#[cfg(windows)]
fn revoke_one(ext: &str) -> Result<(), String> {
    restore_or_clear_ext(ext)?;
    delete_our_prog_id(ext);
    if association_is_ours(ext) {
        return Err("请在 Windows 默认应用设置中取消 xfileviewer".into());
    }
    Ok(())
}

#[cfg(windows)]
fn read_effective_prog_id(ext: &str) -> Option<String> {
    let dotted = format!(".{}", ext.trim_start_matches('.').to_ascii_lowercase());
    read_user_choice(&dotted)
        .or_else(|| read_classes_default(true, &dotted))
        .or_else(|| read_classes_default(false, &dotted))
}

#[cfg(windows)]
fn read_user_choice(dotted: &str) -> Option<String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let path = format!(
        r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\{dotted}\UserChoice"
    );
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu.open_subkey(path).ok()?;
    key.get_value("ProgId").ok()
}

#[cfg(windows)]
fn read_classes_default(hkcu: bool, dotted: &str) -> Option<String> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;
    let root = if hkcu {
        RegKey::predef(HKEY_CURRENT_USER)
    } else {
        RegKey::predef(HKEY_LOCAL_MACHINE)
    };
    let key = root
        .open_subkey(format!(r"Software\Classes\{dotted}"))
        .ok()?;
    key.get_value("").ok()
}

#[cfg(windows)]
fn backup_current(ext: &str) -> Result<(), String> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE};
    use winreg::RegKey;
    if let Some(current) = read_effective_prog_id(ext) {
        if !is_ours(&current) {
            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
            let (bak, _) = hkcu
                .create_subkey_with_flags(r"Software\xfileviewer\AssocBackup", KEY_READ | KEY_WRITE)
                .map_err(|err| err.to_string())?;
            bak.set_value(ext, &current).map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}

#[cfg(windows)]
fn write_prog_id(exe: &Path, ext: &str, pid: &str) -> Result<(), String> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE};
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu
        .create_subkey_with_flags(format!(r"Software\Classes\{pid}"), KEY_READ | KEY_WRITE)
        .map_err(|err| err.to_string())?;
    key.set_value("", &format!("{} File", ext.to_ascii_uppercase()))
        .map_err(|err| err.to_string())?;
    let (cmd, _) = key
        .create_subkey_with_flags(r"shell\open\command", KEY_READ | KEY_WRITE)
        .map_err(|err| err.to_string())?;
    cmd.set_value("", &open_command(exe))
        .map_err(|err| err.to_string())?;

    if let Some(name) = exe.file_name().and_then(|n| n.to_str()) {
        let (types, _) = hkcu
            .create_subkey_with_flags(
                format!(r"Software\Classes\Applications\{name}\SupportedTypes"),
                KEY_READ | KEY_WRITE,
            )
            .map_err(|err| err.to_string())?;
        types
            .set_value(format!(".{ext}"), &String::new())
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

#[cfg(windows)]
fn set_hkcu_ext_default(ext: &str, pid: &str) -> Result<(), String> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE};
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let dotted = format!(".{ext}");
    let (key, _) = hkcu
        .create_subkey_with_flags(format!(r"Software\Classes\{dotted}"), KEY_READ | KEY_WRITE)
        .map_err(|err| err.to_string())?;
    key.set_value("", &pid).map_err(|err| err.to_string())?;
    let (owp, _) = key
        .create_subkey_with_flags("OpenWithProgids", KEY_READ | KEY_WRITE)
        .map_err(|err| err.to_string())?;
    owp.set_value(pid, &String::new())
        .map_err(|err| err.to_string())?;
    Ok(())
}

#[cfg(windows)]
fn restore_or_clear_ext(ext: &str) -> Result<(), String> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE, KEY_WRITE};
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let dotted = format!(".{ext}");
    let backup = hkcu
        .open_subkey(r"Software\xfileviewer\AssocBackup")
        .ok()
        .and_then(|key| key.get_value::<String, _>(ext).ok());
    if let Ok(key) = hkcu.open_subkey_with_flags(
        format!(r"Software\Classes\{dotted}"),
        KEY_READ | KEY_SET_VALUE | KEY_WRITE,
    ) {
        if let Some(prev) = backup {
            key.set_value("", &prev).map_err(|err| err.to_string())?;
        } else if key
            .get_value::<String, _>("")
            .ok()
            .is_some_and(|current| is_ours(&current))
        {
            let _ = key.delete_value("");
        }
        if let Ok(owp) = key.open_subkey_with_flags("OpenWithProgids", KEY_SET_VALUE) {
            let _ = owp.delete_value(prog_id(ext));
        }
    }
    if let Ok(bak) = hkcu.open_subkey_with_flags(r"Software\xfileviewer\AssocBackup", KEY_SET_VALUE)
    {
        let _ = bak.delete_value(ext);
    }
    Ok(())
}

#[cfg(windows)]
fn delete_our_prog_id(ext: &str) {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let _ = hkcu.delete_subkey_all(format!(r"Software\Classes\{}", prog_id(ext)));
}

#[cfg(windows)]
fn notify_assoc_changed() {
    #[link(name = "shell32")]
    extern "system" {
        fn SHChangeNotify(event: i32, flags: u32, item1: isize, item2: isize);
    }
    const SHCNE_ASSOCCHANGED: i32 = 0x0800_0000;
    const SHCNF_IDLIST: u32 = 0;
    unsafe {
        SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, 0, 0);
    }
}

#[cfg(windows)]
fn open_default_apps_settings() {
    let _ = std::process::Command::new("explorer")
        .arg("ms-settings:defaultapps")
        .spawn();
}
