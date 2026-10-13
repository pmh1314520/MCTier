//! macOS 特权启动：EasyTier 必须以 root 运行才能创建 utun 网络接口。
//!
//! macOS 上打开 `com.apple.net.utun_control`、给接口配置地址以及写路由都需要 root，
//! 普通用户进程会直接得到 EPERM，表现为 easytier-core 的
//! `tun device error. err: rust tun error Operation not permitted (os error 1)`，
//! 随后实例退出、创建大厅失败。
//!
//! 这里刻意**不**安装常驻特权守护进程（SMJobBless / SMAppService 需要 Developer ID
//! 签名，而本项目当前分发的是未签名构建）。每次启动 EasyTier 时通过
//! `osascript ... with administrator privileges` 弹出系统授权窗口，由 root 执行一个
//! 短小的监管脚本；监管脚本负责：
//!
//! 1. 把 easytier-core 的 stdout/stderr 重定向到两个 FIFO，父进程照常流式读取，
//!    因此现有的虚拟 IP 解析与日志监控逻辑无需改动；
//! 2. 轮询停止哨兵文件与 MCTier 自身的 PID，两者任一消失就终止 easytier-core。
//!
//! 第 2 点是安全底线：即使 MCTier 崩溃、被强杀或用户直接退出，root 侧也不会留下
//! 孤儿 easytier-core 或无法释放的 utun 接口。
//!
//! 授权窗口由系统弹出，需要用户输入登录密码。注意 macOS 只对"同一进程内已编译的同一个
//! 脚本实例"复用授权缓存，而这里每次启动都是新的 `osascript` 进程 + 新的脚本正文，
//! 因此**每次创建/加入大厅都会弹一次**。要降到一个安装周期只授权一次，只能换成已签名的
//! SMAppService / SMJobBless helper，那需要 Developer ID，超出当前未签名构建的范围。

use std::ffi::CString;
use std::io::Read as _;
use std::os::fd::{AsRawFd, FromRawFd, RawFd};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::process::Stdio;
use std::task::{ready, Context, Poll};

use tokio::io::unix::AsyncFd;
use tokio::io::{AsyncRead, ReadBuf};
use tokio::process::{Child, ChildStderr, Command};

/// root 侧监管脚本。参数顺序与 [`start_elevated`] 拼装的命令行一致，
/// 改动时必须同步。
const SUPERVISOR_SCRIPT: &str = r#"#!/bin/sh
# MCTier macOS 特权监管脚本（由 osascript 以 root 执行）。
# 参数: <stop-file> <app-pid> <stdout-fifo> <stderr-fifo> <working-dir> <command> [args...]
set -u

STOP_FILE="$1"
APP_PID="$2"
OUT_FIFO="$3"
ERR_FIFO="$4"
WORK_DIR="$5"
shift 5

cd "$WORK_DIR" 2>/dev/null || true
rm -f "$STOP_FILE"

"$@" >"$OUT_FIFO" 2>"$ERR_FIFO" &
EASYTIER_PID=$!

# Stop only when requested or when the owning app disappears. Natural EasyTier
# exit must preserve its status so the UI can report a real failure code.
SHOULD_STOP=0
while kill -0 "$EASYTIER_PID" 2>/dev/null; do
  if [ -e "$STOP_FILE" ] || ! kill -0 "$APP_PID" 2>/dev/null; then
    SHOULD_STOP=1
    break
  fi
  sleep 0.3
done

if [ "$SHOULD_STOP" -eq 1 ]; then
  kill -TERM "$EASYTIER_PID" 2>/dev/null
  WAITED=0
  while kill -0 "$EASYTIER_PID" 2>/dev/null && [ "$WAITED" -lt 25 ]; do
    sleep 0.2
    WAITED=$((WAITED + 1))
  done
  kill -KILL "$EASYTIER_PID" 2>/dev/null
  wait "$EASYTIER_PID" 2>/dev/null
  exit 0
fi

wait "$EASYTIER_PID"
exit $?
"#;

