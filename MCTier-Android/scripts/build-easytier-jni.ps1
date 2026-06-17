param(
    [string]$EasyTierRoot = (Resolve-Path "$PSScriptRoot\..\..\EasyTier-main").Path,
    [string[]]$Abis = @("arm64-v8a")
)

$ErrorActionPreference = "Stop"

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
    Set-Item -Path "Env:CARGO_TARGET_${rustEnvTarget}_RUSTFLAGS" -Value "-Clink-arg=--target=$clangTarget -Clink-arg=--sysroot=$sysrootUnix"

    $env:BINDGEN_EXTRA_CLANG_ARGS = $bindgenArgs
    Set-Item -Path "Env:BINDGEN_EXTRA_CLANG_ARGS_$rustTarget" -Value $bindgenArgs
    Set-Item -Path ("Env:BINDGEN_EXTRA_CLANG_ARGS_" + $rustTarget.Replace("-", "_")) -Value $bindgenArgs

    rustup target add $rustTarget

    Write-Host "Building EasyTier FFI for $abi..."
    Push-Location (Join-Path $EasyTierRoot "easytier-contrib\easytier-ffi")
    cargo build --target $rustTarget --release
    if ($LASTEXITCODE -ne 0) { throw "Failed to build easytier-ffi for $abi" }
    Pop-Location

    Write-Host "Building EasyTier Android JNI for $abi..."
    Push-Location (Join-Path $EasyTierRoot "easytier-contrib\easytier-android-jni")
    cargo build --target $rustTarget --release
    if ($LASTEXITCODE -ne 0) { throw "Failed to build easytier-android-jni for $abi" }
    Pop-Location

    $abiOut = Join-Path $jniLibs $abi
    New-Item -ItemType Directory -Force -Path $abiOut | Out-Null
    Copy-Item -Force (Join-Path $EasyTierRoot "target\$rustTarget\release\libeasytier_ffi.so") $abiOut
    Copy-Item -Force (Join-Path $EasyTierRoot "target\$rustTarget\release\libeasytier_android_jni.so") $abiOut
}

Write-Host "EasyTier JNI libraries copied to $jniLibs"
