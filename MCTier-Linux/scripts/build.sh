#!/usr/bin/env bash
# 构建 MCTier Linux 版（Debian 家族）。
#
# 源码与 Windows 端**完全共用** MCTier桌面应用/ 下的那一份，平台差异全部由
# Rust 的 #[cfg(target_os = "linux")] 分支处理。这么做的原因是：如果把源码复制
# 一份到 MCTier-Linux/，两边必然随时间发散，"Linux 与 Windows 同步更新"就成了
# 空话。因此 MCTier-Linux/ 只放 Linux 独有的构建、打包与运行时资产。
#
# 用法：
#   ./MCTier-Linux/scripts/build.sh              # 默认产出 deb + AppImage
#   ./MCTier-Linux/scripts/build.sh --bundles deb
#   ./MCTier-Linux/scripts/build.sh --debug      # 调试构建，不打包

set -Eeuo pipefail

log()  { printf '\n==> %s\n' "$*"; }
fail() { printf '错误: %s\n' "$*" >&2; exit 1; }

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"

BUNDLES="deb,appimage"
DEBUG=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --bundles)
      [[ -n "${2:-}" ]] || fail "--bundles 需要参数，例如 --bundles deb"
      BUNDLES="$2"; shift 2 ;;
    --debug)
      DEBUG=1; shift ;;
    -h|--help)
      sed -n '2,14p' -- "${BASH_SOURCE[0]}"; exit 0 ;;
    *)
      fail "未知参数: $1（可用: --bundles <列表> | --debug）" ;;
  esac
done

cd -- "$DESKTOP_ROOT"

# ---- 前置检查 -------------------------------------------------------------
command -v cargo >/dev/null 2>&1 || fail "缺少 Rust 工具链，请先执行 MCTier-Linux/scripts/install-deps.sh"
command -v npm   >/dev/null 2>&1 || fail "缺少 Node.js/npm，请先执行 MCTier-Linux/scripts/install-deps.sh"

# Tauri 2 需要 webkit2gtk-4.1 的 pkg-config 文件；缺了会在 cargo build 中途才报错，
# 那时已经白等好几分钟，所以提前拦。
if command -v pkg-config >/dev/null 2>&1; then
  pkg-config --exists webkit2gtk-4.1 || pkg-config --exists webkit2gtk-4.0 \
    || fail "找不到 webkit2gtk 开发包，请先执行 MCTier-Linux/scripts/install-deps.sh"
fi

# include_bytes! 依赖的 EasyTier 二进制不入库，缺失时直接调用获取脚本，
# 而不是让 cargo 抛一个难以理解的 "couldn't read ... No such file" 。
if [[ ! -f src-tauri/resources/binaries/linux/easytier-core ]]; then
  log "EasyTier 二进制缺失，正在获取"
  "${SCRIPT_DIR}/fetch-binaries.sh"
fi

# ---- 前端 -----------------------------------------------------------------
log "安装前端依赖"
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi

log "类型检查"
npx tsc --noEmit

log "前端单元测试"
npm test

log "构建前端产物"
npm run build

# ---- Rust -----------------------------------------------------------------
log "Rust 单元测试"
( cd src-tauri && cargo test --lib )

# ---- 打包 -----------------------------------------------------------------
# 刻意不传 --target：目标三元组交给宿主默认值。写死三元组会让非 x86_64 机器
# （例如 arm64 的国产平台）直接构建失败。
if (( DEBUG )); then
  log "调试构建（不打包）"
  npx tauri build --debug --no-bundle
else
  log "发布构建 + 打包（${BUNDLES}）"
  npx tauri build --bundles "$BUNDLES"
fi

log "构建完成，产物位于:"
printf '  %s\n' "${DESKTOP_ROOT}/src-tauri/target/release/bundle/"
if [[ -d src-tauri/target/release/bundle ]]; then
  find src-tauri/target/release/bundle -maxdepth 2 -type f \
    \( -name '*.deb' -o -name '*.AppImage' -o -name '*.rpm' \) -printf '  %p\n' 2>/dev/null || true
fi
