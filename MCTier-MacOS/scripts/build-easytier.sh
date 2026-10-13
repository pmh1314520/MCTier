#!/usr/bin/env bash
# macOS adaptation contribution: https://github.com/DNPMBHC/MCTier_macOS
# Original EasyTier and MCTier license notices remain in the repository.
# Build the pinned EasyTier macOS binaries from source.
#
# This script deliberately builds from source instead of downloading an
# unverified macOS release asset. The source revision, target architecture,
# Mach-O file type, version output, and final SHA-256 values are recorded in
# the build log before the files are atomically installed.

set -Eeuo pipefail

EASYTIER_REPO="https://github.com/EasyTier/EasyTier.git"
EASYTIER_COMMIT="88a45d115670631dfe6a05ba192387d615ddb95b"
EASYTIER_VERSION="2.5.0"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

if [[ -d "${HOME}/.cargo/bin" ]]; then
  export PATH="${HOME}/.cargo/bin:${PATH}"
fi

fail() { printf '错误: %s\n' "$*" >&2; exit 1; }
log() { printf '%s\n' "$*"; }

# shellcheck source=scripts/toolchain.sh
source "${SCRIPT_DIR}/toolchain.sh"
mctier_require_macos_toolchain || exit 1

command -v git >/dev/null 2>&1 || fail '缺少 git'
command -v cargo >/dev/null 2>&1 || fail '缺少 Rust cargo。请先安装 rustup 和 stable toolchain。'
command -v rustc >/dev/null 2>&1 || fail '缺少 Rust rustc。请先安装 rustup 和 stable toolchain。'
command -v file >/dev/null 2>&1 || fail '缺少 file 命令'

case "$(uname -m)" in
  arm64)
    TARGET="aarch64-apple-darwin"
    EXPECTED_FILE_PATTERN='Mach-O 64-bit executable arm64'
    ;;
  x86_64)
    TARGET="x86_64-apple-darwin"
    EXPECTED_FILE_PATTERN='Mach-O 64-bit executable x86_64'
    ;;
  *) fail "不支持的 macOS 架构: $(uname -m)" ;;
esac

SOURCE_DIR="${MCTIER_EASYTIER_SOURCE_DIR:-}"
KEEP_SOURCE=0
FORCE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --source)
      [[ -n "${2:-}" ]] || fail '--source 需要目录参数'
      SOURCE_DIR="$2"
      shift 2
      ;;
    --keep-source)
      KEEP_SOURCE=1
      shift
      ;;
    --force)
      FORCE=1
      shift
      ;;
    -h|--help)
      printf '用法: %s [--source <EasyTier源码目录>] [--keep-source] [--force]\n' "$0"
      printf '\n默认从固定 commit 克隆 EasyTier；也可用 MCTIER_EASYTIER_SOURCE_DIR 或 --source 复用本地源码。\n'
      exit 0
      ;;
    *) fail "未知参数: $1" ;;
  esac
done

TARGET_DIR="${ROOT}/src-tauri/resources/binaries/macos/${TARGET}"
if (( FORCE == 0 )) && [[ -x "${TARGET_DIR}/easytier-core" && -x "${TARGET_DIR}/easytier-cli" ]]; then
  log "EasyTier macOS 二进制已存在。使用 --force 可强制重新构建。"
  exit 0
fi

WORK_DIR=""
cleanup() {
  if [[ -n "${WORK_DIR}" && "${KEEP_SOURCE}" -eq 0 ]]; then
    rm -rf -- "${WORK_DIR}"
  fi
}
trap cleanup EXIT

if [[ -z "${SOURCE_DIR}" ]]; then
  WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mctier-easytier.XXXXXX")"
  SOURCE_DIR="${WORK_DIR}/easytier"
  log "克隆 EasyTier 源码: ${EASYTIER_REPO}"
  git clone --filter=blob:none --no-checkout --quiet -- "${EASYTIER_REPO}" "${SOURCE_DIR}"
  git -C "${SOURCE_DIR}" checkout --quiet --detach "${EASYTIER_COMMIT}"
else
  SOURCE_DIR="$(cd -- "${SOURCE_DIR}" && pwd)"
fi

[[ -f "${SOURCE_DIR}/Cargo.toml" ]] || fail "不是 EasyTier workspace: ${SOURCE_DIR}"
actual_commit="$(git -C "${SOURCE_DIR}" rev-parse HEAD)"
[[ "${actual_commit}" == "${EASYTIER_COMMIT}" ]] || fail "EasyTier 源码 commit 不匹配：期望 ${EASYTIER_COMMIT}，实际 ${actual_commit}"

log "EasyTier commit: ${actual_commit}"
log "Rust target: ${TARGET}"

CARGO_TARGET_DIR="${SOURCE_DIR}/target-mctier-macos-${TARGET}"
export CARGO_TARGET_DIR
cargo build --release \
  --manifest-path "${SOURCE_DIR}/Cargo.toml" \
  --package easytier \
  --bin easytier-core \
  --bin easytier-cli

CORE="${CARGO_TARGET_DIR}/release/easytier-core"
CLI="${CARGO_TARGET_DIR}/release/easytier-cli"
[[ -f "${CORE}" ]] || fail "构建产物缺少 easytier-core"
[[ -f "${CLI}" ]] || fail "构建产物缺少 easytier-cli"

for binary in "${CORE}" "${CLI}"; do
  description="$(file -b "${binary}")"
  [[ "${description}" == "${EXPECTED_FILE_PATTERN}" ]] || fail "${binary} 架构或文件类型错误: ${description}"
  chmod 0755 "${binary}"
  version_output="$("${binary}" --version 2>&1)" || fail "${binary} --version 执行失败: ${version_output}"
  [[ "${version_output}" == *"${EASYTIER_VERSION}"* ]] || fail "${binary} 版本输出不匹配: ${version_output}"
  if command -v shasum >/dev/null 2>&1; then
    digest="$(shasum -a 256 "${binary}" | cut -d' ' -f1)"
  else
    digest="$(sha256sum "${binary}" | cut -d' ' -f1)"
  fi
  log "[OK] $(basename "${binary}"): ${description}; ${version_output}; SHA-256 ${digest}"
done

STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mctier-easytier-install.XXXXXX")"
trap 'rm -rf -- "${STAGING_DIR}"; cleanup' EXIT
install -m 0755 -- "${CORE}" "${STAGING_DIR}/easytier-core"
install -m 0755 -- "${CLI}" "${STAGING_DIR}/easytier-cli"
mkdir -p -- "${TARGET_DIR}"
# Publish only after both files were built and verified.
mv -f -- "${STAGING_DIR}/easytier-core" "${TARGET_DIR}/easytier-core"
mv -f -- "${STAGING_DIR}/easytier-cli" "${TARGET_DIR}/easytier-cli"
rmdir -- "${STAGING_DIR}"

log "完成。EasyTier macOS 二进制已安装到: ${TARGET_DIR}"
log "下一步: ./scripts/fetch-binaries.sh"
