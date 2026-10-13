param([Parameter(Mandatory = $true)][string]$FixtureDirectory)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\scripts\release-signing.ps1')
function Expect-Rejection([scriptblock]$Action, [string]$Message) {
    $rejected = $false
    try { & $Action | Out-Null } catch { $rejected = $true }
    if (-not $rejected) { throw "Expected rejection: $Message" }
    Write-Output "PASS: $Message"
}
Expect-Rejection { Read-MctierSigning (Join-Path $FixtureDirectory 'missing.json') } 'missing config fails closed'
Expect-Rejection { Assert-MctierSha256 'not-a-fingerprint' } 'invalid Android identity rejected'
$configPath = Join-Path $FixtureDirectory 'signing config.json'
$overlayPath = Join-Path $FixtureDirectory 'tauri config.json'
New-MctierTauriSigningConfig $configPath $overlayPath
$overlay = [IO.File]::ReadAllText($overlayPath) | ConvertFrom-Json
$arguments = @($overlay.bundle.windows.signCommand.args)
# Windows PowerShell expands runner paths such as RUNNER~1 during GetFullPath.
# Compare the same canonical form that the signing configuration promises.
if ($arguments[-1] -ne '%1' -or $arguments -notcontains [IO.Path]::GetFullPath($configPath)) { throw 'Signing arguments lost path boundaries.' }
Write-Output 'PASS: Tauri signing preserves paths with spaces and placeholder'
$exe = Join-Path $FixtureDirectory 'unsigned.exe'
Add-Type -TypeDefinition 'public class SigningFixture { public static int Main(string[] args) { System.Console.WriteLine("native output"); System.Console.Error.WriteLine("certificate export notice"); return args.Length == 0 ? 0 : 7; } }' -OutputAssembly $exe -OutputType ConsoleApplication
$native = Invoke-MctierSigningTool $exe @()
if ($native.ExitCode -ne 0 -or $native.Output -notcontains 'certificate export notice' -or $native.Output -notcontains 'native output') { throw 'Native stderr success was not captured.' }
if ($ErrorActionPreference -ne 'Stop') { throw 'Native invocation changed the caller error policy.' }
Write-Output 'PASS: PowerShell 5.1 accepts successful native stderr without weakening caller policy'
$native = Invoke-MctierSigningTool $exe @('fail')
if ($native.ExitCode -ne 7) { throw 'Native failure exit code was lost.' }
Write-Output 'PASS: native failure exit code survives stderr capture'
Expect-Rejection { Assert-MctierWindowsSignature $exe ('0' * 40) 'SelfSigned' } 'unsigned executable rejected even in free mode'
if ($env:MCTIER_SIGNING_TEST_CONFIG) {
    $config = Read-MctierSigning $env:MCTIER_SIGNING_TEST_CONFIG
    $androidTools = Find-MctierAndroidSigningTools (Join-Path $PSScriptRoot '..\MCTier-Android')
    $environmentNames = @('MCTIER_ANDROID_STORE_FILE', 'MCTIER_ANDROID_KEY_ALIAS', 'MCTIER_ANDROID_STORE_PASSWORD', 'MCTIER_ANDROID_KEY_PASSWORD')
    $previousEnvironment = @{}
    foreach ($name in $environmentNames) { $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name) }
    $originalAlias = $config.Android.KeyAlias
    $originalFingerprint = $config.Android.CertificateSha256
    try {
        Initialize-MctierAndroidSigning $config $androidTools
        Write-Output 'PASS: real keytool export and pinned identity work under PowerShell 5.1 Stop policy'
        $config.Android.KeyAlias = 'mctier-test-nonexistent-alias'
        Expect-Rejection { Initialize-MctierAndroidSigning $config $androidTools } 'real keytool failure still blocks signing'
        $config.Android.KeyAlias = $originalAlias
        $config.Android.CertificateSha256 = '0' * 64
        Expect-Rejection { Initialize-MctierAndroidSigning $config $androidTools } 'wrong Android certificate still blocks signing'
    } finally {
        $config.Android.KeyAlias = $originalAlias
        $config.Android.CertificateSha256 = $originalFingerprint
        foreach ($name in $environmentNames) { [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process') }
    }
    & (Join-Path $PSScriptRoot '..\scripts\sign-windows.ps1') -ConfigurationPath $env:MCTIER_SIGNING_TEST_CONFIG -FilePath $exe
    if ($LASTEXITCODE -ne 0) { throw 'Signing fixture failed.' }
    Assert-MctierWindowsSignature $exe $config.Windows.CertificateThumbprint $config.Windows.Mode
    Write-Output 'PASS: actual Authenticode signature and timestamp verified'
    Expect-Rejection { Assert-MctierWindowsSignature $exe ('0' * 40) $config.Windows.Mode } 'wrong publisher rejected'
    $bytes = [IO.File]::ReadAllBytes($exe)
    $bytes[1024] = $bytes[1024] -bxor 1
    [IO.File]::WriteAllBytes($exe, $bytes)
    Expect-Rejection { Assert-MctierWindowsSignature $exe $config.Windows.CertificateThumbprint $config.Windows.Mode } 'tampered signed executable rejected'
}
