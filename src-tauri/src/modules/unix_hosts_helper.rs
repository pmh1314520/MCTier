//! Fixed hosts operation over an anonymous pipe; no user-writable staging file.
use super::hosts_security::{validate_hosts_update, MAX_HOSTS_BYTES};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::OpenOptions;
use std::io::{Read, Seek, SeekFrom, Write};
use std::os::fd::AsRawFd;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::Path;
use std::process::{Command, Stdio};

const SWITCH: &str = "--mctier-write-hosts";

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    expected_sha256: String,
    content: String,
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub fn write_hosts(path: &Path, content: &str) -> Result<(), String> {
    if path != Path::new("/etc/hosts") {
        return Err("refusing non-system hosts path".into());
    }
    let old = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    validate_hosts_update(&old, content)?;
    let request = Request {
        expected_sha256: digest(old.as_bytes()),
        content: content.into(),
    };
    if unsafe { libc::geteuid() } == 0 {
        return apply(&request);
    }
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut child = Command::new("/usr/bin/pkexec")
        .arg(executable)
        .arg(SWITCH)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("unable to start polkit hosts helper: {e}"))?;
    let result = (|| {
        let mut input = child.stdin.take().ok_or("missing helper input")?;
        serde_json::to_writer(&mut input, &request).map_err(|e| e.to_string())?;
        input.flush().map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = child.kill();
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    result?;
    if status.success() {
        Ok(())
    } else {
        Err("hosts authorization cancelled, content changed, or helper validation failed; retry the operation".into())
    }
}

fn apply(request: &Request) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .read(true)
        .write(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open("/etc/hosts")
        .map_err(|e| e.to_string())?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file()
        || metadata.uid() != 0
        || metadata.mode() & 0o022 != 0
        || metadata.len() > MAX_HOSTS_BYTES as u64
    {
        return Err("unsafe system hosts file".into());
    }
    // Keep the same locked descriptor through verification and writing.
    if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
        return Err("hosts is busy".into());
    }
    let mut old = String::new();
    (&mut file)
        .take(MAX_HOSTS_BYTES as u64 + 1)
        .read_to_string(&mut old)
        .map_err(|e| e.to_string())?;
    if digest(old.as_bytes()) != request.expected_sha256 {
        return Err("hosts changed during authorization".into());
    }
    validate_hosts_update(&old, &request.content)?;
    file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    file.write_all(request.content.as_bytes())
        .map_err(|e| e.to_string())?;
    file.set_len(request.content.len() as u64)
        .map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())
}

pub fn run_if_requested() -> bool {
    let args: Vec<_> = std::env::args_os().collect();
    if args.get(1).is_none_or(|arg| arg != SWITCH) {
        return false;
    }
    let result = (|| {
        if args.len() != 2 || unsafe { libc::geteuid() } != 0 {
            return Err("root hosts helper required".into());
        }
        let mut data = Vec::new();
        std::io::stdin()
            .take((MAX_HOSTS_BYTES * 2 + 4096) as u64)
            .read_to_end(&mut data)
            .map_err(|e| e.to_string())?;
        let request: Request = serde_json::from_slice(&data).map_err(|e| e.to_string())?;
        apply(&request)
    })();
    std::process::exit(if result.is_ok() { 0 } else { 1 });
}
