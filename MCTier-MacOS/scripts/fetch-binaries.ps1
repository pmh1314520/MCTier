<#
.SYNOPSIS
    获取 MCTier 构建所需的第三方二进制，并校验 SHA-256。

.DESCRIPTION
    src-tauri/src/modules/resource_manager.rs 使用编译期宏 include_bytes! 内嵌 4 个
    二进制文件。这些文件体积较大且受各自许可约束，因此按 .gitignore 规则不纳入
    Git 版本库。clone 仓库后需先准备好它们，否则 `cargo build` 会因找不到文件而失败。

    本脚本负责其中可直接再分发的 2 个驱动类文件，以及供本地调试的 easytier-web*：
      1. 从 EasyTier 官方 Release 下载 easytier-windows-x86_64-v2.5.0.zip；
      2. 从中提取 wintun.dll / WinDivert64.sys / easytier-web*.exe；
      3. 对每个文件校验 SHA-256，不匹配即报错退出；
      4. 复制到 src-tauri/resources/binaries/。

    easytier-core.exe 与 easytier-cli.exe 刻意不从官方发布包提取：官方构建在 PE
    导入表中静态导入 Npcap 的 packet.dll，而 Npcap 不是开源软件、未经 Nmap Project
    书面许可不得随其他软件再分发。MCTier 改为自行重建这两个文件以去掉该导入，
    请运行 scripts/build-easytier-npcap-free.ps1（详见 THIRD_PARTY_NOTICES.md §8）。

.NOTES
    本脚本获取的 4 个文件均可随 MCTier 再分发：wintun.dll 依 Wintun 预编译二进制
    许可，WinDivert64.sys 依 LGPL-3.0（双许可中所选分支）。不再获取任何 Npcap 文件。

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

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$TargetDir = Join-Path $RepoRoot 'src-tauri\resources\binaries'
$WorkDir = Join-Path ([System.IO.Path]::GetTempPath()) ('mctier-fetch-' + [Guid]::NewGuid().ToString('N'))
$MaximumArchiveBytes = 128MB
$MaximumExtractedBytes = 128MB
$MaximumEntryBytes = 64MB
$MaximumEntryCount = 1000
$MaximumRedirects = 3
$repoFullPath = [System.IO.Path]::GetFullPath($RepoRoot).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
$repoPrefix = $repoFullPath + [System.IO.Path]::DirectorySeparatorChar

function Test-PathWithinRepo([string]$Path) {
    $fullPath = [System.IO.Path]::GetFullPath($Path).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    return $fullPath.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)
}

function Assert-SafeTargetDirectory {
    $parent = Split-Path -Parent $TargetDir
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
        throw '目标目录的父目录不存在。'
    }
    $resolvedParent = (Resolve-Path -LiteralPath $parent).Path
    if (-not (Test-PathWithinRepo $resolvedParent)) {
        throw '目标目录必须位于仓库目录内。'
    }

    $target = Get-Item -LiteralPath $TargetDir -Force -ErrorAction SilentlyContinue
    if (-not $target) { return }
    if (-not $target.PSIsContainer) {
        throw '目标路径不是目录。'
    }
    if (($target.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw '拒绝使用重解析点作为目标目录。'
    }
    $resolvedTarget = (Resolve-Path -LiteralPath $TargetDir).Path
    if (-not (Test-PathWithinRepo $resolvedTarget)) {
        throw '目标目录解析后位于仓库外。'
    }
}

