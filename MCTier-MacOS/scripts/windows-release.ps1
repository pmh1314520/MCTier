# PowerShell 5.1 compatible: access release paths directly, never recurse through junctions.
function Read-MctierBuildPaths {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$ConfigurationPath)

    $paths = [ordered]@{ CargoTargetDirectory = $null; ReleaseRoot = $null; TemporaryDirectory = $null; GradleUserHome = $null }
    if (-not (Test-Path -LiteralPath $ConfigurationPath)) { return [pscustomobject]$paths }
    $configuration = [IO.File]::ReadAllText($ConfigurationPath) | ConvertFrom-Json
    foreach ($property in $configuration.PSObject.Properties) {
        if (-not $paths.Contains($property.Name)) { throw "Unknown build path setting: $($property.Name)" }
        $value = $property.Value
        if ($value -isnot [string] -or $value -notmatch '^(?:[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+)') {
            throw "Build path must be absolute: $($property.Name)"
        }
        if (Test-Path -LiteralPath $value -PathType Leaf) { throw "Build path is a file: $($property.Name)" }
        $paths[$property.Name] = [IO.Path]::GetFullPath($value)
    }
    return [pscustomobject]$paths
}

function Export-MctierWindowsRelease {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$ReleaseDirectory,
        [Parameter(Mandatory = $true)][string]$OutputDirectory,
        [Parameter(Mandatory = $true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version,
        $SigningConfiguration
    )
    $executable = Join-Path $ReleaseDirectory 'mctier.exe'
    $installerName = "MCTier_${Version}_x64-setup.exe"
    $installer = Join-Path $ReleaseDirectory "bundle\nsis\$installerName"
    # Validate the entire set before copying anything. An older version's installer is not a fallback.
    foreach ($path in @($executable, $installer)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or (Get-Item -LiteralPath $path).Length -eq 0) {
            throw "Missing Windows build artifact: $path"
        }
    }
    $actualVersion = (Get-Item -LiteralPath $executable).VersionInfo.ProductVersion
    if ($actualVersion -ne $Version) {
        throw "Windows executable version mismatch: expected $Version, actual '$actualVersion'."
    }
    if ($SigningConfiguration) {
        . (Join-Path $PSScriptRoot 'release-signing.ps1')
        foreach ($path in @($executable, $installer)) {
            Assert-MctierWindowsSignature $path $SigningConfiguration.Windows.CertificateThumbprint $SigningConfiguration.Windows.Mode
        }
    }
    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
    $artifacts = @(
        @{ Source = $executable; Destination = (Join-Path $OutputDirectory 'MCTier.exe') },
        @{ Source = $installer; Destination = (Join-Path $OutputDirectory $installerName) }
    )
    foreach ($artifact in $artifacts) {
        Copy-Item -LiteralPath $artifact.Source -Destination $artifact.Destination -Force -ErrorAction Stop
        if ((Get-FileHash -LiteralPath $artifact.Source -Algorithm SHA256).Hash -ne
            (Get-FileHash -LiteralPath $artifact.Destination -Algorithm SHA256).Hash) {
            throw "Windows artifact copy checksum mismatch: $($artifact.Destination)"
        }
    }
    return $artifacts.Destination
}
