#!/usr/bin/env bash
# macOS adaptation contribution: https://github.com/DNPMBHC/MCTier_macOS
# Original MCTier author and license notices remain in the repository root.
# Build the macOS desktop app. The script validates the native EasyTier inputs
# before invoking Tauri, so a Linux ELF can never be silently bundled as macOS.

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT}"

# rustup installs cargo outside the non-login shell PATH used by Finder and
# CI runners. Prefer that standard location when it exists.
if [[ -d "${HOME}/.cargo/bin" ]]; then
  export PATH="${HOME}/.cargo/bin:${PATH}"
fi

DEBUG=0
NO_BUNDLE=0
UI_ONLY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --debug) DEBUG=1; shift ;;
    --no-bundle) NO_BUNDLE=1; shift ;;
    --ui-only) UI_ONLY=1; shift ;;
    -h|--help)
      printf '用法: %s [--debug] [--no-bundle] [--ui-only]\n' "$0"
      exit 0
      ;;
    *) printf '错误: 未知参数: %s\n' "$1" >&2; exit 1 ;;
  esac
done

fail() { printf '错误: %s\n' "$*" >&2; exit 1; }
command -v node >/dev/null 2>&1 || fail '缺少 Node.js'
command -v npm >/dev/null 2>&1 || fail '缺少 npm'
command -v cargo >/dev/null 2>&1 || fail '缺少 Rust cargo。请先安装 rustup 和 stable toolchain。'
command -v rustc >/dev/null 2>&1 || fail '缺少 Rust rustc。请先安装 rustup 和 stable toolchain。'
# shellcheck source=scripts/toolchain.sh
source "${SCRIPT_DIR}/toolchain.sh"
mctier_require_macos_toolchain || exit 1
# 3.8.0 起聊天图片优化依赖 turbojpeg-sys，它在 macOS 上从源码构建，需要 cmake。
command -v cmake >/dev/null 2>&1 || fail '缺少 cmake（turbojpeg-sys 需要从源码构建）。请先执行 brew install cmake。'

case "$(uname -m)" in
  arm64) TARGET="aarch64-apple-darwin" ;;
  x86_64) TARGET="x86_64-apple-darwin" ;;
  *) fail "不支持的 macOS 架构: $(uname -m)" ;;
esac

BINARY_DIR="${ROOT}/src-tauri/resources/binaries/macos/${TARGET}"
if (( UI_ONLY == 0 )); then
  if [[ ! -x "${BINARY_DIR}/easytier-core" || ! -x "${BINARY_DIR}/easytier-cli" ]]; then
    printf 'EasyTier macOS 二进制缺失，开始从固定源码构建。\n'
    bash "${SCRIPT_DIR}/build-easytier.sh"
  fi
  for binary in easytier-core easytier-cli; do
    path="${BINARY_DIR}/${binary}"
    [[ -f "${path}" ]] || fail "缺少 ${path}。请先运行 scripts/build-easytier.sh，或使用 --ui-only 构建不含组网资源的 UI 包。"
    description="$(file -b "${path}")"
    case "${description}" in
      *Mach-O*executable*|*Mach-O*64-bit*) ;;
      *) fail "${path} 不是 Mach-O 可执行文件: ${description}" ;;
    esac
  done
  bash "${SCRIPT_DIR}/fetch-binaries.sh"
else
  printf '警告: --ui-only 只验证 macOS UI/app bundle，不包含 EasyTier 组网能力。\n'
fi

MACOS_CONFIG="${ROOT}/src-tauri/tauri.macos.conf.json"
[[ -f "${MACOS_CONFIG}" ]] || fail "缺少 macOS Tauri 配置: ${MACOS_CONFIG}"
TAURI_MACOS_CONFIG_ARGS=(--config "${MACOS_CONFIG}")

export MCTIER_MACOS_EASYTIER_READY=1
export MCTIER_MACOS_EASYTIER_ARCH="${TARGET}"

npm ci
npm run build
npm test
(cd src-tauri && cargo test --lib)

if (( NO_BUNDLE )); then
  if (( DEBUG )); then
    npm run tauri -- build --debug --no-bundle "${TAURI_MACOS_CONFIG_ARGS[@]}"
  else
    npm run tauri -- build --no-bundle "${TAURI_MACOS_CONFIG_ARGS[@]}"
  fi
elif (( DEBUG )); then
  npm run tauri -- build --debug --bundles app "${TAURI_MACOS_CONFIG_ARGS[@]}"
else
  npm run tauri -- build --bundles dmg "${TAURI_MACOS_CONFIG_ARGS[@]}"
fi

printf '\nmacOS 构建完成，产物位于 src-tauri/target/。\n'
printf '未签名/未公证构建仅用于本机验证；正式分发需要 Developer ID 签名和 notarization。\n'
