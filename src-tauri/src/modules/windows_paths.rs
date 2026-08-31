//! Windows system paths used by privileged and diagnostic operations.

#![cfg(windows)]

use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use std::path::PathBuf;
use windows::Win32::System::SystemInformation::GetSystemDirectoryW;

/// Resolve the actual Windows system directory without consulting PATH or
/// the inherited SystemRoot environment variable.
pub fn system_directory() -> PathBuf {
    let mut buffer = [0u16; 32_768];
    let length = unsafe { GetSystemDirectoryW(Some(&mut buffer)) } as usize;
    assert!(
        length > 0 && length < buffer.len(),
        "GetSystemDirectoryW failed"
    );
    PathBuf::from(OsString::from_wide(&buffer[..length]))
}

/// Resolve a fixed system executable path. Callers pass only compile-time
/// names or paths; reject traversal so this cannot become a path join helper.
pub fn system_command(name: &str) -> PathBuf {
    assert!(
        !name.is_empty()
            && !name.contains('\0')
            && !name.contains("..")
            && !name.starts_with(['\\', '/'])
            && !name.contains(':')
            && !name.contains('*')
            && !name.contains('?'),
        "invalid Windows system path"
    );
    system_directory().join(name)
}

pub fn hosts_path() -> PathBuf {
    system_directory().join("drivers").join("etc").join("hosts")
}