/// 一次特权启动留下的状态，用于停止与清理。
///
/// 这里不持有子进程句柄：osascript 子进程统一存放在 `NetworkService::easytier_process`，
/// 由现有 monitor_process 逻辑负责感知退出，本模块只负责哨兵文件与运行目录。
pub struct ElevatedSession {
    pub runtime_dir: PathBuf,
    pub stop_file: PathBuf,
}

/// 特权启动的返回结果。拆开是为了让调用方按现有方式接管各条输出流。
pub struct ElevatedLaunch {
    pub session: ElevatedSession,
    pub process: Child,
    /// easytier-core 的 stdout（FIFO 读取端）
    pub stdout: FifoReader,
    /// easytier-core 的 stderr（FIFO 读取端）
    pub stderr: FifoReader,
    /// osascript 自身的 stderr：授权被取消时这里会出现 "User canceled."
    pub launcher_stderr: Option<ChildStderr>,
}

/// 提权运行目录。必须和 [`crate::modules::app_paths::data_root`] 共用同一个根：
/// 早期版本把它建在 `~/Library/Application Support/MCTier`，于是应用一边把数据迁到
/// `com.mctier.app`，一边又往那个旧目录里写 `privileged/mctier-*/stdout.fifo`。
/// 下次启动时数据迁移会扫到这些 FIFO，而 `open()` 会一直等到出现写端，应用在创建
/// 窗口之前就永久卡住——表现就是双击图标毫无反应。
fn runtime_root() -> PathBuf {
    crate::modules::app_paths::data_root()
        .unwrap_or_else(|_| std::env::temp_dir().join(crate::modules::app_paths::APP_ID))
        .join("privileged")
}

