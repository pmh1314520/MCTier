<#
.SYNOPSIS
    获取 MCTier 构建所需的第三方二进制，并校验 SHA-256。

.DESCRIPTION
    src-tauri/src/modules/resource_manager.rs 使用编译期宏 include_bytes! 内嵌 5 个
    二进制文件。这些文件受版权/许可限制（尤其是 Npcap，见 THIRD_PARTY_NOTICES.md §8），
    因此按 .gitignore 规则不纳入 Git 版本库。clone 仓库后需先运行本脚本，否则
    `cargo build` 会因找不到文件而失败。

    本脚本会：
      1. 从 EasyTier 官方 Release 下载 easytier-windows-x86_64-v2.5.0.zip；
      2. 从中提取 easytier-core.exe / easytier-cli.exe / easytier-web*.exe /
         wintun.dll / WinDivert64.sys / Packet.dll；
      3. 对每个文件校验 SHA-256，不匹配即报错退出；
      4. 复制到 src-tauri/resources/binaries/。

.NOTES
    Npcap 授权提示：Packet.dll 属 Npcap（Insecure.Com LLC），
    不是开源软件，未经 Nmap Project 书面许可不得再分发。本脚本仅在你本机从
    EasyTier 官方发布包中提取以供本地构建；如需分发请自行确认授权，
    或改为引导用户从 https://npcap.com 自行安装。详见 THIRD_PARTY_NOTICES.md §8。

.EXAMPLE
    .\scripts\fetch-binaries.ps1
    .\scripts\fetch-binaries.ps1 -Force
#>
param(
    # 已存在且校验通过的文件默认跳过；-Force 则强制重新下载覆盖。
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepoRoot = Split-Path -Parent $PSScriptRoot
$TargetDir = Join-Path $RepoRoot 'src-tauri\resources\binaries'
$WorkDir = Join-Path ([System.IO.Path]::GetTempPath()) ('mctier-fetch-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))

# EasyTier 官方 Windows 发布包（tag v2.5.0 / commit 88a45d115670631dfe6a05ba192387d615ddb95b）
$EasyTierVersion = 'v2.5.0'
$EasyTierUrl = "https://github.com/EasyTier/EasyTier/releases/download/$EasyTierVersion/easytier-windows-x86_64-$EasyTierVersion.zip"

# 期望的 SHA-256（大写）。任何不匹配都会中止，避免被篡改的依赖流入构建。
$Expected = [ordered]@{
    'easytier-core.exe'      = 'A47B63A7763FB4CCF9D56F3A7E936163619C89A1E34C9D1E84022375A7D2711F'
    'easytier-cli.exe'       = '83A31B18CB92436BFD6D85C4A22B27594FB5A2EC7BB1E46ADF9245EBD935667B'
    'easytier-web.exe'       = '4AFF79986A665F2919D32AE5BD928733A8C0555A474578D1E90AB96CE38F11EC'
    'easytier-web-embed.exe' = '3CE38602FD67499646CC8996D8B7A8A03E409C5F4B72623B09C97B97B75F850E'
    'wintun.dll'             = 'E5DA8447DC2C320EDC0FC52FA01885C103DE8C118481F683643CACC3220DAFCE'
    'WinDivert64.sys'        = '8DA085332782708D8767BCACE5327A6EC7283C17CFB85E40B03CD2323A90DDC2'
    'Packet.dll'             = 'C7C03A87EAC7243CCBE331554624B18803010B740E311FC8CFDDB573096EACAC'
}

# include_bytes! 真正需要的 5 个文件；其余为 EasyTier 附带，一并放置以便本地调试。
# 注意：Packet.lib 只是链接期导入库，运行时不需要，因此不再获取也不再随包分发（见 THIRD_PARTY_NOTICES.md §8）。
$Required = @(
    'easytier-core.exe',
    'easytier-cli.exe',
    'Packet.dll',
    'wintun.dll',
    'WinDivert64.sys'
)

function Get-Sha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToUpperInvariant()
}

function Test-ExistingFile([string]$Name) {
    $path = Join-Path $TargetDir $Name
    if (-not (Test-Path -LiteralPath $path)) { return $false }
    return (Get-Sha256 $path) -eq $Expected[$Name]
}

Write-Host 'MCTier 构建依赖获取脚本' -ForegroundColor Cyan
Write-Host "目标目录: $TargetDir"
Write-Host ''
Write-Host 'Npcap 许可提示: Packet.dll 属 Npcap (Insecure.Com LLC)，非开源软件，' -ForegroundColor Yellow
Write-Host '未经 Nmap Project 书面许可不得随其他软件再分发。详见 THIRD_PARTY_NOTICES.md 第 8 节。' -ForegroundColor Yellow
Write-Host ''

New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null

if (-not $Force) {
    $missing = @($Required | Where-Object { -not (Test-ExistingFile $_) })
    if ($missing.Count -eq 0) {
        Write-Host '所有必需二进制均已存在且 SHA-256 校验通过，无需下载。' -ForegroundColor Green
        Write-Host '如需强制重新获取，请使用 -Force。'
        return
    }
    Write-Host ("缺失或校验不通过的文件: " + ($missing -join ', '))
    Write-Host ''
}

New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
try {
    $zipPath = Join-Path $WorkDir 'easytier.zip'
    Write-Host "正在下载 EasyTier $EasyTierVersion ..."
    Write-Host "  $EasyTierUrl"
    $progressPreferenceBackup = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'
    try {
        Invoke-WebRequest -Uri $EasyTierUrl -OutFile $zipPath -UseBasicParsing -Headers @{ 'User-Agent' = 'MCTier-fetch-binaries' }
    } finally {
        $ProgressPreference = $progressPreferenceBackup
    }
    Write-Host ("  下载完成: {0:N0} 字节" -f (Get-Item -LiteralPath $zipPath).Length)

    $extractDir = Join-Path $WorkDir 'extracted'
    New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
    Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir -Force

    $failed = @()
    $copied = 0
    foreach ($name in $Expected.Keys) {
        $found = Get-ChildItem -LiteralPath $extractDir -Recurse -File -Filter $name -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if (-not $found) {
            if ($Required -contains $name) { $failed += "${name}: 未在发布包中找到" }
            continue
        }

        $actual = Get-Sha256 $found.FullName
        if ($actual -ne $Expected[$name]) {
            $failed += "${name}: SHA-256 不匹配`n    期望 $($Expected[$name])`n    实际 $actual"
            continue
        }

        Copy-Item -LiteralPath $found.FullName -Destination (Join-Path $TargetDir $name) -Force
        Write-Host ("  [OK] {0,-24} {1}" -f $name, $actual) -ForegroundColor Green
        $copied++
    }

    if ($failed.Count -gt 0) {
        Write-Host ''
        Write-Host '以下文件校验失败：' -ForegroundColor Red
        $failed | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
        throw '依赖校验未通过，已中止。请勿使用未校验的二进制进行构建。'
    }

    Write-Host ''
    Write-Host "完成，共放置 $copied 个文件。" -ForegroundColor Green

    $stillMissing = @($Required | Where-Object { -not (Test-ExistingFile $_) })
    if ($stillMissing.Count -gt 0) {
        throw ('仍缺少必需文件: ' + ($stillMissing -join ', '))
    }
    Write-Host 'include_bytes! 所需的 5 个二进制均已就位，现在可以执行 npm run tauri build。' -ForegroundColor Green
} finally {
    if (Test-Path -LiteralPath $WorkDir) {
        Remove-Item -LiteralPath $WorkDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}