function Assert-SafeTargetFile([string]$Name) {
    $path = Join-Path $TargetDir $Name
    $item = Get-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
    if (-not $item) { return }
    if ($item.PSIsContainer -or (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) {
        throw "拒绝覆盖非普通目标文件: $Name"
    }
}

# EasyTier 官方 Windows 发布包（tag v2.5.0 / commit 88a45d115670631dfe6a05ba192387d615ddb95b）
$EasyTierVersion = 'v2.5.0'
$EasyTierUrl = "https://github.com/EasyTier/EasyTier/releases/download/$EasyTierVersion/easytier-windows-x86_64-$EasyTierVersion.zip"

# 期望的 SHA-256（大写）。任何不匹配都会中止，避免被篡改的依赖流入构建。
# 官方发布包中本脚本负责的条目。刻意不含 easytier-core/cli：那两个由
# build-easytier-npcap-free.ps1 自行重建，官方构建带有 Npcap 静态导入。
$Expected = [ordered]@{
    'easytier-web.exe'       = '4AFF79986A665F2919D32AE5BD928733A8C0555A474578D1E90AB96CE38F11EC'
    'easytier-web-embed.exe' = '3CE38602FD67499646CC8996D8B7A8A03E409C5F4B72623B09C97B97B75F850E'
    'wintun.dll'             = 'E5DA8447DC2C320EDC0FC52FA01885C103DE8C118481F683643CACC3220DAFCE'
    'WinDivert64.sys'        = '8DA085332782708D8767BCACE5327A6EC7283C17CFB85E40B03CD2323A90DDC2'
}

# 本脚本必须成功放置的文件。easytier-web* 仅供本地调试，缺失不阻塞。
$Required = @(
    'wintun.dll',
    'WinDivert64.sys'
)

# include_bytes! 需要但本脚本不负责的文件，由 build-easytier-npcap-free.ps1 产出。
# 这里只做存在性提示，不校验哈希——重建产物的哈希取决于工具链版本，写死会误报。
$BuiltLocally = @(
    'easytier-core.exe',
    'easytier-cli.exe'
)

function Get-Sha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToUpperInvariant()
}

