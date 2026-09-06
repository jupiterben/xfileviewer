use std::{ffi::OsString, io, path::PathBuf};

pub struct Entry {
    pub path: PathBuf,
    pub name: OsString,
    pub is_file: bool,
}

#[cfg(not(windows))]
pub fn read_dir(dir: &str) -> io::Result<impl Iterator<Item = io::Result<Entry>>> {
    Ok(std::fs::read_dir(dir)?.map(|entry| {
        let entry = entry?;
        let path = entry.path();
        let kind = entry.file_type()?;
        Ok(Entry {
            name: entry.file_name(),
            is_file: kind.is_file() || (kind.is_symlink() && path.is_file()),
            path,
        })
    }))
}

#[cfg(windows)]
pub use windows::read_dir;

#[cfg(windows)]
mod windows {
    use super::*;
    use std::{
        mem::MaybeUninit,
        os::windows::ffi::{OsStrExt, OsStringExt},
    };
    use windows_sys::Win32::{
        Foundation::{ERROR_NO_MORE_FILES, HANDLE, INVALID_HANDLE_VALUE},
        Storage::FileSystem::{
            FindClose, FindExInfoBasic, FindExInfoStandard, FindExSearchNameMatch,
            FindFirstFileExW, FindNextFileW, GetDriveTypeW, FILE_ATTRIBUTE_DIRECTORY,
            FINDEX_INFO_LEVELS, FIND_FIRST_EX_LARGE_FETCH, WIN32_FIND_DATAW,
        },
        System::WindowsProgramming::DRIVE_REMOTE,
    };

    pub struct ReadDir {
        handle: HANDLE,
        dir: PathBuf,
        first: Option<WIN32_FIND_DATAW>,
        finished: bool,
    }

    impl Drop for ReadDir {
        fn drop(&mut self) {
            // SAFETY: this iterator uniquely owns a valid search handle.
            unsafe {
                FindClose(self.handle);
            }
        }
    }

    fn open_with_fallback<T>(
        mut open: impl FnMut(FINDEX_INFO_LEVELS, u32) -> io::Result<T>,
    ) -> io::Result<T> {
        // Retry the working SMB mode once, then try the default enumeration
        // modes. Do not retry permission errors or nonexistent paths.
        let modes = [
            (FindExInfoBasic, FIND_FIRST_EX_LARGE_FETCH),
            (FindExInfoBasic, FIND_FIRST_EX_LARGE_FETCH),
            (FindExInfoBasic, 0),
            (FindExInfoStandard, 0),
        ];
        for (index, (info, flags)) in modes.into_iter().enumerate() {
            match open(info, flags) {
                Ok(value) => return Ok(value),
                Err(err) => {
                    let retryable = matches!(err.raw_os_error(), Some(50 | 87 | 267 | -2146893818));
                    if !retryable || index == modes.len() - 1 {
                        return Err(err);
                    }
                    // Mapped network drives (SMB) can fail all four modes when the
                    // session is briefly renegotiating; a short backoff between
                    // attempts gives the redirector time to recover instead of
                    // burning through every mode inside the same failure window.
                    if !cfg!(test) {
                        std::thread::sleep(std::time::Duration::from_millis(
                            200 * u64::from(index as u16) + 200,
                        ));
                    }
                }
            }
        }
        unreachable!()
    }

