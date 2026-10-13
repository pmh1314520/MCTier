#!/usr/bin/env bash
# Prepare verified EasyTier Mach-O binaries for a macOS build.
#
# EasyTier v2.5.0 does not have a verified macOS asset in this repository's
# release metadata. This script intentionally does not download Linux ELF
# binaries or guess an upstream URL. Place binaries built from the pinned
# EasyTier source into the target directory, then run this script to validate
# their Mach-O headers and executable permissions.

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
ARCH="$(uname -m)"
case "${ARCH}" in
  arm64) TARGET="aarch64-apple-darwin" ;;
  x86_64) TARGET="x86_64-apple-darwin" ;;
  *) printf '错误: 不支持的 macOS 架构: %s\n' "${ARCH}" >&2; exit 1 ;;
esac

TARGET_DIR="${ROOT}/src-tauri/resources/binaries/macos/${TARGET}"
CORE="${TARGET_DIR}/easytier-core"
CLI="${TARGET_DIR}/easytier-cli"

fail() { printf '错误: %s\n' "$*" >&2; exit 1; }

[[ -f "${CORE}" ]] || fail "缺少 ${CORE}。请先从已审计的 EasyTier 源码构建 macOS 二进制。"
[[ -f "${CLI}" ]] || fail "缺少 ${CLI}。请先从已审计的 EasyTier 源码构建 macOS 二进制。"
command -v file >/dev/null 2>&1 || fail "需要 macOS file 命令"

for binary in "${CORE}" "${CLI}"; do
  description="$(file -b "${binary}")"
  case "${description}" in
    "Mach-O 64-bit executable arm64") [[ "${TARGET}" == "aarch64-apple-darwin" ]] || fail "${binary} 架构不是 ${TARGET}" ;;
    "Mach-O 64-bit executable x86_64") [[ "${TARGET}" == "x86_64-apple-darwin" ]] || fail "${binary} 架构不是 ${TARGET}" ;;
    *) fail "${binary} 不是目标架构的可执行 Mach-O 文件: ${description}" ;;
  esac
  version_output="$("${binary}" --version 2>&1)" || fail "${binary} --version 执行失败"
  [[ "${version_output}" == *"2.5.0"* ]] || fail "${binary} EasyTier 版本不是 2.5.0: ${version_output}"
  chmod 0755 "${binary}"
  printf '[OK] %s: %s; %s\n' "${binary}" "${description}" "${version_output}"
done

printf '\nmacOS EasyTier 二进制已就位: %s\n' "${TARGET_DIR}"
printf '下一步: MCTIER_MACOS_EASYTIER_READY=1 MCTIER_MACOS_EASYTIER_ARCH=%s ./scripts/build.sh\n' "${TARGET}"
