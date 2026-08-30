#!/usr/bin/env bash
# 获取 MCTier Linux 构建所需的 EasyTier 二进制，并校验 SHA-256。
#
# resource_manager.rs 在 Linux 上通过 include_bytes! 内嵌
# resources/binaries/linux/{easytier-core,easytier-cli}。这两个文件不入库
# （与 Windows 侧同样的理由：第三方产物、体积大、许可另计），因此 clone 后
# 必须先跑本脚本，否则 cargo build 会因找不到文件而失败。
#
# 与 Windows 的 scripts/fetch-binaries.ps1 同源：同一个 EasyTier Release
# （v2.5.0 / commit 88a45d115670631dfe6a05ba192387d615ddb95b），保证双端
# 用的是同一份组网实现，不会出现"Windows 能连 Linux 连不上"的版本错配。
#
# 用法：
#   ./scripts/fetch-binaries.sh          # 已存在且校验通过则跳过
#   ./scripts/fetch-binaries.sh --force  # 强制重新下载

set -Eeuo pipefail

EASYTIER_VERSION="v2.5.0"
ARCHIVE="easytier-linux-x86_64-${EASYTIER_VERSION}.zip"
URL="https://github.com/EasyTier/EasyTier/releases/download/${EASYTIER_VERSION}/${ARCHIVE}"

# 压缩包本身的 SHA-256。先校验整包再解压，避免把未经校验的内容交给 unzip。
ARCHIVE_SHA256="C715D62FFCDAD2578BC5D743BDFBCFE02CDA9C12F80BD1BAD3B36D4D7FC0EB8B"

# 解压后各文件的 SHA-256（大写）。任何不匹配都中止，避免被篡改的依赖流入构建。
CORE_SHA256="F1BD60BE7A50DA84F50732ED4B826B70284C84F05DADBD3FE448429DFE184322"
CLI_SHA256="E339AEA31943F0C5CED2A5A6ECDD675DA3BB25843CF847107744E656F8200838"

MAX_ARCHIVE_BYTES=$((128 * 1024 * 1024))

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# MCTier-Linux/scripts -> MCTier-Linux -> MCTier桌面应用
DESKTOP_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
TARGET_DIR="${DESKTOP_ROOT}/src-tauri/resources/binaries/linux"

FORCE=0
if [[ "${1:-}" == "--force" ]]; then FORCE=1; fi

log()  { printf '%s\n' "$*"; }
fail() { printf '错误: %s\n' "$*" >&2; exit 1; }

sha256_of() {
  # 不同发行版的工具名不同，两个都试
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -- "$1" | cut -d' ' -f1 | tr 'a-f' 'A-F'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 -- "$1" | cut -d' ' -f1 | tr 'a-f' 'A-F'
  else
    fail "需要 sha256sum 或 shasum 来校验依赖完整性"
  fi
}

verify_file() {
  local path="$1" expected="$2"
  [[ -f "$path" ]] || return 1
  [[ "$(sha256_of "$path")" == "$expected" ]]
}

# 已就位且校验通过就直接返回，避免每次构建都重新下载 20MB
if [[ "$FORCE" -eq 0 ]] \
  && verify_file "${TARGET_DIR}/easytier-core" "$CORE_SHA256" \
  && verify_file "${TARGET_DIR}/easytier-cli" "$CLI_SHA256"; then
  log "EasyTier Linux 二进制已存在且 SHA-256 校验通过，无需下载。"
  log "如需强制重新获取，请使用 --force。"
  exit 0
fi

command -v unzip >/dev/null 2>&1 || fail "需要 unzip（Debian/Ubuntu: sudo apt install unzip）"

WORK_DIR="$(mktemp -d)"
cleanup() { rm -rf -- "$WORK_DIR"; }
trap cleanup EXIT

log "正在下载 EasyTier ${EASYTIER_VERSION} ..."
log "  ${URL}"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL --max-filesize "$MAX_ARCHIVE_BYTES" --proto '=https' --tlsv1.2 \
    -o "${WORK_DIR}/${ARCHIVE}" -- "$URL" || fail "下载失败"
elif command -v wget >/dev/null 2>&1; then
  wget -q --https-only -O "${WORK_DIR}/${ARCHIVE}" -- "$URL" || fail "下载失败"
else
  fail "需要 curl 或 wget"
fi

actual_size="$(stat -c %s -- "${WORK_DIR}/${ARCHIVE}")"
if (( actual_size > MAX_ARCHIVE_BYTES )); then
  fail "压缩包超过大小上限（${actual_size} 字节）"
fi
log "  下载完成: ${actual_size} 字节"

actual_archive_sha="$(sha256_of "${WORK_DIR}/${ARCHIVE}")"
if [[ "$actual_archive_sha" != "$ARCHIVE_SHA256" ]]; then
  fail "压缩包 SHA-256 不匹配：期望 ${ARCHIVE_SHA256}，实际 ${actual_archive_sha}。已中止，请勿使用未校验的二进制构建。"
fi
log "  压缩包校验通过"

# 只解出需要的两个条目。-j 丢弃目录结构，配合固定的目标文件名，
# 压缩包里即使含 ../ 之类的路径也无法写到目标目录之外。
unzip -j -o -q -- "${WORK_DIR}/${ARCHIVE}" \
  "easytier-linux-x86_64/easytier-core" \
  "easytier-linux-x86_64/easytier-cli" \
  -d "${WORK_DIR}/extracted" || fail "解压失败"

for entry in easytier-core:"$CORE_SHA256" easytier-cli:"$CLI_SHA256"; do
  name="${entry%%:*}"
  expected="${entry##*:}"
  file="${WORK_DIR}/extracted/${name}"
  [[ -f "$file" ]] || fail "压缩包中缺少 ${name}"
  actual="$(sha256_of "$file")"
  if [[ "$actual" != "$expected" ]]; then
    fail "${name} SHA-256 不匹配：期望 ${expected}，实际 ${actual}"
  fi
  # 必须是 ELF 可执行文件，防止把 HTML 错误页之类的东西当成二进制内嵌进去
  if [[ "$(head -c 4 -- "$file" | od -An -tx1 | tr -d ' \n')" != "7f454c46" ]]; then
    fail "${name} 不是 ELF 可执行文件"
  fi
  printf '  [OK] %-16s %s\n' "$name" "$actual"
done

# 全部校验通过后才发布到目标目录，避免下载中断留下"半套依赖"
mkdir -p -- "$TARGET_DIR"
install -m 0755 -- "${WORK_DIR}/extracted/easytier-core" "${TARGET_DIR}/easytier-core"
install -m 0755 -- "${WORK_DIR}/extracted/easytier-cli" "${TARGET_DIR}/easytier-cli"

log ""
log "完成。EasyTier Linux 二进制已就位: ${TARGET_DIR}"
log "现在可以执行 MCTier-Linux/scripts/build.sh 进行构建。"
