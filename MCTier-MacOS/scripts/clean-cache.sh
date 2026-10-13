#!/usr/bin/env bash
# MCTier 项目缓存清理脚本
#
# 用法:
#   ./scripts/clean-cache.sh          # 安全清理(默认):只删可再生成的缓存,下次构建仍然快
#   ./scripts/clean-cache.sh debug    # 安全清理 + 整个 debug 构建目录(下次 tauri dev 全量重编译)
#   ./scripts/clean-cache.sh full     # 全部清理:含 release 产物(会删掉已打好的 DMG)和 node_modules
#
# 注意:故意不用 `cargo clean`——它会把 src-tauri/target/sherpa-onnx-prebuilt 里
# 下载好的预编译库一起删掉,而 macOS 没有现成的脚本可以重新下载它。
#
# 清理前会检查有没有构建/检查进程(cargo/rustc/tauri)或 MCTier 正在跑,有则拒绝执行,
# 避免删掉正在使用的构建目录。确认无影响时可用 CLEAN_CACHE_SKIP_GUARD=1 跳过检查。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="$ROOT/src-tauri/target"
MODE="${1:-safe}"

# 编译器会边删边往 target 里写文件(rm -rf 报 "Directory not empty" 并破坏增量缓存),
# cargo build/clippy/check 也都吃 target/debug;正在运行的 app 则可能正用着 debug 构建目录。
GUARD_HINT="确认无影响时可设 CLEAN_CACHE_SKIP_GUARD=1 跳过本检查。"
if [ -z "${CLEAN_CACHE_SKIP_GUARD:-}" ] && pgrep -f "cargo (build|clippy|check|test|run)|rustc|tauri (dev|build)" >/dev/null 2>&1; then
  echo "检测到正在运行的 Rust 构建/检查进程(cargo/rustc/tauri),请等它结束再清理。"
  echo "$GUARD_HINT"
  exit 1
fi
if [ -z "${CLEAN_CACHE_SKIP_GUARD:-}" ] && pgrep -x mctier >/dev/null 2>&1; then
  echo "检测到正在运行的 MCTier 应用,请先退出(它可能正在使用 debug 构建目录)。"
  echo "$GUARD_HINT"
  exit 1
fi

human_mb() {
  awk -v mb="$1" 'BEGIN { if (mb >= 1024) printf "%.1f GB", mb/1024; else printf "%d MB", mb }'
}

total_before=$(du -sk "$ROOT" | cut -f1)

echo "== MCTier 缓存清理 (mode: $MODE) =="
echo "清理前项目大小: $(human_mb $((total_before / 1024)))"
echo

if [ "$MODE" = "full" ]; then
  echo "full 模式会删除已打好的 DMG/App 产物和 node_modules,"
  echo "之后需要重新 npm install 并全量重编译。"
  read -r -p "确认继续? [y/N] " answer
  case "$answer" in y | Y | yes) ;; *) echo "已取消"; exit 0 ;; esac
  echo
fi

clean() {
  for path in "$@"; do
    if [ -e "$path" ]; then
      printf '  删除 %s (%s)\n' "${path#"$ROOT"/}" "$(du -sh "$path" | cut -f1)"
      # 编辑器的 rust-analyzer 可能仍持有少量文件,失败后等 2 秒重试一次
      rm -rf "$path" || { sleep 2; rm -rf "$path"; }
    fi
  done
}

echo "[安全清理] 以下内容都会在下次构建时自动重新生成:"
clean "$TARGET/debug/incremental" \
  "$TARGET/x86_64-pc-windows-msvc" \
  "$ROOT/dist" \
  "$ROOT/node_modules/.vite" \
  "$ROOT/node_modules/.cache"

if [ "$MODE" = "debug" ] || [ "$MODE" = "full" ]; then
  echo
  echo "[debug 构建目录] 下次 tauri dev / cargo build 会全量重编译:"
  clean "$TARGET/debug"
fi

if [ "$MODE" = "full" ]; then
  echo
  echo "[release 构建目录与依赖] 含已打好的 DMG,删除后需 npm install + 全量重编译:"
  clean "$TARGET/release" \
    "$ROOT/node_modules"
fi

echo
total_after=$(du -sk "$ROOT" | cut -f1)
freed=$((total_before - total_after))
echo "清理完成:释放 $(human_mb "$((freed / 1024))"),项目现在 $(human_mb $((total_after / 1024)))。"
