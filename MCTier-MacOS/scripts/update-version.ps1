# MCTier 一键版本号更新脚本
# 自动识别当前版本号，手动指定新版本号，替换桌面端与安卓端所有涉及版本号的位置
# 仅针对指定文件的指定模式替换，绝不触碰第三方依赖(package-lock 的 rc-input / Cargo.lock 的 plist)

param(
    # 用于版本号已更新、但首次打包失败后的续跑，避免同一次发布重复递增 versionCode。
    [switch]$KeepAndroidVersionCode,
    [ValidateSet('Both', 'Windows', 'Android')][string]$Targets = 'Both',
    [string]$SigningConfiguration,
    [string]$WorkspaceRoot
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = if ($WorkspaceRoot) { [IO.Path]::GetFullPath($WorkspaceRoot) } else { Split-Path -Parent (Split-Path -Parent $PSScriptRoot) }
$desktop = Split-Path -Parent $PSScriptRoot
# 安卓端已移动到桌面应用文件夹内，方便统一提交源码
$android = Join-Path $desktop 'MCTier-Android'
$legacyAndroid = Join-Path $root 'MCTier-Android'
. (Join-Path $desktop 'scripts\windows-release.ps1')
. (Join-Path $desktop 'scripts\release-signing.ps1')
if (-not $SigningConfiguration) { $SigningConfiguration = Join-Path $desktop 'signing.local.json' }
# Machine-local paths survive cache moves without relying on compatibility junctions.
$buildPaths = Read-MctierBuildPaths -ConfigurationPath (Join-Path $root 'build-paths.local.json')

function Read-Text([string]$path) { return [System.IO.File]::ReadAllText($path) }
function Write-Text([string]$path, [string]$content) {
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

function Find-Aapt2 {
    $sdkCandidates = @()
    $localPropertiesPath = Join-Path $android 'local.properties'
    if (Test-Path $localPropertiesPath) {
        foreach ($line in [System.IO.File]::ReadAllLines($localPropertiesPath)) {
            if ($line -match '^sdk\.dir=(.+)$') {
                $sdkCandidates += $Matches[1].Replace('\:', ':').Replace('\\', '\')
                break
            }
        }
    }
    $sdkCandidates += @($env:ANDROID_SDK_ROOT, $env:ANDROID_HOME)
    foreach ($sdk in ($sdkCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique)) {
        $buildTools = Join-Path $sdk 'build-tools'
        if (-not (Test-Path $buildTools)) { continue }
        $toolDirs = @(Get-ChildItem -LiteralPath $buildTools -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending)
        foreach ($toolDir in $toolDirs) {
            $candidate = Join-Path $toolDir.FullName 'aapt2.exe'
            if (Test-Path $candidate) { return $candidate }
        }
    }
    return $null
}

function Get-ApkIdentity {
    param([string]$ApkPath, [string]$Aapt2Path)
    if (-not $Aapt2Path -or -not (Test-Path $ApkPath)) { return $null }
    $badging = & $Aapt2Path dump badging $ApkPath 2>$null
    $packageLine = ($badging | Where-Object { $_ -match '^package:' } | Select-Object -First 1)
    if (-not $packageLine) { return $null }
    $nameMatch = [regex]::Match([string]$packageLine, "versionName='([^']+)'")
    $codeMatch = [regex]::Match([string]$packageLine, "versionCode='([^']+)'")
    if (-not $nameMatch.Success -or -not $codeMatch.Success) { return $null }
    return [pscustomobject]@{
        VersionName = $nameMatch.Groups[1].Value
        VersionCode = $codeMatch.Groups[1].Value
    }
}

function Increment-AndroidVersionCode {
    $text = Read-Text $gradlePath
    $match = [regex]::Match($text, '(versionCode\s*=\s*)(\d+)')
    if (-not $match.Success) {
        Write-Host "  [未匹配] versionCode" -ForegroundColor Yellow
        return $false
    }
    $oldCode = [int]$match.Groups[2].Value
    $nextCode = $oldCode + 1
    $updated = [regex]::Replace($text, '(versionCode\s*=\s*)(\d+)', { param($m) $m.Groups[1].Value + $nextCode }, 1)
    if ($updated -eq $text) { return $false }
    Write-Text $gradlePath $updated
    Write-Host "  [已更新] versionCode: $oldCode -> $nextCode" -ForegroundColor Green
    return $true
}

# 通用替换：对单个文件按正则替换，写回 UTF-8(无 BOM)
function Update-File {
    param([string]$Path, [string]$Pattern, [string]$Replacement, [int]$Count = 0)
    if (-not (Test-Path $Path)) { Write-Host "  [跳过] 文件不存在: $Path" -ForegroundColor Yellow; return $false }
    $text = Read-Text $Path
    $rx = [regex]::new($Pattern)
    if (-not $rx.IsMatch($text)) { Write-Host "  [未匹配] $([System.IO.Path]::GetFileName($Path))" -ForegroundColor Yellow; return $false }
    if ($Count -gt 0) { $new = $rx.Replace($text, $Replacement, $Count) } else { $new = $rx.Replace($text, $Replacement) }
    if ($new -ne $text) {
        Write-Text $Path $new
        Write-Host "  [已更新] $([System.IO.Path]::GetFileName($Path))" -ForegroundColor Green
        return $true
    }
    Write-Host "  [无变化] $([System.IO.Path]::GetFileName($Path))" -ForegroundColor DarkGray
    return $false
}

# ============ 构建用固定 Node（规避系统 Node 崩溃） ============
# 说明：系统 Node 若为奇数号实验版（如 v23 / v25），会让 vite/rollup 打包在渲染阶段
# 原生崩溃（退出码 -1073740791 / 0xC0000409）。为彻底摆脱对系统 Node 版本的依赖，
# 这里固定使用一份本地缓存的 Node LTS（v24）来打包前端，首次会自动下载并缓存到
# 项目根目录的 .build-node 下，之后复用、无需联网。
function Ensure-BuildNode {
    $pinned = 'v24.18.0'
    $baseDir = Join-Path $root '.build-node'
    $nodeDir = Join-Path $baseDir "node-$pinned-win-x64"
    $nodeExe = Join-Path $nodeDir 'node.exe'
    if (Test-Path $nodeExe) { return $nodeDir }
    Write-Host "  [构建 Node] 未找到本地固定 Node，正在下载 $pinned（仅首次）..." -ForegroundColor Cyan
    try {
        if (-not (Test-Path $baseDir)) { New-Item -ItemType Directory -Path $baseDir | Out-Null }
        $url = "https://nodejs.org/dist/$pinned/node-$pinned-win-x64.zip"
        $zip = Join-Path $baseDir "node-$pinned.zip"
        Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing -TimeoutSec 180
        Expand-Archive -Path $zip -DestinationPath $baseDir -Force
        Remove-Item $zip -Force -ErrorAction SilentlyContinue
        if (Test-Path $nodeExe) { Write-Host "  [构建 Node] 已就绪：$nodeExe" -ForegroundColor Green; return $nodeDir }
    } catch {
        Write-Host "  [构建 Node] 下载失败：$($_.Exception.Message)" -ForegroundColor Yellow
    }
    return $null
}

function Find-VcVars64 {
    $candidates = @()
    if ($env:VSINSTALLDIR) {
        $candidates += (Join-Path $env:VSINSTALLDIR 'VC\Auxiliary\Build\vcvars64.bat')
    }

    $vswhereCandidates = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft Visual Studio\Installer\vswhere.exe')
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
    foreach ($vswhere in $vswhereCandidates) {
        $installations = @(& $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null)
        foreach ($installation in $installations) {
            if ($installation) {
                $candidates += (Join-Path $installation 'VC\Auxiliary\Build\vcvars64.bat')
            }
        }
    }

    foreach ($edition in @('BuildTools', 'Community', 'Professional', 'Enterprise')) {
        $candidates += (Join-Path $env:ProgramFiles "Microsoft Visual Studio\2022\$edition\VC\Auxiliary\Build\vcvars64.bat")
        $candidates += (Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\2022\$edition\VC\Auxiliary\Build\vcvars64.bat")
    }

    return $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
}

function Import-VcVars64Environment {
    $existingLink = Get-Command link.exe -ErrorAction SilentlyContinue
    if ($existingLink -and $existingLink.Source -match '\\Microsoft Visual Studio\\') {
        Write-Host "  [C++ 工具链] 已就绪：$($existingLink.Source)" -ForegroundColor DarkGray
        return
    }

    $vcvars64 = Find-VcVars64
    if (-not $vcvars64) {
        throw '找不到 Visual Studio C++ x64 构建工具。请安装 Visual Studio 2022 Build Tools，并选择“使用 C++ 的桌面开发”（Microsoft.VisualStudio.Workload.VCTools）后重试。'
    }

    $environmentLines = & cmd /d /s /c "`"$vcvars64`" >nul && set"
    if ($LASTEXITCODE -ne 0) { throw "无法加载 Visual C++ 构建环境：$vcvars64" }
    foreach ($line in $environmentLines) {
        $separator = $line.IndexOf('=')
        if ($separator -le 0) { continue }
        $name = $line.Substring(0, $separator)
        $value = $line.Substring($separator + 1)
        [Environment]::SetEnvironmentVariable($name, $value, 'Process')
    }

    $link = Get-Command link.exe -ErrorAction SilentlyContinue
    if (-not $link -or $link.Source -notmatch '\\Microsoft Visual Studio\\') {
        throw "已执行 vcvars64.bat，但仍找不到 MSVC link.exe：$vcvars64"
    }
    Write-Host "  [C++ 工具链] 已加载：$($link.Source)" -ForegroundColor Green
}

function Prepare-ReleaseDirectory {
    param([string]$PreferredPath)

    if (Test-Path -LiteralPath $PreferredPath) {
        $suffix = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
        $PreferredPath = "$PreferredPath-build-$suffix"
        Write-Host "  [发布目录] 保留已有产物，本次使用新目录：$PreferredPath" -ForegroundColor Yellow
    }

    New-Item -ItemType Directory -Path $PreferredPath -Force | Out-Null
    return $PreferredPath
}

# ============ 1. 自动识别当前版本号 ============
$pkgPath = Join-Path $desktop 'package.json'
if (-not (Test-Path $pkgPath)) { Write-Host "找不到 package.json，请确认脚本与项目在同一目录。" -ForegroundColor Red; pause; exit 1 }
$curVersion = (Get-Content $pkgPath -Raw | ConvertFrom-Json).version
Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "        MCTier 一键版本号更新工具" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "当前版本号: " -NoNewline; Write-Host $curVersion -ForegroundColor Yellow
Write-Host ""

# ============ 2. 手动指定新版本号 ============
$newVersion = ''
while ($true) {
    $newVersion = (Read-Host "请输入新的版本号(格式 x.y.z，例如 1.9.0)").Trim()
    if ($newVersion -match '^\d+\.\d+\.\d+$') { break }
    Write-Host "格式不正确，必须是 x.y.z(纯数字与点)，请重新输入。" -ForegroundColor Red
}
$sameVersion = ($newVersion -eq $curVersion)
if ($sameVersion) {
    Write-Host ""
    Write-Host "输入版本号与桌面端当前版本相同，将重新同步所有端的版本信息。" -ForegroundColor Yellow
} else {
    Write-Host ""
    Write-Host "即将把版本号从 $curVersion 更新为 $newVersion" -ForegroundColor Cyan
    $confirm = (Read-Host "确认请输入 Y").Trim()
    if ($confirm -notmatch '^[Yy]$') { Write-Host "已取消。" -ForegroundColor Yellow; pause; exit 0 }
}
Write-Host ""

# 构造替换串(用单引号保留 .NET 分组引用 ${1} ${2})
$g12 = '${1}' + $newVersion + '${2}'

# ============ 3. 桌面端替换 ============
Write-Host "[桌面端 MCTier桌面应用]" -ForegroundColor Cyan

# package.json 根 version(只替换第一个 "version": "x")
Update-File $pkgPath '("version"\s*:\s*")[^"]*(")' $g12 1 | Out-Null

# package-lock.json 只更新根项目的两个 version 字段，不触碰任何依赖版本。
$lockPath = Join-Path $desktop 'package-lock.json'
Update-File $lockPath '(?s)(\A\{\s*"name"\s*:\s*"mctier"\s*,\s*"version"\s*:\s*")[^"]*(")' $g12 1 | Out-Null
Update-File $lockPath '(""\s*:\s*\{\s*"name"\s*:\s*"mctier"\s*,\s*"version"\s*:\s*")[^"]*(")' $g12 1 | Out-Null

# tauri.conf.json 顶层 version(只替换第一个)
Update-File (Join-Path $desktop 'src-tauri\tauri.conf.json') '("version"\s*:\s*")[^"]*(")' $g12 1 | Out-Null

# Cargo.toml [package] version(只替换第一个 version = "x")
Update-File (Join-Path $desktop 'src-tauri\Cargo.toml') '(?m)(^version\s*=\s*")[^"]*(")' $g12 1 | Out-Null

# Cargo.lock 仅 mctier 包(锚定 name = "mctier")
Update-File (Join-Path $desktop 'src-tauri\Cargo.lock') '(name = "mctier"\r?\nversion = ")[^"]*(")' $g12 | Out-Null

# WebView 运行时通过 Tauri 的 getVersion() 读取桌面版本（src/services/version/appVersion.ts），
# 前端不再硬编码版本号，因此这里没有需要替换的地方。
# 但要防止将来有人又写回一份硬编码——那样它不会被本脚本更新，会静默与 tauri.conf.json 不一致。
$hardcodedClientVersion = Get-ChildItem (Join-Path $desktop 'src') -Recurse -File -Include '*.ts', '*.tsx' -ErrorAction SilentlyContinue |
    Select-String -Pattern 'clientVersion\s*:\s*[''"]\d+\.\d+\.\d+' -ErrorAction SilentlyContinue
if ($hardcodedClientVersion) {
    foreach ($hit in $hardcodedClientVersion) {
        Write-Host "  [警告] 前端出现硬编码 clientVersion：$($hit.Path):$($hit.LineNumber)" -ForegroundColor Yellow
    }
    throw '前端不应硬编码 clientVersion，请改用 appVersion()（src/services/version/appVersion.ts）。'
}
Write-Host "  [检查] 前端未硬编码 clientVersion（运行时读 Tauri 版本）" -ForegroundColor DarkGray

# 第三方声明文件头部的「对应 MCTier x.y.z」与更新日期。该文件会被打进安装包
# （tauri.conf.json 的 resources），版本对不上会让合规声明指向错误的版本。
$noticesPath = Join-Path $desktop 'THIRD_PARTY_NOTICES.md'
$noticesPattern = '(最后更新 / Last updated: )(\d{4}-\d{2}-\d{2})(（对应 MCTier )\d+\.\d+\.\d+(）)'
if ($sameVersion) {
    # 同版本重新同步时保留原日期：这一行记录的是文档自身的更新时间，
    # 版本没变说明第三方组件信息也没变，改日期只会制造无意义的 diff。
    Update-File $noticesPath $noticesPattern ('${1}${2}${3}' + $newVersion + '${4}') 1 | Out-Null
} else {
    $today = Get-Date -Format 'yyyy-MM-dd'
    Update-File $noticesPath $noticesPattern ('${1}' + $today + '${3}' + $newVersion + '${4}') 1 | Out-Null
}

# README 徽章
Update-File (Join-Path $desktop 'README.md') '(version-)[^-]*(-blue)' $g12 | Out-Null

# 英文 README 徽章(确保英文文档版本号同步)
Update-File (Join-Path $desktop 'README_EN.md') '(version-)[^-]*(-blue)' $g12 | Out-Null

# 根目录 README 徽章(若存在版本徽章)
Update-File (Join-Path $root 'README.md') '(version-)[^-]*(-blue)' $g12 | Out-Null

Write-Host ""
Write-Host "[安卓端 MCTier-Android]" -ForegroundColor Cyan

if (-not (Test-Path $android)) { throw "找不到安卓工程目录: $android" }
$gradlePath = Join-Path $android 'app\build.gradle.kts'
$gradleWrapperPath = Join-Path $android 'gradlew.bat'
if (-not (Test-Path $gradlePath) -or -not (Test-Path $gradleWrapperPath)) {
    throw "安卓工程不完整，构建必须使用: $android"
}
if (Test-Path $legacyAndroid) {
    $legacyFileCount = @(Get-ChildItem -LiteralPath $legacyAndroid -Recurse -File -Force -ErrorAction SilentlyContinue).Count
    if ($legacyFileCount -gt 0) {
        throw "检测到根目录仍有旧安卓源码($legacyFileCount 个文件)，请移除后再构建: $legacyAndroid"
    }
}
Write-Host "  [源码目录] $android" -ForegroundColor DarkGray

# 记录安卓端更新前的 versionName。即使桌面端已经是目标版本，只要安卓端落后也必须同步。
$androidVersionBefore = ''
if (Test-Path $gradlePath) {
    $gradleBefore = Read-Text $gradlePath
    $versionMatch = [regex]::Match($gradleBefore, '(versionName\s*=\s*")([^"]+)(")')
    if ($versionMatch.Success) { $androidVersionBefore = $versionMatch.Groups[2].Value }
}

# Models.kt AppClientVersion
Update-File (Join-Path $android 'app\src\main\java\top\pmh13\mctier\data\Models.kt') '(AppClientVersion\s*=\s*")[^"]*(")' $g12 | Out-Null

# build.gradle.kts versionName(保留 -android 后缀)
$androidVersionTarget = "$newVersion-android"
$gName = '${1}' + $androidVersionTarget + '${2}'
Update-File $gradlePath '(versionName\s*=\s*")[^"]*(")' $gName | Out-Null

# 版本号发生变化，或安卓端之前仍是旧版本时，递增 versionCode。
$androidVersionCodeBumped = $false
if ($androidVersionBefore -ne $androidVersionTarget) {
    $androidVersionCodeBumped = Increment-AndroidVersionCode
} else {
    $currentCode = [regex]::Match((Read-Text $gradlePath), '(versionCode\s*=\s*)(\d+)')
    if ($currentCode.Success) {
        Write-Host "  [无变化] 安卓 versionName 与目标一致，当前 versionCode $($currentCode.Groups[2].Value)" -ForegroundColor DarkGray
    }
}

Write-Host ""
Write-Host "[官网 MCTier官网]" -ForegroundColor Cyan

# 官网的下载入口现在指向网盘直链（pan.quark.cn），链接里不含版本号，因此没有需要替换的地方。
# 这里只做检查：若将来改回 GitHub Releases 直链或写上安装包文件名，就必须跟着版本号一起更新，
# 否则官网会长期指向旧版本。
$siteIndex = Join-Path $root 'MCTier官网\index.html'
if (Test-Path $siteIndex) {
    $siteUpdated = $false
    if ((Read-Text $siteIndex) -match '/releases/download/v\d+\.\d+\.\d+/') {
        $siteUpdated = (Update-File $siteIndex '(/releases/download/v)\d+\.\d+\.\d+(/)' $g12) -or $siteUpdated
    }
    if ((Read-Text $siteIndex) -match 'MCTier_\d+\.\d+\.\d+_x64-setup\.exe') {
        $siteUpdated = (Update-File $siteIndex '(MCTier_)\d+\.\d+\.\d+(_x64-setup\.exe)' $g12) -or $siteUpdated
    }
    if (-not $siteUpdated) {
        Write-Host '  [跳过] 官网使用网盘直链，页面内无版本号需要替换' -ForegroundColor DarkGray
    }
} else {
    Write-Host "  [跳过] 找不到官网首页: $siteIndex" -ForegroundColor Yellow
}

Write-Host ''
Write-Host '[Linux 端 MCTier-Linux]' -ForegroundColor Cyan

# Linux 端与 Windows 端共用同一份源码，版本号来自 src-tauri/tauri.conf.json 与 Cargo.toml，
# 上面已经替换过，因此这里没有独立的版本号文件。
# MCTier-Linux/ 只放构建与打包资产：
#   - packaging/mctier.desktop 的 Version=1.0 是 desktop entry 规范版本，不是应用版本，不能改；
#   - scripts/fetch-binaries.sh 的 EASYTIER_VERSION 是第三方组件版本，与 MCTier 版本无关。
# 这里只做检查：防止有人在 Linux 资产里另写一份 MCTier 版本号而脱离本脚本管理。
$linuxDir = Join-Path $desktop 'MCTier-Linux'
if (Test-Path $linuxDir) {
    $strayLinuxVersion = Get-ChildItem $linuxDir -Recurse -File -ErrorAction SilentlyContinue |
        Select-String -Pattern 'MCTier.{0,20}\d+\.\d+\.\d+' -ErrorAction SilentlyContinue |
        Where-Object { $_.Line -notmatch 'EASYTIER|[Ee]asy[Tt]ier' }
    if ($strayLinuxVersion) {
        foreach ($hit in $strayLinuxVersion) {
            Write-Host "  [警告] Linux 资产内出现疑似硬编码版本号：$($hit.Path):$($hit.LineNumber)" -ForegroundColor Yellow
        }
        Write-Host '  请确认这些位置是否需要纳入本脚本一起更新。' -ForegroundColor Yellow
    } else {
        Write-Host '  [检查] Linux 资产无独立版本号（与 Windows 共用 tauri.conf.json）' -ForegroundColor DarkGray
    }
} else {
    Write-Host "  [跳过] 找不到 Linux 目录: $linuxDir" -ForegroundColor Yellow
}

Write-Host ''
Write-Host '[校验]' -ForegroundColor Cyan

$desktopVersionCheck = (Get-Content $pkgPath -Raw | ConvertFrom-Json).version
$gradleVersionCheck = [regex]::Match((Read-Text $gradlePath), '(versionName\s*=\s*")([^"]+)(")')
if ($desktopVersionCheck -ne $newVersion -or -not $gradleVersionCheck.Success -or $gradleVersionCheck.Groups[2].Value -ne $androidVersionTarget) {
    throw "版本同步校验失败：桌面=$desktopVersionCheck，安卓=$($gradleVersionCheck.Groups[2].Value)，目标=$newVersion"
}

# 逐个复核脚本真正写过的文件。此前只校验 package.json 与安卓 versionName，
# 其余位置（tauri.conf.json / Cargo.toml / Android AppClientVersion 等）若正则失配，
# 只会打印一行 [未匹配] 就继续走完，最后仍然显示「已同步」，属于会放过真实漏改的假成功。
# tauri.conf.json 尤其关键：桌面端运行时的版本号和安装包版本都来自它。
$syncChecks = @(
    @{ Name = 'tauri.conf.json';        Path = (Join-Path $desktop 'src-tauri\tauri.conf.json'); Pattern = '"version"\s*:\s*"([^"]+)"';        Expected = $newVersion },
    @{ Name = 'src-tauri/Cargo.toml';   Path = (Join-Path $desktop 'src-tauri\Cargo.toml');      Pattern = '(?m)^version\s*=\s*"([^"]+)"';       Expected = $newVersion },
    @{ Name = 'src-tauri/Cargo.lock';   Path = (Join-Path $desktop 'src-tauri\Cargo.lock');      Pattern = 'name = "mctier"\r?\nversion = "([^"]+)"'; Expected = $newVersion },
    @{ Name = 'Android Models.kt';      Path = (Join-Path $android 'app\src\main\java\top\pmh13\mctier\data\Models.kt'); Pattern = 'AppClientVersion\s*=\s*"([^"]+)"'; Expected = $newVersion },
    @{ Name = 'README 徽章';            Path = (Join-Path $desktop 'README.md');                 Pattern = 'version-([^-]+)-blue';                Expected = $newVersion },
    @{ Name = 'README_EN 徽章';         Path = (Join-Path $desktop 'README_EN.md');              Pattern = 'version-([^-]+)-blue';                Expected = $newVersion },
    @{ Name = 'THIRD_PARTY_NOTICES';    Path = $noticesPath;                                      Pattern = '（对应 MCTier (\d+\.\d+\.\d+)）';       Expected = $newVersion }
)

$syncFailures = @()
foreach ($check in $syncChecks) {
    if (-not (Test-Path $check.Path)) {
        $syncFailures += "$($check.Name)：文件不存在（$($check.Path)）"
        continue
    }
    $found = [regex]::Match((Read-Text $check.Path), $check.Pattern)
    if (-not $found.Success) {
        $syncFailures += "$($check.Name)：未能读出版本号，替换规则可能已失效"
    } elseif ($found.Groups[1].Value -ne $check.Expected) {
        $syncFailures += "$($check.Name)：实际 $($found.Groups[1].Value)，期望 $($check.Expected)"
    } else {
        Write-Host "  [一致] $($check.Name) = $($found.Groups[1].Value)" -ForegroundColor DarkGray
    }
}

# package-lock 的两个根 version 单独校验。这里刻意不用 ConvertFrom-Json：
# package-lock.json 的 packages 下有一个名字为空字符串的键（表示根包），
# Windows PowerShell 5.1（本脚本由 .bat 以此启动）的 ConvertFrom-Json 会直接报
# 「the value of argument "name" is not valid」而整份解析失败。改用与替换规则同源的正则，
# 只认文件开头的根 version 和 packages 里的空键节点，不会碰到任何依赖的 version。
if (Test-Path $lockPath) {
    $lockText = Read-Text $lockPath
    $lockRootMatch = [regex]::Match($lockText, '(?s)\A\{\s*"name"\s*:\s*"mctier"\s*,\s*"version"\s*:\s*"([^"]+)"')
    $lockSelfMatch = [regex]::Match($lockText, '""\s*:\s*\{\s*"name"\s*:\s*"mctier"\s*,\s*"version"\s*:\s*"([^"]+)"')
    if (-not $lockRootMatch.Success -or -not $lockSelfMatch.Success) {
        $syncFailures += 'package-lock.json：未能读出根 version，替换规则可能已失效'
    } elseif ($lockRootMatch.Groups[1].Value -ne $newVersion -or $lockSelfMatch.Groups[1].Value -ne $newVersion) {
        $syncFailures += "package-lock.json：根 version=$($lockRootMatch.Groups[1].Value)，packages['']=$($lockSelfMatch.Groups[1].Value)，期望 $newVersion"
    } else {
        Write-Host "  [一致] package-lock.json = $($lockRootMatch.Groups[1].Value)" -ForegroundColor DarkGray
    }
}

if ($syncFailures.Count -gt 0) {
    Write-Host ''
    foreach ($failure in $syncFailures) { Write-Host "  [不一致] $failure" -ForegroundColor Red }
    throw "共 $($syncFailures.Count) 处版本号未同步到 $newVersion，已中止（不会带着不一致的版本号继续打包）。"
}

# ============ 4. 版本号更新完成 ============
Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host "  版本号已同步为 $newVersion（安卓 $androidVersionTarget）" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
Write-Host ""

# ============ 5. 可选：自动重新打包 ============
# 注意：这里只打 Windows 与安卓产物。Linux 的 deb / AppImage 必须在 Linux 主机上构建
#（Tauri 不支持从 Windows 交叉编译到 Linux），因此不在本脚本内尝试，改为在下方给出命令。
$doBuild = (Read-Host "是否现在自动重新打包(MCTier.exe、Windows 安装程序、安卓 APK)? Linux 产物需在 Linux 主机构建。耗时较久(Y/N)").Trim()
$signingEnvironmentNames = @('MCTIER_ANDROID_STORE_FILE', 'MCTIER_ANDROID_KEY_ALIAS', 'MCTIER_ANDROID_STORE_PASSWORD', 'MCTIER_ANDROID_KEY_PASSWORD')
$previousSigningEnvironment = @{}
foreach ($name in $signingEnvironmentNames) { $previousSigningEnvironment[$name] = [Environment]::GetEnvironmentVariable($name) }
try {
if ($doBuild -match '^[Yy]$') {
    # Fail before expensive builds; never fall back to unsigned packages.
    $signing = Read-MctierSigning $SigningConfiguration
    if ($Targets -ne 'Windows') {
        $androidSigningTools = Find-MctierAndroidSigningTools $android
        Initialize-MctierAndroidSigning $signing $androidSigningTools
    }
    if ($Targets -ne 'Android') {
        Get-MctierWindowsCertificate $signing | Out-Null
        Find-MctierSignTool | Out-Null
        if ($signing.Windows.Mode -eq 'SelfSigned') { Write-Host '  [免费自签名] EXE 带数字签名，但不会自动获得 Windows 信任，SmartScreen 仍可能警告。' -ForegroundColor Yellow }
    }
    $releaseRoot = if ($buildPaths.ReleaseRoot) { $buildPaths.ReleaseRoot } else { $root }
    $preferredOutDir = Join-Path $releaseRoot ("MCTier-发布-v" + $newVersion)
    $outDir = Prepare-ReleaseDirectory $preferredOutDir
    $packagingFailed = $false
    if ($buildPaths.TemporaryDirectory) {
        New-Item -ItemType Directory -Path $buildPaths.TemporaryDirectory -Force | Out-Null
        $env:TEMP = $buildPaths.TemporaryDirectory
        $env:TMP = $buildPaths.TemporaryDirectory
    }
    if (-not $env:GRADLE_USER_HOME -and $buildPaths.GradleUserHome) { $env:GRADLE_USER_HOME = $buildPaths.GradleUserHome }

    # 同一 versionName 的修复版本也必须提升 versionCode，否则部分 Android 安装器会继续保留旧 APK。
    if ($Targets -ne 'Windows' -and -not $androidVersionCodeBumped -and -not $KeepAndroidVersionCode) {
        Write-Host "  [安卓] 检测到同版本重打包，递增 versionCode 以确保更新可安装" -ForegroundColor Cyan
        $androidVersionCodeBumped = Increment-AndroidVersionCode
    } elseif ($KeepAndroidVersionCode) {
        Write-Host "  [安卓] 续跑失败的发布构建，保留现有 versionCode" -ForegroundColor DarkGray
    }

    # ---- 桌面端：MCTier.exe + Windows 安装程序 ----
    if ($Targets -ne 'Android') {
    Write-Host ""
    # 固定使用本地 Node LTS 打包前端，规避系统 Node（可能是会崩溃的奇数版 v25）
    $buildNodeDir = Ensure-BuildNode
    if ($buildNodeDir) {
        $env:PATH = "$buildNodeDir;$env:PATH"
        Write-Host "  [构建 Node] 本次打包使用固定 Node：$(& (Join-Path $buildNodeDir 'node.exe') -v)" -ForegroundColor Green
    } else {
        Write-Host "  [构建 Node] 未能准备固定 Node，回退使用系统 Node（若为奇数版 v23/v25 可能打包失败）" -ForegroundColor Yellow
    }
    Write-Host "[1/2] 正在打包桌面端 NSIS 安装包，首次编译 Rust 较慢，请耐心等待..." -ForegroundColor Cyan
    $desktopLog = Join-Path $outDir 'windows-build.log'
    $previousCargoTarget = $env:CARGO_TARGET_DIR
    try {
        Import-VcVars64Environment
        # Respect an explicit caller override; otherwise use the real cache configured locally.
        # Set it BEFORE cargo metadata, so a stale target/release junction is never consulted.
        if (-not $env:CARGO_TARGET_DIR -and $buildPaths.CargoTargetDirectory) {
            $env:CARGO_TARGET_DIR = $buildPaths.CargoTargetDirectory
        }
        Push-Location (Join-Path $desktop 'src-tauri')
        try {
            $cargoMetadata = & cargo metadata --no-deps --format-version 1
            if ($LASTEXITCODE -ne 0) { throw '无法解析 Cargo 构建输出目录。' }
            $tgt = ($cargoMetadata | ConvertFrom-Json).target_directory
        } finally { Pop-Location }
        Add-Content -LiteralPath $desktopLog -Encoding Unicode -Value ("[Cargo 缓存候选] " + $tgt)
        $resolvedTarget = & node (Join-Path $desktop 'scripts\cargo-target-directory.mjs') $tgt $env:CARGO_BUILD_TARGET
        if ($LASTEXITCODE -ne 0) { throw "无法解析桌面构建缓存：$tgt。请在 $root\build-paths.local.json 中将 CargoTargetDirectory 指向实际缓存目录（不要填写旧目录链接）。" }
        $tgt = $resolvedTarget | ConvertFrom-Json
        $env:CARGO_TARGET_DIR = $tgt
        Write-Host "  [构建缓存] 使用实际目录：$tgt" -ForegroundColor DarkGray
        & (Join-Path $desktop 'scripts\prepare-sherpa-windows.ps1') -CargoTargetDirectory $tgt
        $releaseDirectory = Join-Path $tgt 'release'
        if ($env:CARGO_BUILD_TARGET) { $releaseDirectory = Join-Path (Join-Path $tgt $env:CARGO_BUILD_TARGET) 'release' }
        Push-Location $desktop
        try {
            $signingOverlay = Join-Path $outDir 'tauri-signing.json'
            New-MctierTauriSigningConfig $SigningConfiguration $signingOverlay
            cmd /d /c "npm run tauri build -- --bundles nsis --ci --config `"$signingOverlay`" 2>&1" | Tee-Object -FilePath $desktopLog -Append | Out-Host
            if ($LASTEXITCODE -ne 0) { throw "桌面构建退出码：$LASTEXITCODE" }
        } finally { Pop-Location }
        # Tauri can restore the unsigned Cargo executable after bundling. The installer
        # payload was signed by signCommand; sign the standalone export again as needed.
        $standalone = Join-Path $releaseDirectory 'mctier.exe'
        try { Assert-MctierWindowsSignature $standalone $signing.Windows.CertificateThumbprint $signing.Windows.Mode }
        catch {
            & (Join-Path $desktop 'scripts\sign-windows.ps1') -ConfigurationPath $SigningConfiguration -FilePath $standalone
            if ($LASTEXITCODE -ne 0) { throw 'Standalone EXE signing failed.' }
        }
        $windowsArtifacts = Export-MctierWindowsRelease -ReleaseDirectory $releaseDirectory -OutputDirectory $outDir -Version $newVersion -SigningConfiguration $signing
        foreach ($artifact in $windowsArtifacts) { Write-Host "  [产物] $artifact" -ForegroundColor Green }
    } catch {
        Write-Host "  桌面端打包失败：$($_.Exception.Message)" -ForegroundColor Red
        Add-Content -LiteralPath $desktopLog -Encoding Unicode -Value ("`r`n[打包/导出失败] " + $_.Exception.Message)
        Write-Host "  [日志] $desktopLog" -ForegroundColor Yellow
        $packagingFailed = $true
    } finally {
        if ($null -eq $previousCargoTarget) { Remove-Item Env:CARGO_TARGET_DIR -ErrorAction SilentlyContinue }
        else { $env:CARGO_TARGET_DIR = $previousCargoTarget }
    }

    }
    # ---- 安卓端：APK ----
    if ($Targets -ne 'Windows') {
    Write-Host ""
    Write-Host "[Android] 正在打包已签名非调试 APK (assembleSignedRelease)..." -ForegroundColor Cyan
    $apk = Join-Path $android 'app\build\outputs\apk\signedRelease\app-signedRelease.apk'
    $apkMetadata = Join-Path $android 'app\build\outputs\apk\signedRelease\output-metadata.json'
    Write-Host "  [构建源 APK] $apk" -ForegroundColor DarkGray
    Push-Location $android
    try {
        # 先释放 Gradle/Android 插件可能仍持有的上一份 APK，再由 clean 统一清理构建目录。
        cmd /d /c "gradlew.bat --stop 2>&1" | Out-Host
        cmd /d /c "gradlew.bat clean assembleSignedRelease --no-daemon --no-configuration-cache --rerun-tasks --console=plain 2>&1" | Tee-Object -FilePath (Join-Path $outDir 'android-build.log') | Out-Host
        $andOk = ($LASTEXITCODE -eq 0)
    } finally {
        Pop-Location
    }
    if ($andOk) {
        if (Test-Path $apk) {
            $apkVersion = ''
            $apkCode = ''
            if (Test-Path $apkMetadata) {
                try {
                    $metadata = Get-Content $apkMetadata -Raw | ConvertFrom-Json
                    $metadataElements = @($metadata.elements)
                    if ($metadataElements.Count -gt 0) {
                        $apkVersion = [string]$metadataElements[0].versionName
                        $apkCode = [string]$metadataElements[0].versionCode
                    }
                } catch {
                    Write-Host "  [警告] 无法读取 APK 元数据: $($_.Exception.Message)" -ForegroundColor Yellow
                }
            }
            $aapt2 = Find-Aapt2
            $apkIdentity = Get-ApkIdentity $apk $aapt2
            if ($apkIdentity) {
                $apkVersion = $apkIdentity.VersionName
                $apkCode = $apkIdentity.VersionCode
            } elseif (-not $aapt2) {
                Write-Host "  [警告] 找不到 aapt2，无法复核 APK 内嵌版本；仅使用 Gradle 元数据。" -ForegroundColor Yellow
            } else {
                Write-Host "  [警告] aapt2 无法读取 APK，无法复核 APK 内嵌版本。" -ForegroundColor Yellow
            }
            if ($apkVersion -ne "$newVersion-android" -or -not $apkCode) {
                $packagingFailed = $true
                Write-Host "  APK 版本校验失败：实际 versionName='$apkVersion' versionCode='$apkCode'，目标 versionName='$newVersion-android'，不会复制产物。" -ForegroundColor Red
            } else {
                Assert-MctierApkSignature $apk $androidSigningTools $signing.Android.CertificateSha256 -RequireRelease
                $releaseApk = Join-Path $outDir "MCTier-Android.apk"
                Copy-Item $apk $releaseApk -Force
                $sourceHash = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash
                $releaseHash = (Get-FileHash -LiteralPath $releaseApk -Algorithm SHA256).Hash
                if ($sourceHash -ne $releaseHash) {
                    Remove-Item $releaseApk -Force
                    throw "APK 复制校验失败：源文件与发布文件哈希不一致。"
                }
                $releaseIdentity = Get-ApkIdentity $releaseApk $aapt2
                if ($releaseIdentity -and ($releaseIdentity.VersionName -ne "$newVersion-android" -or $releaseIdentity.VersionCode -ne $apkCode)) {
                    Remove-Item $releaseApk -Force
                    throw "发布 APK 二次校验失败：$releaseApk"
                }
                Assert-MctierApkSignature $releaseApk $androidSigningTools $signing.Android.CertificateSha256 -RequireRelease
                Write-Host "  [产物] 已签名 Release APK 已生成：$releaseApk" -ForegroundColor Green
                Write-Host "  [版本] versionName=$apkVersion versionCode=$apkCode" -ForegroundColor Green
            }
        } else {
            Write-Host "  [错误] 未找到 app-signedRelease.apk，不会使用未签名或旧产物。" -ForegroundColor Red
            $packagingFailed = $true
        }
    } else {
        Write-Host "  安卓打包失败，请检查上面的错误输出。" -ForegroundColor Red
        $packagingFailed = $true
    }

    }
    Write-Host ""
    Write-Host "==================================================" -ForegroundColor Green
    if ($packagingFailed) {
        Write-Host "  打包不完整：至少一个目标失败，请查看 windows-build.log / android-build.log。" -ForegroundColor Red
    } else {
        Write-Host "  所选目标 ($Targets) 已签名、校验并输出到:" -ForegroundColor Green
    }
    Write-Host "  $outDir" -ForegroundColor Yellow
    Write-Host "==================================================" -ForegroundColor Green
    Write-Host "  Linux 产物需在 Debian 家族主机上执行：MCTier-Linux/scripts/build.sh" -ForegroundColor DarkGray
    Write-Host "  （版本号已同步到共用的 tauri.conf.json，Linux 端直接沿用，无需再改）" -ForegroundColor DarkGray
    try { Invoke-Item $outDir } catch {}
    if ($packagingFailed) { exit 1 }
} else {
    Write-Host ""
    Write-Host "已跳过打包。如需打包：" -ForegroundColor Cyan
    Write-Host "  已签名构建：重新运行本脚本，可传入 -Targets Windows 或 -Targets Android。" -ForegroundColor Cyan
    Write-Host "  Linux：在 Debian 家族主机上执行 MCTier-Linux/scripts/build.sh（无法从 Windows 交叉编译）" -ForegroundColor Cyan
}

} finally {
    foreach ($name in $signingEnvironmentNames) { [Environment]::SetEnvironmentVariable($name, $previousSigningEnvironment[$name], 'Process') }
}
Write-Host ""
if ($KeepAndroidVersionCode) {
    Write-Host "提示：本次续跑保留同版本的安卓 versionCode；仅在版本号变化时递增。dist/、target/ 等构建产物会在打包时自动生成。" -ForegroundColor DarkGray
} elseif ($sameVersion) {
    Write-Host "提示：桌面端版本未变时仍会校验并同步安卓端；执行打包会递增 versionCode，确保同版本修复包可以覆盖安装。dist/、target/ 等构建产物会在打包时自动生成。" -ForegroundColor DarkGray
} else {
    Write-Host "提示：安卓端 versionCode 会在版本更新或重新打包时自动 +1；dist/、target/ 等构建产物会在打包时自动生成。" -ForegroundColor DarkGray
}
Write-Host ""
pause
