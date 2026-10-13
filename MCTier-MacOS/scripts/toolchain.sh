#!/usr/bin/env bash
# macOS adaptation contribution: https://github.com/DNPMBHC/MCTier_macOS
# Shared macOS native-toolchain preflight, sourced by the build scripts.
#
# After a macOS or Xcode update Apple revokes the previously accepted Xcode
# license, so `xcrun` can no longer report an SDK path. The failure then
# surfaces far away from its cause: the final link step dies with
# `cc: exit status 69` and the only clue is a one-line license notice buried in
# thousands of lines of cargo output. Resolve the toolchain once, up front.
#
# The Command Line Tools are a separate install with their own license, so they
# keep working while Xcode is unusable. Selecting them is reversible and only
# affects the build scripts that source this file.

MCTIER_CLT_DIR="/Library/Developer/CommandLineTools"

_mctier_sdk_path() {
  # On an unaccepted license this prints nothing to stdout and exits 69, so an
  # empty or non-directory result is the reliable failure signal.
  xcrun --sdk macosx --show-sdk-path 2>/dev/null || true
}

_mctier_xcrun_error() {
  xcrun --sdk macosx --show-sdk-path 2>&1 >/dev/null | head -1
}

# Exports DEVELOPER_DIR and SDKROOT when a fallback is needed; the caller's
# environment is left untouched when xcrun already resolves a usable SDK.
mctier_require_macos_toolchain() {
  if ! command -v xcrun >/dev/null 2>&1; then
    printf '错误: 缺少 xcrun。请运行 xcode-select --install 安装 Command Line Tools。\n' >&2
    return 1
  fi

  if [[ -d "$(_mctier_sdk_path)" ]]; then
    return 0
  fi

  if [[ -d "${MCTIER_CLT_DIR}" ]]; then
    DEVELOPER_DIR="${MCTIER_CLT_DIR}"
    export DEVELOPER_DIR
    local sdk_path
    sdk_path="$(_mctier_sdk_path)"
    if [[ -d "${sdk_path}" ]]; then
      SDKROOT="${sdk_path}"
      export SDKROOT
      printf '警告: Xcode 当前不可用，已自动改用 Command Line Tools 工具链。\n' >&2
      printf '        SDK: %s\n' "${sdk_path}" >&2
      printf '        原因通常是 Xcode 更新后需要重新同意许可协议。\n' >&2
      printf '        如需恢复使用 Xcode，请执行: sudo xcodebuild -license accept\n' >&2
      return 0
    fi
  fi

  printf '错误: 找不到可用的 macOS SDK，无法链接原生代码。\n' >&2
  printf '      xcrun 报告: %s\n' "$(_mctier_xcrun_error)" >&2
  printf '      请先执行 sudo xcodebuild -license accept 同意 Xcode 许可协议。\n' >&2
  return 1
}