/// 清理上一次运行残留的特权运行目录。
///
/// 同一时刻只允许一个 EasyTier 实例，因此可以直接丢弃旧的 `mctier-*` 目录；
/// 只删除自己创建的命名前缀，避免误删用户放在同级的其它内容。
pub fn prune_stale_runtime_dirs() {
    let root = runtime_root();
    let Ok(entries) = std::fs::read_dir(&root) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if name.starts_with("mctier-") {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

/// 构建 easytier-core 命令行并以管理员权限启动。
///
/// 返回时 root 侧脚本已经开始运行，但授权窗口可能仍等待用户输入密码；
/// 真正的失败（例如用户取消授权）通过 `launcher_stderr` + 子进程退出体现。
pub async fn start_elevated(
    easytier: &Path,
    args: &[String],
    working_dir: &Path,
    tag: &str,
) -> Result<ElevatedLaunch, String> {
    prune_stale_runtime_dirs();

    let runtime_dir = runtime_root().join(tag);
    std::fs::create_dir_all(&runtime_dir)
        .map_err(|e| format!("创建 macOS 特权运行目录失败: {e}"))?;
    std::fs::set_permissions(&runtime_dir, std::fs::Permissions::from_mode(0o700))
        .map_err(|e| format!("设置 macOS 特权运行目录权限失败: {e}"))?;

    let stop_file = runtime_dir.join("stop");
    let _ = std::fs::remove_file(&stop_file);

    let out_fifo = runtime_dir.join("stdout.fifo");
    let err_fifo = runtime_dir.join("stderr.fifo");
    for fifo in [&out_fifo, &err_fifo] {
        let _ = std::fs::remove_file(fifo);
        create_fifo(fifo)?;
    }

    let script_path = runtime_dir.join("supervise.sh");
    std::fs::write(&script_path, SUPERVISOR_SCRIPT)
        .map_err(|e| format!("写入 macOS 特权监管脚本失败: {e}"))?;
    std::fs::set_permissions(&script_path, std::fs::Permissions::from_mode(0o700))
        .map_err(|e| format!("设置 macOS 特权监管脚本权限失败: {e}"))?;

    // 读取端必须先就绪：root 侧的重定向会在打开 FIFO 时阻塞，直到有读者存在。
    let stdout = open_fifo_reader(&out_fifo)?;
    let stderr = open_fifo_reader(&err_fifo)?;

    let mut parts = vec![
        shell_quote(&script_path.to_string_lossy()),
        shell_quote(&stop_file.to_string_lossy()),
        std::process::id().to_string(),
        shell_quote(&out_fifo.to_string_lossy()),
        shell_quote(&err_fifo.to_string_lossy()),
        shell_quote(&working_dir.to_string_lossy()),
        shell_quote(&easytier.to_string_lossy()),
    ];
    parts.extend(args.iter().map(|arg| shell_quote(arg)));
    let command = parts.join(" ");

    let script = format!(
        "do shell script \"{}\" with administrator privileges",
        applescript_escape(&command)
    );

    let mut process = Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(&script)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("无法启动 macOS 管理员授权窗口: {e}"))?;

    log::info!(
        "macOS：已请求管理员授权，由 root 运行 EasyTier（运行目录 {}）",
        runtime_dir.display()
    );

    let launcher_stderr = process.stderr.take();
    Ok(ElevatedLaunch {
        session: ElevatedSession {
            runtime_dir,
            stop_file,
        },
        process,
        stdout,
        stderr,
        launcher_stderr,
    })
}

/// 通知 root 侧监管脚本终止 easytier-core。调用方仍需等待子进程退出后再清理目录。
pub fn mark_stop(session: &ElevatedSession) {
    if let Err(error) = std::fs::write(&session.stop_file, b"stop") {
        log::warn!("写入 macOS 停止哨兵失败: {}", error);
    }
}

/// 不经过 `NetworkService` 锁的停止请求。
///
/// 「取消连接」命令刻意不加锁（start_easytier 在等待期间一直持锁），因此它不能走
/// `stop_easytier`。这里直接给所有活动会话写停止哨兵：easytier-core 现在以 root 运行，
/// 用户态的 `pkill` 根本杀不掉它，而哨兵是由 root 侧脚本自己读的。
///
/// 返回被通知的会话数；没有活动会话时返回 0。
pub fn request_stop_for_all_sessions() -> usize {
    let root = runtime_root();
    let Ok(entries) = std::fs::read_dir(&root) else {
        return 0;
    };
    let mut notified = 0;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if !name.starts_with("mctier-") {
            continue;
        }
        let stop_file = entry.path().join("stop");
        // 只写已经存在的运行目录，不凭空创建会话。
        if entry.path().join("supervise.sh").exists() && std::fs::write(&stop_file, b"stop").is_ok()
        {
            notified += 1;
        }
    }
    if notified > 0 {
        log::info!("已向 {} 个 macOS 特权 EasyTier 会话发送停止请求", notified);
    }
    notified
}

/// 删除本次启动的运行目录（监管脚本、FIFO、停止哨兵）。
///
/// 必须在 osascript 子进程退出之后调用，否则监管脚本可能还没看到停止哨兵。
pub fn cleanup(session: &ElevatedSession) {
    for _ in 0..3 {
        match std::fs::remove_dir_all(&session.runtime_dir) {
            Ok(()) => return,
            Err(error) => {
                log::debug!(
                    "清理 macOS 特权运行目录失败（{}）: {}",
                    session.runtime_dir.display(),
                    error
                );
            }
        }
    }
}

pub(crate) fn create_fifo(path: &Path) -> Result<(), String> {
    let c_path = CString::new(path.as_os_str().as_bytes())
        .map_err(|_| format!("FIFO 路径包含非法字符: {}", path.display()))?;
    // 0600：只有当前用户（以及 root）可以读写，避免其它本地用户注入伪日志。
    let result = unsafe { libc::mkfifo(c_path.as_ptr(), 0o600) };
    if result != 0 {
        return Err(format!(
            "创建 FIFO 失败 {}: {}",
            path.display(),
            std::io::Error::last_os_error()
        ));
    }
    Ok(())
}

