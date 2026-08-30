#!/usr/bin/env bash
# MCTier Linux 启动包装脚本。
#
# 直接运行主程序也能用，但在 Debian 家族的默认桌面环境下有几个坑会导致
# "能启动、不能用"。这个包装脚本把这些环境变量收在一处，deb/AppImage 的
# .desktop 也指向它，保证从菜单点开和从终端跑的行为一致。
#
# 用法：
#   ./MCTier-Linux/scripts/run-linux.sh [传给 MCTier 的参数...]
#
# 环境变量：
#   MCTIER_BIN   指定主程序路径（默认在常见安装位置和构建产物目录里找）
#   MCTIER_DEBUG 设为 1 时打开 Rust 日志（等价 RUST_LOG=debug）

set -Eeuo pipefail

fail() { printf '错误: %s\n' "$*" >&2; exit 1; }

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"

find_binary() {
  if [[ -n "${MCTIER_BIN:-}" ]]; then
    [[ -x "$MCTIER_BIN" ]] || fail "MCTIER_BIN 指向的文件不可执行: $MCTIER_BIN"
    printf '%s' "$MCTIER_BIN"
    return 0
  fi
  local candidate
  for candidate in \
    /usr/bin/mctier \
    /usr/local/bin/mctier \
    /opt/mctier/mctier \
    "${DESKTOP_ROOT}/src-tauri/target/release/mctier" \
    "${DESKTOP_ROOT}/src-tauri/target/debug/mctier"
  do
    if [[ -x "$candidate" ]]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

BIN="$(find_binary)" || fail "找不到 MCTier 主程序。请先执行 MCTier-Linux/scripts/build.sh，或用 MCTIER_BIN 指定路径。"

# ---- 输入法 ---------------------------------------------------------------
# fcitx5 / ibus 的 GTK IM 模块在 WebKitGTK 的 <input type="password"> 上会吞掉按键，
# 表现为"密码框打不出字"。清空 GTK_IM_MODULE 让 GTK 走 Wayland 的 text-input-v3
# （或 X11 下的简单输入），中文输入在普通输入框仍然正常。
# 如果你的环境不受影响、且希望在密码框里也用输入法，设 MCTIER_KEEP_IM_MODULE=1 跳过。
if [[ "${MCTIER_KEEP_IM_MODULE:-0}" != "1" ]]; then
  export GTK_IM_MODULE=""
fi

# ---- 图形 -----------------------------------------------------------------
# 主窗口是无边框 + 透明（decorations:false / transparent:true）。部分 AMD/Intel 核显
# 驱动上 WebKitGTK 的 GPU 合成路径会让透明窗口出现黑底或花屏。
# 默认不改动渲染路径（性能更好）；遇到显示异常时用 MCTIER_SOFTWARE_RENDER=1 兜底。
if [[ "${MCTIER_SOFTWARE_RENDER:-0}" == "1" ]]; then
  export WEBKIT_DISABLE_COMPOSITING_MODE=1
  export LIBGL_ALWAYS_SOFTWARE=1
fi

# 自建的 WebKitGTK（开了 ENABLE_WEB_RTC）放在这个目录时自动优先加载，
# 只对本进程生效，不影响系统里其他用 WebKit 的程序。
# 背景：Debian 官方的 webkit2gtk 编译期没开 WebRTC，语音/屏幕共享/远程控制无法启动，
# 详见 MCTier-Linux/README.md 的"已知限制"。
for webkit_dir in "${MCTIER_WEBKIT_LIB_DIR:-}" "$HOME/.local/lib/mctier-webkit" /opt/mctier/webkit/lib; do
  if [[ -n "$webkit_dir" && -d "$webkit_dir" ]]; then
    export LD_LIBRARY_PATH="${webkit_dir}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
    break
  fi
done

# ---- 日志 -----------------------------------------------------------------
if [[ "${MCTIER_DEBUG:-0}" == "1" ]]; then
  export RUST_LOG="${RUST_LOG:-debug}"
  export RUST_BACKTRACE="${RUST_BACKTRACE:-1}"
fi

exec -- "$BIN" "$@"
