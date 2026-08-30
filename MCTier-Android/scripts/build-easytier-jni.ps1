<#
.SYNOPSIS
    构建 MCTier Android 端所需的 EasyTier FFI / JNI 动态库。

.DESCRIPTION
    默认使用仓库同级目录下已有的 EasyTier 源码；也可通过 -Repo / -Rev 让脚本自动
    clone 并 checkout 到指定完整 commit，使构建可复现（见 issue #17 第 11 条）。

    构建时会：
      1. 打开 release 的 strip，避免 .so 残留调试符号；
      2. 通过 --remap-path-prefix 把开发机绝对路径（含 Windows 用户名与 cargo
         注册表路径）重写为稳定占位符，避免泄露开发者环境信息；
      3. 构建完成后输出每个 .so 的 SHA-256，便于登记与复核。

.PARAMETER Repo
    EasyTier 仓库地址。默认只允许官方仓库；自定义 HTTPS 仓库必须同时传入
    -AllowUntrustedSource，并会 clone 到 -EasyTierRoot（若该目录不存在）。

.PARAMETER Rev
    要 checkout 的 40 位完整 commit SHA。默认要求完整 SHA；自定义 tag/分支必须
    同时传入 -AllowUntrustedSource。

.PARAMETER AllowUntrustedSource
    显式允许从非官方仓库或可变 ref 获取源码。该选项会在输出中发出高风险警告，
    仅用于开发者自定义构建，不应出现在发布流程中。

.EXAMPLE
    .\build-easytier-jni.ps1
    .\build-easytier-jni.ps1 -Repo https://github.com/EasyTier/EasyTier.git -Rev 79b562cdc9f1dc3f52195a47a02cf83542c225ab
#>
param(
    [string]$EasyTierRoot = (Join-Path (Resolve-Path "$PSScriptRoot\..\..\..").Path "EasyTier-main"),
    [string[]]$Abis = @("arm64-v8a"),
    [string]$Repo,
    [string]$Rev,
    [switch]$AllowUntrustedSource
)

$ErrorActionPreference = "Stop"

$OfficialEasyTierHost = "github.com"
$OfficialEasyTierPath = "/EasyTier/EasyTier.git"

function Test-OfficialEasyTierRepo([string]$Value) {
    try {
        $uri = [System.Uri]::new($Value)
    } catch {
        return $false
    }
    return $uri.IsAbsoluteUri -and
        $uri.Scheme -eq "https" -and
        $uri.Host -ieq $OfficialEasyTierHost -and
        $uri.AbsolutePath.TrimEnd("/") -ieq $OfficialEasyTierPath.TrimEnd("/") -and
        [string]::IsNullOrEmpty($uri.UserInfo) -and
        [string]::IsNullOrEmpty($uri.Query) -and
        [string]::IsNullOrEmpty($uri.Fragment)
}

function Test-HttpsRepo([string]$Value) {
    try {
        $uri = [System.Uri]::new($Value)
    } catch {
        return $false
    }
    return $uri.IsAbsoluteUri -and
        $uri.Scheme -eq "https" -and
        [string]::IsNullOrEmpty($uri.UserInfo) -and
        [string]::IsNullOrEmpty($uri.Query) -and
        [string]::IsNullOrEmpty($uri.Fragment) -and
        $uri.AbsolutePath -notmatch "[\x00-\x1F\x7F]"
}

function Test-ImmutableRevision([string]$Value) {
    return $Value -match "^[0-9a-fA-F]{40}$"
}

function Test-SafeGitRef([string]$Value) {
    # Git refs may contain slashes, dots, underscores, and hyphens, but never
    # begin with '-' or contain shell/control characters or option syntax.
    return $Value -match "^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$" -and
        $Value -notmatch "\.\.|//|/\.|\./|@$|@\{|[\\~^:?*\[\]]"
}

function Assert-CleanGitWorkTree([string]$Root) {
    $status = @(& git -C $Root status --porcelain=v1 --untracked-files=all 2>$null)
    if ($LASTEXITCODE -ne 0) {
        throw "无法检查 EasyTier 工作树状态。"
    }
    if ($status.Count -gt 0) {
        throw "EasyTier 工作树不干净，拒绝使用固定 commit 构建；请清理已跟踪或未跟踪的改动。"
    }
}

