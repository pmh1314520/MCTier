param([Parameter(Mandatory = $true)][string]$FixtureDirectory)
$ErrorActionPreference = 'Stop'
$prepare = Join-Path $PSScriptRoot '..\scripts\prepare-sherpa-windows.ps1'
$name = 'sherpa-onnx-v1.13.8-win-x64-static-MT-Release-lib.tar.bz2'

# Simulate real curl outcomes without network access or a 123 MB fixture.
function global:curl.exe {
    if ($args -notcontains '--continue-at') { throw 'Retry must request resume.' }
    if ($args -notcontains '--fail') { throw 'HTTP errors must fail the transfer.' }
    $global:downloadCalls++
    $output = $args[[Array]::IndexOf($args, '--output') + 1]
    if (-not (Test-Path -LiteralPath $output)) { [IO.File]::WriteAllBytes($output, [byte[]](1, 2, 3)) }
    $global:LASTEXITCODE = $global:simulatedCurlExit
}
foreach ($code in @(28, 22, 0)) {
    $target = Join-Path $FixtureDirectory "case-$code"
    $cache = Join-Path $target 'sherpa-onnx-prebuilt'
    New-Item -ItemType Directory -Path $cache -Force | Out-Null
    $partial = Join-Path $cache "$name.part"
    [IO.File]::WriteAllBytes($partial, [byte[]](1, 2, 3))
    $global:downloadCalls = 0
    $global:simulatedCurlExit = $code
    $failed = $false
    try { & $prepare -CargoTargetDirectory $target }
    catch {
        if ($_.Exception.Message -notlike '*failed after 8 attempts*') { throw }
        $failed = $true
    }
    if (-not $failed -or $global:downloadCalls -ne 8) { throw 'Retry budget was not enforced.' }
    if (Test-Path -LiteralPath (Join-Path $cache $name)) { throw 'Invalid bytes were published to Cargo.' }
    if ($code -ne 0) {
        if (-not (Test-Path -LiteralPath $partial) -or (Get-Item -LiteralPath $partial).Length -ne 3) {
            throw 'Timeout or HTTP error discarded resumable data.'
        }
    } else {
        if (@(Get-ChildItem -LiteralPath $cache -Filter '*.rejected-*').Count -ne 8) {
            throw 'Corrupt completed transfers must be quarantined before restarting.'
        }
    }
    Write-Output "PASS: curl exit $code never publishes corrupt data and obeys retry policy"
}
