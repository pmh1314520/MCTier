param(
    [string]$ConfigurationPath = (Join-Path $PSScriptRoot '..\signing.local.json'),
    [string]$PreviousApk,
    [string]$LegacyKeystore = (Join-Path $env:USERPROFILE '.android\debug.keystore')
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'release-signing.ps1')
if (Test-Path -LiteralPath $ConfigurationPath) {
    Write-Host 'Signing configuration already exists; keeping the current identities.'
    exit 0
}
if (-not $PreviousApk -or -not (Test-Path -LiteralPath $PreviousApk -PathType Leaf)) { throw 'Provide -PreviousApk with a previously distributed APK to pin the upgrade identity.' }
if (-not (Test-Path -LiteralPath $LegacyKeystore -PathType Leaf)) { throw 'The original Android key is missing. Do not generate a replacement for existing users.' }
$tools = Find-MctierAndroidSigningTools (Join-Path $PSScriptRoot '..\MCTier-Android')
$result = Invoke-MctierSigningTool $tools.Java @('-jar', $tools.ApkSigner, 'verify', '--print-certs', $PreviousApk)
if ($result.ExitCode -ne 0) { throw 'Previous APK signature is invalid.' }
$report = $result.Output
$fingerprints = @($report | ForEach-Object { if ([string]$_ -match '^Signer #\d+ certificate SHA-256 digest: ([a-fA-F0-9]{64})$') { $Matches[1] } })
if ($fingerprints.Count -ne 1) { throw 'Expected exactly one previous APK signer.' }
$directory = Join-Path $env:USERPROFILE '.mctier-signing'
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$keystore = Join-Path $directory 'android-upgrade.keystore'
if (-not (Test-Path -LiteralPath $keystore)) { Copy-Item -LiteralPath $LegacyKeystore -Destination $keystore }
$config = [pscustomobject]@{
    Android = [pscustomobject]@{ KeystorePath=$keystore; KeyAlias='androiddebugkey'; CertificateSha256=$fingerprints[0]; UseLegacyDebugKey=$true; StorePasswordEnvironment='MCTIER_STORE_PASSWORD'; KeyPasswordEnvironment='MCTIER_KEY_PASSWORD' }
    Windows = [pscustomobject]@{ Mode='SelfSigned'; CertificateThumbprint=''; StoreLocation='CurrentUser'; TimestampUrl='http://timestamp.digicert.com' }
}
$names = @('MCTIER_ANDROID_STORE_FILE','MCTIER_ANDROID_KEY_ALIAS','MCTIER_ANDROID_STORE_PASSWORD','MCTIER_ANDROID_KEY_PASSWORD')
$previous = @{}; foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name) }
try { Initialize-MctierAndroidSigning $config $tools }
finally { foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') } }
if (-not (Get-PSDrive Cert -ErrorAction SilentlyContinue)) {
    Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
}
$certificate = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Where-Object { $_.FriendlyName -eq 'MCTier local release signing' -and $_.HasPrivateKey -and $_.NotAfter -gt (Get-Date).AddDays(30) } | Select-Object -First 1
if (-not $certificate) {
    if (-not (Get-Command New-SelfSignedCertificate -ErrorAction SilentlyContinue)) {
        Import-Module (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\Modules\PKI\PKI.psd1') -ErrorAction Stop
    }
    $certificate = New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=MCTier' -FriendlyName 'MCTier local release signing' -CertStoreLocation 'Cert:\CurrentUser\My' -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -KeyExportPolicy Exportable -NotAfter (Get-Date).AddYears(5)
}
$config.Windows.CertificateThumbprint = $certificate.Thumbprint
# No root/TrustedPublisher certificate is installed. Other machines will not trust this identity.
[IO.File]::WriteAllBytes((Join-Path $directory 'MCTier-publisher.cer'), $certificate.Export([Security.Cryptography.X509Certificates.X509ContentType]::Cert))
[IO.File]::WriteAllText([IO.Path]::GetFullPath($ConfigurationPath), ($config | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))
Write-Host "Signing configured: $ConfigurationPath" -ForegroundColor Green
Write-Host 'Windows uses a FREE SELF-SIGNED certificate; SmartScreen/unknown publisher warnings may remain. Back up your Android key and Windows certificate private key.' -ForegroundColor Yellow