if ([string]::IsNullOrWhiteSpace($EasyTierRoot) -or $EasyTierRoot.IndexOf([char]0) -ge 0) {
    throw "-EasyTierRoot 不是有效路径。"
}
if ($Rev -and -not $Repo) {
    throw "-Rev 只能与 -Repo 一起使用。"
}
if ($Repo -and -not (Test-HttpsRepo $Repo)) {
    throw "-Repo 必须是无凭据、无查询参数的 HTTPS Git 仓库地址。"
}
if ($Repo -and -not (Test-OfficialEasyTierRepo $Repo) -and -not $AllowUntrustedSource) {
    throw "只允许从官方 EasyTier 仓库获取源码；自定义仓库必须显式传入 -AllowUntrustedSource。"
}
if ($Repo -and -not $Rev -and -not $AllowUntrustedSource) {
    throw "指定 -Repo 时必须同时指定 40 位完整 commit SHA；可变分支/tag 仅可通过 -AllowUntrustedSource 显式启用。"
}
if ($Rev -and -not (Test-SafeGitRef $Rev)) {
    throw "-Rev 不是安全的 Git ref，拒绝可能的路径或命令行参数注入。"
}
if ($Repo -and $Rev -and -not (Test-ImmutableRevision $Rev) -and -not $AllowUntrustedSource) {
    throw "-Rev 默认必须是 40 位十六进制 commit SHA；可变 tag/分支仅可通过 -AllowUntrustedSource 显式启用。"
}
if ($AllowUntrustedSource -and ($Repo -or $Rev)) {
    Write-Warning "已启用 -AllowUntrustedSource：源码仓库或 ref 可能不是可复现的官方固定版本。"
}

# 若指定了 -Repo，则确保源码存在并锁定到 -Rev，使构建可复现。
if ($Repo) {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        throw "git was not found. Install git first, or omit -Repo."
    }
    if (-not (Test-Path -LiteralPath $EasyTierRoot)) {
        Write-Host "Cloning $Repo -> $EasyTierRoot"
        & git clone -- $Repo $EasyTierRoot
        if ($LASTEXITCODE -ne 0) { throw "Failed to clone $Repo" }
    } else {
        $existingRoot = (Resolve-Path -LiteralPath $EasyTierRoot).Path
        $isWorkTree = (& git -C $existingRoot rev-parse --is-inside-work-tree 2>$null)
        if ($LASTEXITCODE -ne 0 -or $isWorkTree.Trim() -ne "true") {
            throw "EasyTierRoot 已存在但不是 Git 工作区: $existingRoot"
        }
        $remote = (& git -C $existingRoot config --get remote.origin.url 2>$null | Select-Object -First 1)
        if ($LASTEXITCODE -ne 0 -or -not $remote -or -not (Test-HttpsRepo $remote.Trim())) {
            throw "EasyTierRoot 的 origin 不是允许的 HTTPS Git 仓库，拒绝构建。"
        }
        if ($Repo -and $remote.Trim().TrimEnd('/') -ine $Repo.Trim().TrimEnd('/')) {
            throw "EasyTierRoot 的 origin 与 -Repo 不一致，拒绝构建。"
        }
        if (-not $AllowUntrustedSource -and -not (Test-OfficialEasyTierRepo $remote.Trim())) {
            throw "EasyTierRoot 的 origin 不是官方 EasyTier 仓库，拒绝构建。"
        }
    }
    $EasyTierRoot = (Resolve-Path -LiteralPath $EasyTierRoot).Path
    if ($Rev) {
        & git -C $EasyTierRoot fetch --no-tags origin $Rev
        if ($LASTEXITCODE -ne 0) { throw "Failed to fetch requested revision $Rev" }
        & git -C $EasyTierRoot checkout --detach $Rev
        if ($LASTEXITCODE -ne 0) { throw "Failed to checkout requested revision $Rev" }
        $checkedOut = (& git -C $EasyTierRoot rev-parse HEAD 2>$null).Trim()
        if ($LASTEXITCODE -ne 0 -or ((Test-ImmutableRevision $Rev) -and ($checkedOut -ine $Rev))) {
            throw "检出的 EasyTier commit 与请求的 commit SHA 不一致。"
        }
        if (Test-ImmutableRevision $Rev) {
            # A pinned commit is not sufficient when a reused checkout still
            # contains local source changes that Cargo would compile.
            Assert-CleanGitWorkTree $EasyTierRoot
        }
    }
}