/// 打开 FIFO 读取端。
///
/// 先用 `O_NONBLOCK` 拿到 fd（此时还没有写者也必须成功），再交给 tokio 的 reactor
/// 驱动。刻意不用 `tokio::fs::File`：那条路会把每次读取派发到阻塞线程池上，
/// 而"用户取消授权 → 写者永远不会出现"是常见路径，读取会一直停在被占用的阻塞线程上，
/// 反复取消就会不断堆积。走 reactor 时同一个 future 只是安静地挂在事件循环上。
pub(crate) fn open_fifo_reader(path: &Path) -> Result<FifoReader, String> {
    let c_path = CString::new(path.as_os_str().as_bytes())
        .map_err(|_| format!("FIFO 路径包含非法字符: {}", path.display()))?;
    let fd: RawFd = unsafe { libc::open(c_path.as_ptr(), libc::O_RDONLY | libc::O_NONBLOCK) };
    if fd < 0 {
        return Err(format!(
            "打开 FIFO 失败 {}: {}",
            path.display(),
            std::io::Error::last_os_error()
        ));
    }
    let file = unsafe { std::fs::File::from_raw_fd(fd) };
    let registered = AsyncFd::new(file)
        .map_err(|e| format!("注册 FIFO 到事件循环失败 {}: {}", path.display(), e))?;
    Ok(FifoReader { fd: registered })
}

/// 把 FIFO 的读端接到 tokio reactor 上的 `AsyncRead`。
pub struct FifoReader {
    fd: AsyncFd<std::fs::File>,
}

impl AsyncRead for FifoReader {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        loop {
            let mut guard = ready!(self.fd.poll_read_ready(cx))?;
            // try_io 会把 WouldBlock 还原成"继续等下一次可读"，其余错误直接上抛。
            let result = guard.try_io(|inner| {
                let unfilled = buf.initialize_unfilled();
                inner.get_ref().read(unfilled)
            });
            match result {
                Ok(Ok(read)) => {
                    buf.advance(read);
                    // read == 0 表示写端已全部关闭，交给调用方当 EOF 处理。
                    return Poll::Ready(Ok(()));
                }
                Ok(Err(error)) => return Poll::Ready(Err(error)),
                Err(_would_block) => continue,
            }
        }
    }
}

impl AsRawFd for FifoReader {
    fn as_raw_fd(&self) -> RawFd {
        self.fd.as_raw_fd()
    }
}

/// POSIX shell 单引号包裹：参数里的单引号用 `'\''` 转义。
pub(crate) fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

