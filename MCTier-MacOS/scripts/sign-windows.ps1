param(
    [Parameter(Mandatory = $true)][string]$ConfigurationPath,
    [Parameter(Mandatory = $true)][string]$FilePath
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'release-signing.ps1')
try {
    $configuration = Read-MctierSigning $ConfigurationPath
    $certificate = Get-MctierWindowsCertificate $configuration
    $signTool = Find-MctierSignTool
    $arguments = @('sign', '/sha1', $certificate.Thumbprint, '/s', 'My', '/fd', 'SHA256', '/tr', $configuration.Windows.TimestampUrl, '/td', 'SHA256')
    if ($configuration.Windows.StoreLocation -eq 'LocalMachine') { $arguments += '/sm' }
    $arguments += [IO.Path]::GetFullPath($FilePath)
    & $signTool @arguments
    if ($LASTEXITCODE -ne 0) { throw 'SignTool signing/timestamping failed.' }
    Assert-MctierWindowsSignature $FilePath $certificate.Thumbprint $configuration.Windows.Mode
    if ($configuration.Windows.Mode -eq 'SelfSigned') { Write-Host '[Signed] Local self-signature verified. Windows SmartScreen may still warn.' -ForegroundColor Yellow }
} catch { Write-Error $_; exit 1 }