if (-not (Test-Path -LiteralPath $EasyTierRoot)) {
    throw "EasyTier source was not found at $EasyTierRoot. Pass -EasyTierRoot, or -Repo to clone it."
}
$EasyTierRoot = (Resolve-Path -LiteralPath $EasyTierRoot).Path

# 记录本次构建实际使用的 EasyTier commit，便于在发布说明中登记。
$easyTierCommit = "(unknown)"
if (Get-Command git -ErrorAction SilentlyContinue) {
    Push-Location $EasyTierRoot
    try {
        $rc = (git rev-parse HEAD 2>$null)
        if ($LASTEXITCODE -eq 0 -and $rc) { $easyTierCommit = $rc.Trim() }
    } catch {
        # 非 git 工作区时保持 "(unknown)"
    } finally {
        Pop-Location
    }
}
Write-Host "EasyTier source: $EasyTierRoot"
Write-Host "EasyTier commit: $easyTierCommit"

$targetMap = @{
    "arm64-v8a" = "aarch64-linux-android"
    "armeabi-v7a" = "armv7-linux-androideabi"
    "x86" = "i686-linux-android"
    "x86_64" = "x86_64-linux-android"
}

$clangTargetMap = @{
    "arm64-v8a" = "aarch64-linux-android21"
    "armeabi-v7a" = "armv7a-linux-androideabi21"
    "x86" = "i686-linux-android21"
    "x86_64" = "x86_64-linux-android21"
}

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    throw "cargo was not found. Install Rust first."
}

if (-not (Get-Command rustup -ErrorAction SilentlyContinue)) {
    throw "rustup was not found. Install rustup first."
}

$ndk = $env:ANDROID_NDK_ROOT
if (-not $ndk) { $ndk = $env:ANDROID_NDK_HOME }
if (-not $ndk) { $ndk = $env:NDK_HOME }
if (-not $ndk -and $env:ANDROID_HOME) {
    $candidate = Join-Path $env:ANDROID_HOME "ndk\26.1.10909125"
    if (Test-Path $candidate) { $ndk = $candidate }
}
if (-not $ndk -and $env:ANDROID_SDK_ROOT) {
    $candidate = Join-Path $env:ANDROID_SDK_ROOT "ndk\26.1.10909125"
    if (Test-Path $candidate) { $ndk = $candidate }
}
if (-not $ndk) {
    throw "Android NDK was not found. Set ANDROID_NDK_ROOT, ANDROID_NDK_HOME, or NDK_HOME."
}

$env:ANDROID_NDK_ROOT = $ndk
$env:ANDROID_NDK_HOME = $ndk
$env:NDK_HOME = $ndk

$toolchainBin = Join-Path $ndk "toolchains\llvm\prebuilt\windows-x86_64\bin"
$sysroot = Join-Path $ndk "toolchains\llvm\prebuilt\windows-x86_64\sysroot"
$clangPath = Join-Path $toolchainBin "clang.exe"
if (-not (Test-Path $clangPath)) {
    throw "NDK clang.exe was not found at $clangPath"
}
if (-not (Test-Path (Join-Path $sysroot "usr\include"))) {
    throw "NDK sysroot headers were not found at $sysroot"
}

$env:CLANG_PATH = $clangPath

if (-not $env:LIBCLANG_PATH) {
    $libclang = Get-ChildItem -Path $ndk -Recurse -Include libclang.dll,clang.dll -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($libclang) {
        $env:LIBCLANG_PATH = $libclang.DirectoryName
    }
}
if (-not $env:LIBCLANG_PATH) {
    $libclang = Get-ChildItem -Path "C:\Program Files","C:\Program Files (x86)" -Recurse -Include libclang.dll,clang.dll -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($libclang) {
        $env:LIBCLANG_PATH = $libclang.DirectoryName
    }
}
if (-not $env:LIBCLANG_PATH) {
    throw "libclang.dll was not found. Install LLVM for Windows and set LIBCLANG_PATH to the directory containing libclang.dll, then rerun this script."
}

$jniLibs = Resolve-Path "$PSScriptRoot\..\app\src\main"
$jniLibs = Join-Path $jniLibs "jniLibs"
New-Item -ItemType Directory -Force -Path $jniLibs | Out-Null

