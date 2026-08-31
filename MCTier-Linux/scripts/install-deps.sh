#!/usr/bin/env bash
# 安装 MCTier Linux 版的构建与运行依赖（Debian 家族：Debian / Ubuntu / Deepin / UOS / Mint）。
#
# 只装必要的东西，不做任何系统配置改动（不动防火墙、不加软件源、不改内核参数）。
# 需要 root 才能装包，因此内部用 sudo；脚本本身请以普通用户执行。

set -Eeuo pipefail

fail() { printf '错误: %s\n' "$*" >&2; exit 1; }
log()  { printf '%s\n' "$*"; }

command -v apt-get >/dev/null 2>&1 \
  || fail "本脚本仅适用于 Debian 家族（需要 apt-get）。其他发行版请参考 MCTier-Linux/README.md 手动安装等价依赖。"

if [[ "${EUID}" -eq 0 ]]; then
  SUDO=""
else
  command -v sudo >/dev/null 2>&1 || fail "需要 sudo 或以 root 运行"
  SUDO="sudo"
fi

# 构建期依赖：Tauri 2 在 Linux 上需要 WebKitGTK + GTK3；
# 运行期依赖：polkit（pkexec 授权）、libcap2-bin（setcap/getcap）、PipeWire 的 PulseAudio 兼容层。
BUILD_PACKAGES=(
  build-essential
  curl
  wget
  file
  unzip
  pkg-config
  libssl-dev
  libgtk-3-dev
  librsvg2-dev
  patchelf
)

RUNTIME_PACKAGES=(
  # pkexec：给 easytier 二进制授予 TUN 能力时弹图形授权框
  policykit-1
  # setcap / getcap
  libcap2-bin
  # parec：采集系统回环音频（PipeWire 经 pipewire-pulse 兼容层提供）
  pulseaudio-utils
  # 托盘图标
  libayatana-appindicator3-1
  # xdg-open：Tauri 的 shell 插件在 Linux 上靠它打开外部链接（官网、赞助商页等）。
  # 缺失时点击链接不会报错，只是静默无反应，属于最难自查的一类问题。
  xdg-utils
)

# WebKitGTK 的包名随发行版版本变化：新版是 4.1（libsoup3），旧版是 4.0（libsoup2）。
# Tauri 2 默认对应 4.1，两者都探测一遍，取存在的那个。
pick_webkit() {
  local candidate
  for candidate in libwebkit2gtk-4.1-dev libwebkit2gtk-4.0-dev; do
    if apt-cache show "$candidate" >/dev/null 2>&1; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

pick_appindicator() {
  local candidate
  for candidate in libayatana-appindicator3-dev libappindicator3-dev; do
    if apt-cache show "$candidate" >/dev/null 2>&1; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

log "正在刷新软件包索引 ..."
$SUDO apt-get update

WEBKIT_PKG="$(pick_webkit)" || fail "找不到 libwebkit2gtk-4.1-dev 或 libwebkit2gtk-4.0-dev，请检查软件源是否完整"
log "WebKitGTK 开发包: ${WEBKIT_PKG}"

APPINDICATOR_PKG="$(pick_appindicator)" \
  || { log "警告: 找不到 appindicator 开发包，托盘图标可能不可用"; APPINDICATOR_PKG=""; }

log "正在安装依赖 ..."
# shellcheck disable=SC2086
$SUDO apt-get install -y \
  "${BUILD_PACKAGES[@]}" \
  "${RUNTIME_PACKAGES[@]}" \
  "${WEBKIT_PKG}" \
  ${APPINDICATOR_PKG}

log ""
log "系统依赖安装完成。"
log ""

# Rust / Node 不用 apt 装：apt 里的版本通常过旧（Tauri 2 需要 rustc 1.77+、Node 20+）。
# 这里只做检测和提示，不擅自往用户系统里装工具链。
missing=0
if command -v cargo >/dev/null 2>&1; then
  log "已检测到 Rust: $(cargo --version)"
else
  log "缺少 Rust 工具链。请执行:"
  log "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
  missing=1
fi

if command -v node >/dev/null 2>&1; then
  log "已检测到 Node: $(node --version)"
  node_major="$(node --version | sed 's/^v//' | cut -d. -f1)"
  if (( node_major < 20 )); then
    log "警告: Node ${node_major} 过旧，构建前端需要 20 及以上版本"
    missing=1
  fi
else
  log "缺少 Node.js（需要 20 及以上）。建议使用 nvm 安装:"
  log "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && nvm install 22"
  missing=1
fi

log ""
if (( missing )); then
  log "请先补齐上面提示的工具链，然后执行:"
else
  log "依赖齐备。接下来执行:"
fi
log "  ./MCTier-Linux/scripts/fetch-binaries.sh"
log "  ./MCTier-Linux/scripts/build.sh"
