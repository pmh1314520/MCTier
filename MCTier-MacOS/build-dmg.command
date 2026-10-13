#!/usr/bin/env bash
# MCTier macOS one-click DMG builder.
# macOS adaptation contribution: https://github.com/DNPMBHC/MCTier_macOS
# Original MCTier author and license notices remain in the repository root.

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${SCRIPT_DIR}"
cd "${ROOT}"

if [[ -d "${HOME}/.cargo/bin" ]]; then
  export PATH="${HOME}/.cargo/bin:${PATH}"
fi

TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"
LOG_DIR="${SCRIPT_DIR}/build-logs"
LOG_FILE="${LOG_DIR}/build-${TIMESTAMP}.log"
mkdir -p -- "${LOG_DIR}"
exec > >(tee -a "${LOG_FILE}") 2>&1

pause_on_exit() {
  local status=$?
  if [[ "${status}" -eq 0 ]]; then
    printf '\nDMG 构建成功。日志: %s\n' "${LOG_FILE}"
  else
    printf '\nDMG 构建失败（退出码 %s）。日志: %s\n' "${status}" "${LOG_FILE}" >&2
  fi
  if [[ -t 0 && "${MCTIER_NO_PAUSE:-0}" != "1" ]]; then
    read -r -p '按回车键关闭窗口...' _ || true
  fi
  exit "${status}"
}
trap pause_on_exit EXIT

fail() {
  printf '错误: %s\n' "$*" >&2
  return 1
}

command -v xcrun >/dev/null 2>&1 || fail '缺少 Xcode Command Line Tools，请运行 xcode-select --install'
command -v node >/dev/null 2>&1 || fail '缺少 Node.js'
command -v npm >/dev/null 2>&1 || fail '缺少 npm'
command -v cargo >/dev/null 2>&1 || fail '缺少 Rust cargo，请安装 rustup stable toolchain'
command -v rustc >/dev/null 2>&1 || fail '缺少 Rust rustc，请安装 rustup stable toolchain'
command -v protoc >/dev/null 2>&1 || fail '缺少 protoc，请运行 brew install protobuf'

printf 'MCTier macOS DMG 构建开始\n'
printf '仓库: %s\n' "${ROOT}"
printf '架构: %s\n' "$(uname -m)"
printf '日志: %s\n\n' "${LOG_FILE}"

bash "${SCRIPT_DIR}/scripts/build.sh"

DMG_DIR="${ROOT}/src-tauri/target/release/bundle/dmg"
shopt -s nullglob
DMGS=("${DMG_DIR}"/*.dmg)
shopt -u nullglob
(( ${#DMGS[@]} > 0 )) || fail "未找到 DMG 产物: ${DMG_DIR}"

DMG="${DMGS[0]}"
[[ -s "${DMG}" ]] || fail "DMG 产物为空: ${DMG}"

printf '\nDMG 构建完成:\n%s\n' "${DMG}"
printf '文件大小: %s 字节\n' "$(stat -f '%z' "${DMG}")"
printf '打开产物目录:\nopen "%s"\n' "${DMG_DIR}"
