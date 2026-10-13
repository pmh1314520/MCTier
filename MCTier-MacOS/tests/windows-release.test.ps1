param([Parameter(Mandatory = $true)][string]$FixtureDirectory)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\scripts\windows-release.ps1')
$physicalRelease = Join-Path $FixtureDirectory 'physical\release'
$target = Join-Path $FixtureDirectory 'target'
$junction = Join-Path $target 'release'
$output = Join-Path $FixtureDirectory 'output'
New-Item -ItemType Directory -Path $physicalRelease, $target -Force | Out-Null
$exe = Join-Path $physicalRelease 'mctier.exe'
Add-Type -TypeDefinition @'
using System.Reflection;
[assembly: AssemblyInformationalVersion("3.4.0")]
public class ReleaseFixture { public static void Main() {} }
'@ -OutputAssembly $exe -OutputType ConsoleApplication
$nsis = Join-Path $physicalRelease 'bundle\nsis'
New-Item -ItemType Directory -Path $nsis -Force | Out-Null
$installer = Join-Path $nsis 'MCTier_3.4.0_x64-setup.exe'
[IO.File]::WriteAllBytes($installer, [byte[]](1, 2, 3, 4))
New-Item -ItemType Junction -Path $junction -Target $physicalRelease | Out-Null

# Reproduce the old script under precisely the runtime used by the user's BAT.
$legacy = @(Get-ChildItem $target -Recurse -Filter 'mctier.exe' -File)
if ($legacy.Count -ne 0) { throw 'Expected Windows PowerShell 5.1 to skip the junction.' }
$copied = @(Export-MctierWindowsRelease -ReleaseDirectory $junction -OutputDirectory $output -Version '3.4.0')
if ($copied.Count -ne 2) { throw 'Both Windows artifacts must be copied.' }
foreach ($name in @('MCTier.exe', 'MCTier_3.4.0_x64-setup.exe')) {
    if (-not (Test-Path -LiteralPath (Join-Path $output $name))) { throw "Missing copied artifact: $name" }
}
Write-Output 'PASS: junction output discovery and hash-verified export'

function Assert-ExportFails([string]$Version, [string]$ExpectedError, [string]$Destination) {
    $failed = $false
    try { Export-MctierWindowsRelease -ReleaseDirectory $junction -OutputDirectory $Destination -Version $Version | Out-Null }
    catch {
        if ($_.Exception.Message -notlike "*$ExpectedError*") { throw }
        $failed = $true
    }
    if (-not $failed) { throw 'Invalid output unexpectedly accepted.' }
    if (Test-Path -LiteralPath $Destination) { throw 'Invalid set was partially exported.' }
}
[IO.File]::WriteAllBytes((Join-Path $nsis 'MCTier_3.5.0_x64-setup.exe'), [byte[]](1))
Assert-ExportFails '3.5.0' 'version mismatch' (Join-Path $FixtureDirectory 'wrong-version')
Write-Output 'PASS: wrong executable version rejected before copying'
Assert-ExportFails '3.6.0' 'Missing Windows build artifact' (Join-Path $FixtureDirectory 'missing-installer')
Write-Output 'PASS: missing exact-version installer rejected; no older-version fallback'
[IO.File]::WriteAllBytes($installer, [byte[]]@())
Assert-ExportFails '3.4.0' 'Missing Windows build artifact' (Join-Path $FixtureDirectory 'empty-installer')
Write-Output 'PASS: empty artifact rejected before copying'

$localConfig = Join-Path $FixtureDirectory 'build-paths.local.json'
$unsetPaths = Read-MctierBuildPaths -ConfigurationPath $localConfig
if ($unsetPaths.CargoTargetDirectory -or $unsetPaths.ReleaseRoot) { throw 'Absent local config must preserve default behavior.' }
Write-Output 'PASS: optional local build configuration'

$newCache = Join-Path $FixtureDirectory 'fresh-cache'
$settings = @{ CargoTargetDirectory = $newCache; ReleaseRoot = $output; TemporaryDirectory = (Join-Path $FixtureDirectory 'temp') }
[IO.File]::WriteAllText($localConfig, ($settings | ConvertTo-Json))
$configured = Read-MctierBuildPaths -ConfigurationPath $localConfig
# The production reader normalizes short Windows paths (for example RUNNER~1).
if ($configured.CargoTargetDirectory -ne [IO.Path]::GetFullPath($newCache) -or $configured.ReleaseRoot -ne [IO.Path]::GetFullPath($output)) { throw 'Physical cache and export roots were not preserved.' }
if (Test-Path -LiteralPath $newCache) { throw 'Reading configuration must not create cache directories.' }
Write-Output 'PASS: explicit physical paths without filesystem mutation'

[IO.File]::WriteAllText($localConfig, '{"CargoTargetDirectory":"relative/cache"}')
$rejected = $false
try { Read-MctierBuildPaths -ConfigurationPath $localConfig | Out-Null } catch {
    if ($_.Exception.Message -notlike '*must be absolute*') { throw }
    $rejected = $true
}
if (-not $rejected) { throw 'Relative build path was accepted.' }
Write-Output 'PASS: ambiguous relative build path rejected'