function Test-ExistingFile([string]$Name) {
    $path = Join-Path $TargetDir $Name
    $item = Get-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
    if (-not $item -or $item.PSIsContainer -or (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) {
        return $false
    }
    return (Get-Sha256 $path) -eq $Expected[$Name]
}

function Test-AllowedDownloadUri([System.Uri]$Uri) {
    if (-not $Uri.IsAbsoluteUri -or $Uri.Scheme -ne 'https' -or $Uri.UserInfo) {
        throw "拒绝不安全的下载重定向: $Uri"
    }
    $uriHost = $Uri.Host.ToLowerInvariant()
    $allowed = $uriHost -eq 'github.com' -or
        $uriHost.EndsWith('.github.com', [System.StringComparison]::OrdinalIgnoreCase) -or
        $uriHost -eq 'githubusercontent.com' -or
        $uriHost.EndsWith('.githubusercontent.com', [System.StringComparison]::OrdinalIgnoreCase)
    if (-not $allowed) {
        throw "拒绝非 GitHub 官方下载主机: $uriHost"
    }
}

function Save-HttpDownload([System.Uri]$Uri, [string]$Destination, [long]$MaximumBytes) {
    Test-AllowedDownloadUri $Uri
    $handler = [System.Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $handler.AutomaticDecompression = [System.Net.DecompressionMethods]::None
    $client = [System.Net.Http.HttpClient]::new($handler)
    $client.Timeout = [System.TimeSpan]::FromSeconds(90)
    $client.DefaultRequestHeaders.UserAgent.ParseAdd('MCTier-fetch-binaries')
    $currentUri = $Uri
    try {
        for ($redirect = 0; $redirect -le $MaximumRedirects; $redirect++) {
            Test-AllowedDownloadUri $currentUri
            $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, $currentUri)
            try {
                $response = $client.SendAsync($request, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
            } finally {
                $request.Dispose()
            }

            try {
                $statusCode = [int]$response.StatusCode
                if ($statusCode -ge 300 -and $statusCode -lt 400) {
                    if ($redirect -ge $MaximumRedirects -or -not $response.Headers.Location) {
                        throw '下载重定向次数超过上限或缺少 Location。'
                    }
                    $nextUri = $response.Headers.Location
                    if (-not $nextUri.IsAbsoluteUri) { $nextUri = [System.Uri]::new($currentUri, $nextUri) }
                    Test-AllowedDownloadUri $nextUri
                    $currentUri = $nextUri
                    continue
                }
                if (-not $response.IsSuccessStatusCode) {
                    throw "下载失败，HTTP 状态码 $statusCode。"
                }

                $contentLength = $response.Content.Headers.ContentLength
                if ($null -ne $contentLength -and [long]$contentLength -gt $MaximumBytes) {
                    throw "下载内容超过大小上限 ($MaximumBytes 字节)。"
                }

                $input = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
                $output = [System.IO.File]::Open($Destination, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
                try {
                    $buffer = New-Object byte[] 65536
                    [long]$total = 0
                    while (($read = $input.Read($buffer, 0, $buffer.Length)) -gt 0) {
                        $total += $read
                        if ($total -gt $MaximumBytes) {
                            throw "下载内容超过大小上限 ($MaximumBytes 字节)。"
                        }
                        $output.Write($buffer, 0, $read)
                    }
                    $output.Flush()
                } finally {
                    $output.Dispose()
                    $input.Dispose()
                }
                return
            } finally {
                $response.Dispose()
            }
        }
        throw '下载重定向次数超过上限。'
    } finally {
        $client.Dispose()
        $handler.Dispose()
    }
}

function Test-ZipArchive([string]$Path) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($Path)
    [long]$totalBytes = 0
    [int]$entryCount = 0
    try {
        foreach ($entry in $archive.Entries) {
            $entryCount++
            if ($entryCount -gt $MaximumEntryCount) {
                throw "ZIP 条目数量超过上限 ($MaximumEntryCount)。"
            }
            $entryName = $entry.FullName.Replace('\', '/')
            if ([string]::IsNullOrWhiteSpace($entryName) -or $entryName.IndexOf([char]0) -ge 0) {
                throw 'ZIP 包含无效条目名称。'
            }
            if ($entryName.StartsWith('/') -or $entryName -match '^[A-Za-z]:/' -or $entryName -match '(^|/)\.\.(/|$)') {
                throw "ZIP 包含不安全的路径: $($entry.FullName)"
            }
            if ($entry.Length -gt $MaximumEntryBytes) {
                throw "ZIP 条目超过大小上限: $($entry.FullName)"
            }
            if ($entry.Length -gt ($MaximumExtractedBytes - $totalBytes)) {
                throw "ZIP 解压总大小超过上限 ($MaximumExtractedBytes 字节)。"
            }
            $totalBytes += $entry.Length
        }
    } finally {
        $archive.Dispose()
    }
}

function Copy-VerifiedZipEntries([string]$ZipPath, [string]$DestinationDir) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
    $failed = @()
    $copied = 0
    [long]$totalExtractedBytes = 0
    try {
        foreach ($name in $Expected.Keys) {
            $matches = @($archive.Entries | Where-Object {
                -not $_.FullName.EndsWith('/') -and
                [System.IO.Path]::GetFileName($_.FullName.Replace('/', [System.IO.Path]::DirectorySeparatorChar)) -ceq $name
            })
            if ($matches.Count -eq 0) {
                if ($Required -contains $name) { $failed += "${name}: 未在发布包中找到" }
                continue
            }
            if ($matches.Count -ne 1) {
                $failed += "${name}: 发布包中存在多个同名条目"
                continue
            }

            $entry = $matches[0]
            $destination = Join-Path $DestinationDir $name
            $input = $entry.Open()
            $output = [System.IO.File]::Open($destination, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
            try {
                $buffer = New-Object byte[] 65536
                [long]$total = 0
                while (($read = $input.Read($buffer, 0, $buffer.Length)) -gt 0) {
                    $total += $read
                    $totalExtractedBytes += $read
                    if ($total -gt $MaximumEntryBytes) { throw "ZIP 条目超过大小上限: $name" }
                    if ($totalExtractedBytes -gt $MaximumExtractedBytes) {
                        throw "ZIP 实际解压总大小超过上限 ($MaximumExtractedBytes 字节)。"
                    }
                    $output.Write($buffer, 0, $read)
                }
                $output.Flush()
            } finally {
                $output.Dispose()
                $input.Dispose()
            }

            $actual = Get-Sha256 $destination
            if ($actual -ne $Expected[$name]) {
                Remove-Item -LiteralPath $destination -Force -ErrorAction SilentlyContinue
                $failed += "${name}: SHA-256 不匹配`n    期望 $($Expected[$name])`n    实际 $actual"
                continue
            }
            Write-Host ("  [OK] {0,-24} {1}" -f $name, $actual) -ForegroundColor Green
            $copied++
        }
    } finally {
        $archive.Dispose()
    }
    if ($failed.Count -gt 0) {
        $failed | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
        throw '依赖校验未通过，已中止。请勿使用未校验的二进制进行构建。'
    }
    return $copied
}

Write-Host 'MCTier 构建依赖获取脚本' -ForegroundColor Cyan
Write-Host "目标目录: $TargetDir"
Write-Host ''
Write-Host '本脚本只获取可随 MCTier 再分发的文件（wintun.dll / WinDivert64.sys），' -ForegroundColor Yellow
Write-Host '不再获取任何 Npcap 文件。easytier-core/cli 请用 scripts\build-easytier-npcap-free.ps1' -ForegroundColor Yellow
Write-Host '自行重建，以去掉官方构建中对 Npcap packet.dll 的静态导入。' -ForegroundColor Yellow
Write-Host ''

Assert-SafeTargetDirectory
New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
Assert-SafeTargetDirectory

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

New-Item -ItemType Directory -Path $WorkDir | Out-Null
try {
    $zipPath = Join-Path $WorkDir 'easytier.zip'
    $stagingDir = Join-Path $WorkDir 'verified'
    $workItem = Get-Item -LiteralPath $WorkDir -Force
    if (($workItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw '拒绝使用重解析点作为临时工作目录。'
    }
    New-Item -ItemType Directory -Path $stagingDir | Out-Null
    Write-Host "正在下载 EasyTier $EasyTierVersion ..."
    Write-Host "  $EasyTierUrl"
    Save-HttpDownload ([System.Uri]::new($EasyTierUrl)) $zipPath $MaximumArchiveBytes
    Write-Host ("  下载完成: {0:N0} 字节" -f (Get-Item -LiteralPath $zipPath).Length)

    Test-ZipArchive $zipPath
    $copied = Copy-VerifiedZipEntries $zipPath $stagingDir

    Write-Host ''
    Write-Host "完成，共放置 $copied 个文件。" -ForegroundColor Green

    # Only publish after every required entry has passed verification, so a
    # failed download can never leave a mixed set of dependencies in place.
    Get-ChildItem -LiteralPath $stagingDir -File | ForEach-Object {
        Assert-SafeTargetFile $_.Name
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $TargetDir $_.Name) -Force
    }
    Assert-SafeTargetDirectory

    $stillMissing = @($Required | Where-Object { -not (Test-ExistingFile $_) })
    if ($stillMissing.Count -gt 0) {
        throw ('仍缺少必需文件: ' + ($stillMissing -join ', '))
    }
    Write-Host '本脚本负责的文件均已就位。' -ForegroundColor Green

    # include_bytes! 还需要重建出来的那两个文件。这里只提示、不代为构建：
    # 重建耗时数分钟且需要额外工具链，静默触发会让人摸不着头脑。
    $missingBuilt = @($BuiltLocally | Where-Object { -not (Test-Path -LiteralPath (Join-Path $TargetDir $_)) })
    if ($missingBuilt.Count -gt 0) {
        Write-Host ''
        Write-Host ('还缺少需自行重建的文件: ' + ($missingBuilt -join ', ')) -ForegroundColor Yellow
        Write-Host '请先运行: .\scripts\build-easytier-npcap-free.ps1' -ForegroundColor Yellow
    } else {
        Write-Host 'include_bytes! 所需的 4 个二进制均已就位，现在可以执行 npm run tauri build。' -ForegroundColor Green
    }
} finally {
    $workItem = Get-Item -LiteralPath $WorkDir -Force -ErrorAction SilentlyContinue
    if ($workItem -and $workItem.PSIsContainer -and (($workItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0)) {
        Remove-Item -LiteralPath $WorkDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
