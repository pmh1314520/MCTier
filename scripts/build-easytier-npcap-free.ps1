<#
.SYNOPSIS
    构建不依赖 Npcap 的 EasyTier（easytier-core.exe / easytier-cli.exe）。

.DESCRIPTION
    EasyTier 官方 Windows 发布包里的 easytier-core.exe 在 PE 导入表中静态导入
    packet.dll（Npcap），因此缺少 Packet.dll 时会直接以 0xC0000135 启动失败——
    即使全程使用 wintun 模式、从未打开任何 datalink channel 也一样。

    该依赖并非功能需要：它只是 pnet_datalink 0.35.0 在 src/bindings/winpcap.rs 中
    无条件 #[link(name = "Packet")] 的连带结果，而 pnet_datalink 又由 pnet 的默认
    std feature 间接引入。Npcap 不是开源软件，未经 Nmap Project 书面许可不得随
    其他软件再分发，因此 MCTier 选择重建 EasyTier 把这个导入去掉，而不是继续捆绑。

    本脚本会：
      1. 以 --depth 1 克隆 EasyTier 源码到临时目录，检出 $EasyTierTag；
      2. 从 crates.io 下载 pnet_datalink 0.35.0 源码，应用
         patches/pnet_datalink-0.35.0-no-npcap.patch，放到 vendor/pnet_datalink/；
      3. 在根 Cargo.toml 追加 [patch.crates-io] 指向该 vendor 目录；
      4. cargo build --release 出 easytier-core / easytier-cli；
      5. 解析产物 PE 导入表，确认其中不含 packet.dll —— 这一步是硬门槛，
         不通过即中止，避免"看起来构建成功但其实依赖仍在"；
      6. 复制到 src-tauri/resources/binaries/。

    刻意不关闭 pnet 的默认 feature：那样会连 pnet::datalink::interfaces() 一起去掉，
    而 EasyTier 在 Windows 上把它用作接口枚举失败时的回退路径。补丁只改链接方式，
    不改可用能力。

.NOTES
    需要：git、cargo（MSVC 工具链）、tar，以及 EasyTier 自身构建所需的
    protoc 与 libclang（可用环境变量 PROTOC / LIBCLANG_PATH 指定）。

.EXAMPLE
    .\scripts\build-easytier-npcap-free.ps1
    .\scripts\build-easytier-npcap-free.ps1 -KeepWorkDir
