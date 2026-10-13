# Windows PowerShell 5.1 compatible. Download before Cargo so interrupted transfers
# can resume, and Windows system-proxy settings work without changing global env.
param([Parameter(Mandatory = $true)][string]$CargoTargetDirectory)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$cargo = [IO.File]::ReadAllText((Join-Path $repo 'src-tauri\Cargo.toml'))
$match = [regex]::Match($cargo, '(?m)^sherpa-onnx\s*=\s*"=([0-9.]+)"')
if (-not $match.Success) { throw 'Expected a pinned sherpa-onnx version in Cargo.toml.' }
$version = $match.Groups[1].Value
# Pinned from the official GitHub release asset metadata (size and SHA-256).
if ($version -ne '1.13.8') { throw 'Update the Sherpa archive checksum when upgrading Cargo.toml.' }
$expectedSize = 123206268
$expectedHash = '56ffcf3c454c1f14f7bc9887286cc8143e7e542dc632804e1c447d5f8d534eaf'
$stem = "sherpa-onnx-v$version-win-x64-static-MT-Release-lib"
$cache = Join-Path ([IO.Path]::GetFullPath($CargoTargetDirectory)) 'sherpa-onnx-prebuilt'
$archive = Join-Path $cache "$stem.tar.bz2"
$partial = "$archive.part"
$url = "https://github.com/k2-fsa/sherpa-onnx/releases/download/v$version/$stem.tar.bz2"

function Test-SherpaArchive([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    if ((Get-Item -LiteralPath $Path).Length -ne $expectedSize) { return $false }
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -eq $expectedHash
}

# Explicit environment proxies take precedence. curl reads those itself. ureq,
# used by the crate, does not read the Windows Internet Settings proxy.
$proxyArgs = @()
if ($env:HTTPS_PROXY -or $env:ALL_PROXY -or $env:HTTP_PROXY) {
    $proxy = @($env:HTTPS_PROXY, $env:ALL_PROXY, $env:HTTP_PROXY) | Where-Object { $_ } | Select-Object -First 1
    $proxyArgs = @('--proxy', $proxy)
    Write-Host '[Sherpa] Using environment proxy.'
} else {
    $settings = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction SilentlyContinue
    if ($settings.ProxyEnable -eq 1 -and $settings.ProxyServer) {
        $proxy = [string]$settings.ProxyServer
        if ($proxy.Contains('=')) {
            $perProtocol = @{}
            foreach ($item in $proxy.Split(';')) {
                $pair = $item.Split('=', 2)
                if ($pair.Length -eq 2) { $perProtocol[$pair[0].Trim()] = $pair[1].Trim() }
            }
            $proxy = $perProtocol['https']
            if (-not $proxy) { $proxy = $perProtocol['http'] }
        }
        if ($proxy) {
            if ($proxy -notmatch '^[a-z]+://') { $proxy = "http://$proxy" }
            $proxyArgs = @('--proxy', $proxy)
            Write-Host '[Sherpa] Using Windows system proxy.'
        }
    }
}
New-Item -ItemType Directory -Path $cache -Force | Out-Null
if (Test-SherpaArchive $archive) {
    Write-Host "[Sherpa] Verified cached archive: $archive"
    return
}
if (Test-Path -LiteralPath $archive) {
    # Preserve a corrupt cache for inspection, but prevent Cargo from using it.
    Move-Item -LiteralPath $archive -Destination "$archive.invalid-$(Get-Date -Format yyyyMMddHHmmssfff)"
}
for ($attempt = 1; $attempt -le 8; $attempt++) {
    if (Test-SherpaArchive $partial) {
        Move-Item -LiteralPath $partial -Destination $archive
        Write-Host '[Sherpa] Recovered a complete, verified partial download.'
        return
    }
    Write-Host "[Sherpa] Download attempt $attempt/8 (resuming): $url"
    & curl.exe --fail --location --progress-bar --connect-timeout 20 --max-time 300 --speed-limit 1024 --speed-time 30 --continue-at - --output $partial @proxyArgs $url
    $downloadExit = $LASTEXITCODE
    # Also allow a complete .part from an interrupted previous script invocation.
    if (($downloadExit -eq 0 -or $downloadExit -eq 33 -or $downloadExit -eq 22) -and (Test-SherpaArchive $partial)) {
        Move-Item -LiteralPath $partial -Destination $archive
        Write-Host "[Sherpa] Archive verified and cached. SHA256: $((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash)"
        return
    }
    if ($downloadExit -eq 0 -or $downloadExit -eq 33 -or
        ((Test-Path -LiteralPath $partial) -and (Get-Item -LiteralPath $partial).Length -ge $expectedSize)) {
        # A server refusing Range or a corrupt complete stream needs a fresh
        # transfer. Keep the rejected file rather than repeatedly appending to it.
        if (Test-Path -LiteralPath $partial) {
            Move-Item -LiteralPath $partial -Destination "$partial.rejected-$(Get-Date -Format yyyyMMddHHmmssfff)"
        }
    }
    Write-Host "[Sherpa] Transfer incomplete (curl exit $downloadExit); retrying."
}
throw "Sherpa download failed after 8 attempts. Partial data is kept for the next run: $partial"