/// 把 shell 命令嵌入 AppleScript 双引号字符串。
///
/// 换行无法出现在 AppleScript 字符串字面量里，出现时直接替换成空格，
/// 避免构造出语法错误、让用户看到一个含义不明的授权弹窗。
pub(crate) fn applescript_escape(command: &str) -> String {
    command
        .replace('\n', " ")
        .replace('\r', " ")
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 提权运行目录必须落在应用数据根之下。它曾经写死在
    /// `~/Library/Application Support/MCTier`，于是每次提权都在旧目录里留下
    /// `privileged/mctier-*/stdout.fifo`，下次启动的数据迁移扫到这些 FIFO 就会
    /// 永久阻塞在 `open()` 上，应用再也打不开。
    #[test]
    fn runtime_root_lives_under_the_app_data_root() {
        let root = runtime_root();
        let data_root = crate::modules::app_paths::data_root().expect("data root");
        assert!(
            root.starts_with(&data_root),
            "提权运行目录 {} 必须位于应用数据根 {} 之下",
            root.display(),
            data_root.display()
        );
        assert_ne!(
            root.parent().and_then(|parent| parent.file_name()),
            Some(std::ffi::OsStr::new("MCTier")),
            "提权运行目录不得写在旧版数据目录 MCTier/ 下"
        );
    }

    #[test]
    fn shell_quote_wraps_and_escapes_single_quotes() {
        assert_eq!(shell_quote("plain"), "'plain'");
        assert_eq!(shell_quote("a b"), "'a b'");
        assert_eq!(shell_quote("it's"), "'it'\\''s'");
        // 反引号与 $ 在单引号内不会被 shell 展开，正是这里要的效果
        assert_eq!(shell_quote("$(rm -rf /)"), "'$(rm -rf /)'");
    }

    #[test]
    fn applescript_escape_keeps_double_quotes_from_ending_the_string() {
        assert_eq!(applescript_escape("say \"hi\""), "say \\\"hi\\\"");
        assert_eq!(applescript_escape("back\\slash"), "back\\\\slash");
        // 换行在 AppleScript 字符串字面量里非法
        assert_eq!(applescript_escape("a\nb"), "a b");
    }

    #[test]
    fn quoting_survives_a_lobby_name_with_quotes() {
        // 大厅名来自用户输入，会作为 --network-name 传给 root 侧脚本。
        let name = "bob's \"lobby\" $(whoami)";
        let quoted = shell_quote(name);
        assert!(quoted.starts_with('\'') && quoted.ends_with('\''));
        assert!(!quoted.contains("bob's"));
        // 再经过 AppleScript 转义后不应留下未转义的双引号
        let script = applescript_escape(&quoted);
        assert!(!script.replace("\\\"", "").contains('"'));
    }

    #[test]
    fn supervisor_preserves_natural_exit_code_and_stops_cleanly() {
        use std::process::Command as StdCommand;
        use std::time::Duration;

        let dir = tempfile::tempdir().expect("temp dir");
        let script = dir.path().join("supervise.sh");
        let stop = dir.path().join("stop");
        let stdout = dir.path().join("stdout");
        let stderr = dir.path().join("stderr");
        std::fs::write(&script, SUPERVISOR_SCRIPT).expect("write supervisor");

        let make_command = |child_args: &[&str]| {
            let mut command = StdCommand::new("/bin/sh");
            command
                .arg(&script)
                .arg(&stop)
                .arg(std::process::id().to_string())
                .arg(&stdout)
                .arg(&stderr)
                .arg(dir.path())
                .args(child_args);
            command
        };

        let status = make_command(&["/bin/sh", "-c", "exit 37"])
            .status()
            .expect("run supervisor");
        assert_eq!(status.code(), Some(37));

        let mut supervisor = make_command(&["/bin/sh", "-c", "sleep 10"])
            .spawn()
            .expect("spawn supervisor");
        std::thread::sleep(Duration::from_millis(500));
        std::fs::write(&stop, b"stop").expect("request stop");
        let status = supervisor.wait().expect("wait for supervisor");
        assert_eq!(status.code(), Some(0));
    }

    /// FIFO 必须"先有读者再打开写者"才能不阻塞，且写者退出后要给读者 EOF，
    /// 否则启动会卡死在授权之后、或者进程退出后监控任务永远挂着。
    #[tokio::test]
    async fn fifo_reader_streams_lines_and_sees_eof() {
        use tokio::io::AsyncBufReadExt;

        let dir = tempfile::tempdir().expect("temp dir");
        let fifo = dir.path().join("stdout.fifo");
        create_fifo(&fifo).expect("mkfifo");
        assert_eq!(
            std::fs::metadata(&fifo).unwrap().permissions().mode() & 0o777,
            0o600
        );

        // 无写者时打开读取端也必须立刻成功。
        let reader = open_fifo_reader(&fifo).expect("open reader");

        let writer_path = fifo.clone();
        let writer = std::thread::spawn(move || {
            use std::io::Write;
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .open(&writer_path)
                .expect("open writer");
            // 与 easytier 的日志形态一致：虚拟 IP 行 + 致命错误行。
            file.write_all(b"ipv4 = 10.126.126.5/24\n").unwrap();
            file.write_all(b"tun device error\n").unwrap();
            file.flush().unwrap();
            // 退出作用域即关闭写端，读者应当看到 EOF。
        });

        let mut lines = tokio::io::BufReader::new(reader).lines();
        let mut collected = Vec::new();
        loop {
            let next = tokio::time::timeout(std::time::Duration::from_secs(5), lines.next_line())
                .await
                .expect("FIFO 读取超时");
            match next.expect("read line") {
                Some(line) => collected.push(line),
                None => break,
            }
        }
        writer.join().expect("writer thread");

        assert_eq!(
            collected,
            vec![
                "ipv4 = 10.126.126.5/24".to_string(),
                "tun device error".to_string()
            ]
        );
    }
}