foreach ($abi in $Abis) {
    if (-not $targetMap.ContainsKey($abi)) {
        throw "Unsupported ABI: $abi"
    }

    $rustTarget = $targetMap[$abi]
    $clangTarget = $clangTargetMap[$abi]
    $sysrootUnix = $sysroot -replace "\\", "/"
    $rustEnvTarget = $rustTarget.ToUpperInvariant().Replace("-", "_")
    $bindgenArgs = "--target=$clangTarget --sysroot=$sysrootUnix -isystem $sysrootUnix/usr/include -isystem $sysrootUnix/usr/include/$rustTarget -isystem $sysrootUnix/usr/include/c++/v1"

    Set-Item -Path "Env:CC_$rustTarget" -Value $clangPath
    Set-Item -Path ("Env:CC_" + $rustTarget.Replace("-", "_")) -Value $clangPath
    Set-Item -Path "Env:AR_$rustTarget" -Value (Join-Path $toolchainBin "llvm-ar.exe")
    Set-Item -Path ("Env:AR_" + $rustTarget.Replace("-", "_")) -Value (Join-Path $toolchainBin "llvm-ar.exe")
    Set-Item -Path "Env:CFLAGS_$rustTarget" -Value "--target=$clangTarget --sysroot=$sysrootUnix"
    Set-Item -Path ("Env:CFLAGS_" + $rustTarget.Replace("-", "_")) -Value "--target=$clangTarget --sysroot=$sysrootUnix"
    Set-Item -Path "Env:CARGO_TARGET_${rustEnvTarget}_LINKER" -Value $clangPath
    # strip：不在 .so 中保留符号表；remap-path-prefix：把开发机绝对路径重写为占位符，
    # 避免泄露 Windows 用户名、仓库路径与 cargo 注册表镜像（见 issue #17 第 11 条）。
    $cargoHome = $env:CARGO_HOME
    if (-not $cargoHome) { $cargoHome = Join-Path $env:USERPROFILE ".cargo" }
    $remapFlags = @(
        "-Cstrip=symbols",
        "--remap-path-prefix=$EasyTierRoot=/easytier",
        "--remap-path-prefix=$cargoHome=/cargo"
    ) -join " "
    Set-Item -Path "Env:CARGO_TARGET_${rustEnvTarget}_RUSTFLAGS" -Value "-Clink-arg=--target=$clangTarget -Clink-arg=--sysroot=$sysrootUnix $remapFlags"

    $env:BINDGEN_EXTRA_CLANG_ARGS = $bindgenArgs
    Set-Item -Path "Env:BINDGEN_EXTRA_CLANG_ARGS_$rustTarget" -Value $bindgenArgs
    Set-Item -Path ("Env:BINDGEN_EXTRA_CLANG_ARGS_" + $rustTarget.Replace("-", "_")) -Value $bindgenArgs

    rustup target add $rustTarget

    Write-Host "Building EasyTier FFI for $abi..."
    Push-Location (Join-Path $EasyTierRoot "easytier-contrib\easytier-ffi")
    cargo build --target $rustTarget --release --locked
    if ($LASTEXITCODE -ne 0) { throw "Failed to build easytier-ffi for $abi" }
    Pop-Location

    Write-Host "Building EasyTier Android JNI for $abi..."
    Push-Location (Join-Path $EasyTierRoot "easytier-contrib\easytier-android-jni")
    cargo build --target $rustTarget --release --locked
    if ($LASTEXITCODE -ne 0) { throw "Failed to build easytier-android-jni for $abi" }
    Pop-Location

    $abiOut = Join-Path $jniLibs $abi
    New-Item -ItemType Directory -Force -Path $abiOut | Out-Null
    Copy-Item -Force (Join-Path $EasyTierRoot "target\$rustTarget\release\libeasytier_ffi.so") $abiOut
    Copy-Item -Force (Join-Path $EasyTierRoot "target\$rustTarget\release\libeasytier_android_jni.so") $abiOut
}

Write-Host "EasyTier JNI libraries copied to $jniLibs"

# 输出每个产物的 SHA-256，便于在 THIRD_PARTY_NOTICES.md / 发布说明中登记与复核。
Write-Host ""
Write-Host "EasyTier commit: $easyTierCommit"
Write-Host "SHA-256:"
Get-ChildItem -Path $jniLibs -Recurse -Filter *.so | ForEach-Object {
    $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    Write-Host ("  {0,-32} {1}" -f $_.Name, $hash)
}