#>
param(
    # 构建完成后保留临时目录，便于排查构建失败。
    [switch]$KeepWorkDir,
    # 只构建与校验，不复制到 resources/binaries。
    [switch]$NoInstall
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# 与 THIRD_PARTY_NOTICES.md 中登记的版本保持一致；改这里就要同步改那里。
$EasyTierTag = 'v2.5.0'
$EasyTierRepo = 'https://github.com/EasyTier/EasyTier.git'
$PnetDatalinkVersion = '0.35.0'
$PnetDatalinkUrl = "https://static.crates.io/crates/pnet_datalink/pnet_datalink-$PnetDatalinkVersion.crate"

$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$TargetDir = Join-Path $RepoRoot 'src-tauri\resources\binaries'
$PatchFile = Join-Path $RepoRoot 'patches\pnet_datalink-0.35.0-no-npcap.patch'
$WorkDir = Join-Path ([System.IO.Path]::GetTempPath()) ('mctier-easytier-' + [Guid]::NewGuid().ToString('N'))

if (-not (Test-Path -LiteralPath $PatchFile)) {
    throw "缺少补丁文件: $PatchFile"
}

function Assert-Tool([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "未找到必需工具: $Name"
    }
}

# 读取 PE 导入表中的 DLL 名称。用它做构建后门禁，比"能不能跑起来"更早、更确定：
# 静态导入由加载器在进程启动时解析，只要名字还在表里就一定是硬依赖。
function Get-PeImportedDlls([string]$Path) {
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $peOffset = [System.BitConverter]::ToInt32($bytes, 0x3c)
    if ([System.Text.Encoding]::ASCII.GetString($bytes, $peOffset, 2) -ne 'PE') {
        throw "不是有效的 PE 文件: $Path"
    }
    $coff = $peOffset + 4
    $sectionCount = [System.BitConverter]::ToUInt16($bytes, $coff + 2)
    $optionalSize = [System.BitConverter]::ToUInt16($bytes, $coff + 16)
    $optional = $coff + 20
    $isPe32Plus = [System.BitConverter]::ToUInt16($bytes, $optional) -eq 0x20b
    $dataDirs = $optional + $(if ($isPe32Plus) { 112 } else { 96 })
    $importRva = [System.BitConverter]::ToUInt32($bytes, $dataDirs + 8)

    $sections = @()
    $sectionBase = $optional + $optionalSize
    for ($i = 0; $i -lt $sectionCount; $i++) {
        $s = $sectionBase + $i * 40
        $sections += [pscustomobject]@{
            VirtualSize    = [System.BitConverter]::ToUInt32($bytes, $s + 8)
            VirtualAddress = [System.BitConverter]::ToUInt32($bytes, $s + 12)
            RawSize        = [System.BitConverter]::ToUInt32($bytes, $s + 16)
            RawAddress     = [System.BitConverter]::ToUInt32($bytes, $s + 20)
        }
    }

    $convert = {
        param([uint32]$Rva)
        foreach ($s in $sections) {
            $span = [Math]::Max($s.VirtualSize, $s.RawSize)
            if ($Rva -ge $s.VirtualAddress -and $Rva -lt ($s.VirtualAddress + $span)) {
                return $s.RawAddress + ($Rva - $s.VirtualAddress)
            }
        }
        return -1
    }

    $names = @()
    if ($importRva -ne 0) {
        $descriptor = & $convert $importRva
        for ($i = 0; $descriptor -ge 0; $i++) {
            $entry = $descriptor + $i * 20
            if (($entry + 20) -gt $bytes.Length) { break }
            $nameRva = [System.BitConverter]::ToUInt32($bytes, $entry + 12)
            $lookup = [System.BitConverter]::ToUInt32($bytes, $entry)
            if ($nameRva -eq 0 -and $lookup -eq 0) { break }
            $nameOffset = & $convert $nameRva
            if ($nameOffset -lt 0) { continue }
            $end = $nameOffset
            while ($end -lt $bytes.Length -and $bytes[$end] -ne 0) { $end++ }
            $names += [System.Text.Encoding]::ASCII.GetString($bytes, $nameOffset, $end - $nameOffset)
        }
    }
    return $names
}

Assert-Tool git
Assert-Tool cargo
Assert-Tool tar

Write-Host 'MCTier: 构建不依赖 Npcap 的 EasyTier' -ForegroundColor Cyan
Write-Host "  EasyTier 版本: $EasyTierTag"
Write-Host "  补丁: $PatchFile"
Write-Host "  临时目录: $WorkDir"
Write-Host ''

New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null
try {
    $srcDir = Join-Path $WorkDir 'EasyTier'
    Write-Host "正在克隆 EasyTier $EasyTierTag ..."
    git clone --depth 1 --branch $EasyTierTag $EasyTierRepo $srcDir
    if ($LASTEXITCODE -ne 0) { throw 'git clone 失败。' }

    # 记录实际 commit，便于把产物与源码对应起来。
    $commit = (& git -C $srcDir rev-parse HEAD).Trim()
    Write-Host "  commit: $commit"

    Write-Host "正在获取 pnet_datalink $PnetDatalinkVersion 源码 ..."
    $cratePath = Join-Path $WorkDir 'pnet_datalink.crate'
    Invoke-WebRequest -Uri $PnetDatalinkUrl -OutFile $cratePath -MaximumRedirection 3
    $crateDir = Join-Path $WorkDir 'crate'
    New-Item -ItemType Directory -Path $crateDir -Force | Out-Null
    tar -xzf $cratePath -C $crateDir
    if ($LASTEXITCODE -ne 0) { throw '解压 pnet_datalink 源码失败。' }

    $vendorRoot = Join-Path $srcDir 'vendor'
    $vendorDir = Join-Path $vendorRoot 'pnet_datalink'
    New-Item -ItemType Directory -Path $vendorRoot -Force | Out-Null
    Copy-Item -Recurse -Path (Join-Path $crateDir "pnet_datalink-$PnetDatalinkVersion") -Destination $vendorDir

    Write-Host '正在应用去 Npcap 补丁 ...'
    Push-Location $vendorDir
    try {
        # --check 先行：宁可在这里明确失败，也不要打进半个补丁再去构建。
        git apply --check $PatchFile
        if ($LASTEXITCODE -ne 0) { throw '补丁无法应用（上游源码版本可能已变化）。' }
        git apply $PatchFile
        if ($LASTEXITCODE -ne 0) { throw '应用补丁失败。' }
    } finally {
        Pop-Location
    }
    Write-Host '  补丁已应用。' -ForegroundColor Green

    $rootManifest = Join-Path $srcDir 'Cargo.toml'
    $patchStanza = @(
        '',
        '# MCTier: 用打过补丁的 pnet_datalink 替换上游版本，移除对 Npcap Packet.dll',
        '# 的静态链接依赖。详见 patches/pnet_datalink-0.35.0-no-npcap.patch。',
        '[patch.crates-io]',
        'pnet_datalink = { path = "vendor/pnet_datalink" }',
        ''
    ) -join [Environment]::NewLine
    Add-Content -LiteralPath $rootManifest -Value $patchStanza -Encoding UTF8

    Write-Host ''
    Write-Host '正在构建（release，首次可能需要数分钟）...'
    Push-Location $srcDir
    try {
        cargo build --release --bin easytier-core --bin easytier-cli
        if ($LASTEXITCODE -ne 0) { throw 'cargo build 失败。' }
    } finally {
        Pop-Location
    }

    Write-Host ''
    Write-Host '正在校验产物不再导入 packet.dll ...'
    $built = @{}
    $failed = @()
    foreach ($name in @('easytier-core.exe', 'easytier-cli.exe')) {
        $path = Join-Path $srcDir "target\release\$name"
        if (-not (Test-Path -LiteralPath $path)) { throw "构建产物缺失: $name" }
        $imports = Get-PeImportedDlls $path
        $offenders = @($imports | Where-Object { $_ -match '(?i)packet|pcap' })
        if ($offenders.Count -gt 0) {
            $failed += "${name}: 仍然导入 $($offenders -join ', ')"
            continue
        }
        $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToUpperInvariant()
        Write-Host ("  [OK] {0,-20} SHA-256 {1}" -f $name, $hash) -ForegroundColor Green
        $built[$name] = $path
    }
    if ($failed.Count -gt 0) {
        $failed | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
        throw '产物仍依赖 Npcap，已中止。'
    }

    if ($NoInstall) {
        Write-Host ''
        Write-Host "已按 -NoInstall 跳过复制。产物位于: $srcDir\target\release" -ForegroundColor Yellow
    } else {
        New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
        foreach ($name in @('easytier-core.exe', 'easytier-cli.exe')) {
            Copy-Item -LiteralPath $built[$name] -Destination (Join-Path $TargetDir $name) -Force
        }
        # 发布包里同时带 -x86_64-pc-windows-msvc 后缀的同名副本，一并同步，
        # 避免两者版本不一致造成排查困难。
        Copy-Item -LiteralPath $built['easytier-core.exe'] -Destination (Join-Path $TargetDir 'easytier-core-x86_64-pc-windows-msvc.exe') -Force
        Copy-Item -LiteralPath $built['easytier-cli.exe'] -Destination (Join-Path $TargetDir 'easytier-cli-x86_64-pc-windows-msvc.exe') -Force
        Write-Host ''
        Write-Host "已复制到: $TargetDir" -ForegroundColor Green
    }

    Write-Host ''
    Write-Host "完成。EasyTier $EasyTierTag ($commit)，已移除 Npcap 依赖。" -ForegroundColor Green
    Write-Host '如产物 SHA-256 有变化，请同步更新 THIRD_PARTY_NOTICES.md。'
} finally {
    if ($KeepWorkDir) {
        Write-Host "已保留临时目录: $WorkDir" -ForegroundColor Yellow
    } else {
        $item = Get-Item -LiteralPath $WorkDir -Force -ErrorAction SilentlyContinue
        if ($item -and $item.PSIsContainer -and (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0)) {
            Remove-Item -LiteralPath $WorkDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