    pub fn read_dir(dir: &str) -> io::Result<ReadDir> {
        let directory = std::path::absolute(dir)?;
        let pattern = directory.join("*");
        let mut wide: Vec<u16> = pattern.as_os_str().encode_wide().collect();
        if wide.contains(&0) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "directory contains NUL",
            ));
        }
        // Preserve support for long drive and UNC paths without resolving SMB
        // metadata through canonicalize().
        // The `\\?\` prefix is NOT reliable for mapped network drive letters
        // (e.g. `\\?\Y:\...` where Y: is an SMB share) — the redirector cannot
        // resolve the final server path and the call fails with
        // ERROR_DIRECTORY (267). Ask the OS whether this drive is remote and
        // skip the prefix for mapped drives; true UNC inputs keep the
        // `\\?\UNC\` form, which is always safe.
        if wide.len() >= 260 && !wide.starts_with(&[92, 92, 63, 92]) {
            let is_remote_drive = wide.len() >= 2
                && wide[1] == b':' as u16
                && {
                    let root = [wide[0], wide[1], b'\\' as u16, 0];
                    unsafe { GetDriveTypeW(root.as_ptr()) == DRIVE_REMOTE }
                };
            if !is_remote_drive {
                wide = if wide.starts_with(&[92, 92]) {
                    [vec![92, 92, 63, 92, 85, 78, 67, 92], wide[2..].to_vec()].concat()
                } else {
                    [vec![92, 92, 63, 92], wide].concat()
                };
            }
        }
        wide.push(0);
        // LARGE_FETCH succeeds on the macOS SMB directories where the default
        // FindNextFileW enumeration returns NTE_BAD_SIGNATURE (0x80090006).
        let (handle, data) = open_with_fallback(|info, flags| {
            let mut data = MaybeUninit::<WIN32_FIND_DATAW>::uninit();
            // SAFETY: wide is NUL-terminated and data points to writable storage.
            let handle = unsafe {
                FindFirstFileExW(
                    wide.as_ptr(),
                    info,
                    data.as_mut_ptr().cast(),
                    FindExSearchNameMatch,
                    std::ptr::null(),
                    flags,
                )
            };
            if handle == INVALID_HANDLE_VALUE {
                let err = io::Error::last_os_error();
                eprintln!("[directory] FindFirstFileExW pattern={pattern:?}, info={info}, flags={flags}, error={err}");
                return Err(err);
            }
            eprintln!("[directory] opened pattern={pattern:?}, info={info}, flags={flags}");
            // SAFETY: FindFirstFileExW succeeded and initialized data.
            Ok((handle, unsafe { data.assume_init() }))
        })?;
        Ok(ReadDir {
            handle,
            dir: directory,
            first: Some(data),
            finished: false,
        })
    }

    impl Iterator for ReadDir {
        type Item = io::Result<Entry>;

        fn next(&mut self) -> Option<Self::Item> {
            if self.finished {
                return None;
            }
            loop {
                let data = if let Some(first) = self.first.take() {
                    first
                } else {
                    let mut data = MaybeUninit::<WIN32_FIND_DATAW>::uninit();
                    // SAFETY: the search handle is live and data is writable.
                    if unsafe { FindNextFileW(self.handle, data.as_mut_ptr()) } == 0 {
                        let error = io::Error::last_os_error();
                        self.finished = true;
                        return if error.raw_os_error() == Some(ERROR_NO_MORE_FILES as i32) {
                            None
                        } else {
                            Some(Err(error))
                        };
                    }
                    // SAFETY: FindNextFileW succeeded and initialized data.
                    unsafe { data.assume_init() }
                };
                let len = data
                    .cFileName
                    .iter()
                    .position(|c| *c == 0)
                    .unwrap_or(data.cFileName.len());
                let name = OsString::from_wide(&data.cFileName[..len]);
                if name == "." || name == ".." {
                    continue;
                }
                return Some(Ok(Entry {
                    path: self.dir.join(&name),
                    name,
                    is_file: data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY == 0,
                }));
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn retries_transient_directory_error_then_uses_compatible_mode() {
            let mut attempts = Vec::new();
            let result = open_with_fallback(|info, flags| {
                attempts.push((info, flags));
                if flags != 0 {
                    Err(io::Error::from_raw_os_error(267))
                } else {
                    Ok(42)
                }
            });
            assert_eq!(result.unwrap(), 42);
            assert_eq!(
                attempts,
                vec![
                    (FindExInfoBasic, 2),
                    (FindExInfoBasic, 2),
                    (FindExInfoBasic, 0)
                ]
            );
        }

        #[test]
        fn persistent_failure_is_bounded_and_permission_errors_are_not_retried() {
            for (code, expected_attempts) in [(267, 4), (5, 1), (3, 1)] {
                let mut attempts = 0;
                let result: io::Result<()> = open_with_fallback(|_, _| {
                    attempts += 1;
                    Err(io::Error::from_raw_os_error(code))
                });
                assert_eq!(result.unwrap_err().raw_os_error(), Some(code));
                assert_eq!(attempts, expected_attempts);
            }
        }
    }
}
