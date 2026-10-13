# PowerShell 5.1 compatible. Private keys/passwords must never be checked into Git.
function Invoke-MctierSigningTool {
    param([string]$Executable, [string[]]$Arguments)
    if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { throw "Signing tool not found: $Executable" }
    # Windows PowerShell 5.1 wraps redirected native stderr in ErrorRecord objects.
    # keytool writes successful export notices there; decide success by the exit code.
    # Keep this preference scoped to this invocation, never the caller/build pipeline.
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $PSNativeCommandUseErrorActionPreference = $false
    $previousExitCode = $global:LASTEXITCODE
    $global:LASTEXITCODE = $null
    try {
        $output = @(& $Executable @Arguments 2>&1)
        $exitCode = $global:LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousPreference
        $global:LASTEXITCODE = $previousExitCode
    }
    if ($null -eq $exitCode) { throw "Signing tool did not start: $Executable" }
    return [pscustomobject]@{ ExitCode = $exitCode; Output = @($output | ForEach-Object { [string]$_ }) }
}

function Read-MctierSigning {
    param([string]$ConfigurationPath)
    if (-not (Test-Path -LiteralPath $ConfigurationPath -PathType Leaf)) {
        throw "Missing signing configuration: $ConfigurationPath. Run scripts/setup-free-signing.ps1 first."
    }
    return ([IO.File]::ReadAllText($ConfigurationPath) | ConvertFrom-Json)
}

function Find-MctierAndroidSigningTools {
    param([string]$AndroidDirectory)
    $candidates = @($env:ANDROID_SDK_ROOT, $env:ANDROID_HOME)
    $properties = Join-Path $AndroidDirectory 'local.properties'
    if (Test-Path -LiteralPath $properties) {
        foreach ($line in [IO.File]::ReadAllLines($properties)) {
            if ($line -match '^sdk\.dir=(.+)$') { $candidates = @($Matches[1].Replace('\:', ':').Replace('\\', '\')) + $candidates }
        }
    }
    foreach ($sdk in ($candidates | Where-Object { $_ } | Select-Object -Unique)) {
        $dirs = @(Get-ChildItem -LiteralPath (Join-Path $sdk 'build-tools') -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending)
        foreach ($dir in $dirs) {
            $jar = Join-Path $dir.FullName 'lib\apksigner.jar'
            $aapt = Join-Path $dir.FullName 'aapt2.exe'
            if ((Test-Path -LiteralPath $jar) -and (Test-Path -LiteralPath $aapt)) {
                $java = (Get-Command java.exe -ErrorAction Stop).Source
                $keytool = Join-Path (Split-Path -Parent $java) 'keytool.exe'
                if (-not (Test-Path -LiteralPath $keytool)) { throw 'A full JDK including keytool is required.' }
                return [pscustomobject]@{ Java = $java; Keytool = $keytool; ApkSigner = $jar; Aapt = $aapt }
            }
        }
    }
    throw 'Android SDK build-tools with apksigner and aapt2 were not found.'
}

function Assert-MctierSha256 {
    param([string]$Fingerprint)
    if ($Fingerprint -notmatch '^[a-fA-F0-9]{64}$') { throw 'Expected a pinned 64-character SHA-256 certificate fingerprint.' }
}

function Initialize-MctierAndroidSigning {
    param($Configuration, $Tools)
    $config = $Configuration.Android
    Assert-MctierSha256 $config.CertificateSha256
    $key = [Environment]::ExpandEnvironmentVariables([string]$config.KeystorePath)
    if (-not [IO.Path]::IsPathRooted($key) -or -not (Test-Path -LiteralPath $key -PathType Leaf)) { throw 'Android signing keystore must be an existing absolute path; no replacement key will be generated.' }
    if (-not $config.KeyAlias) { throw 'Android KeyAlias is required.' }
    # A deliberate compatibility option, never an implicit fallback for missing release credentials.
    if ($config.UseLegacyDebugKey -eq $true) {
        $storePassword = 'android'; $keyPassword = 'android'
        Write-Host '[Signing] Reusing legacy Android debug identity for upgrade compatibility; this is NOT a new production certificate.' -ForegroundColor Yellow
    } else {
        $storePassword = [Environment]::GetEnvironmentVariable([string]$config.StorePasswordEnvironment)
        $keyPassword = [Environment]::GetEnvironmentVariable([string]$config.KeyPasswordEnvironment)
        if (-not $storePassword -or -not $keyPassword) { throw 'Set the configured Android password environment variables before building. Do not put passwords in JSON or command-line arguments.' }
    }
    $env:MCTIER_ANDROID_STORE_FILE = $key
    $env:MCTIER_ANDROID_KEY_ALIAS = [string]$config.KeyAlias
    $env:MCTIER_ANDROID_STORE_PASSWORD = $storePassword
    $env:MCTIER_ANDROID_KEY_PASSWORD = $keyPassword
    $temporary = Join-Path ([IO.Path]::GetTempPath()) ('mctier-signing-' + [guid]::NewGuid().ToString('N') + '.cer')
    try {
        $result = Invoke-MctierSigningTool $Tools.Keytool @('-exportcert', '-keystore', $key, '-alias', $config.KeyAlias, '-storepass:env', 'MCTIER_ANDROID_STORE_PASSWORD', '-file', $temporary)
        if ($result.ExitCode -ne 0) { throw 'Cannot read the configured Android certificate (check the keystore, alias and password).' }
        if ((Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash -ne $config.CertificateSha256) { throw 'Android keystore certificate differs from the pinned upgrade identity. Refusing to build.' }
    } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force } }
}

function Assert-MctierApkSignature {
    param([string]$ApkPath, $Tools, [string]$ExpectedSha256, [switch]$RequireRelease)
    Assert-MctierSha256 $ExpectedSha256
    $result = Invoke-MctierSigningTool $Tools.Java @('-jar', $Tools.ApkSigner, 'verify', '--verbose', '--print-certs', $ApkPath)
    if ($result.ExitCode -ne 0) { throw "APK signature verification failed: $ApkPath" }
    $report = $result.Output
    $fingerprints = @($report | ForEach-Object { if ([string]$_ -match '^Signer #\d+ certificate SHA-256 digest: ([a-fA-F0-9]{64})$') { $Matches[1] } })
    if ($fingerprints.Count -ne 1 -or $fingerprints[0] -ne $ExpectedSha256) { throw 'APK signer does not match the pinned upgrade identity.' }
    if (-not ($report -match 'Verified using v2 scheme .*: true')) { throw 'APK must have a valid v2 signature.' }
    if ($RequireRelease) {
        # Normal verification uses the manifest minSdk (26), so it can skip v1 even
        # when META-INF signatures exist. Check the JAR signature independently for
        # installer compatibility; this does not change the app's supported Android versions.
        $jarResult = Invoke-MctierSigningTool $Tools.Java @('-jar', $Tools.ApkSigner, 'verify', '--min-sdk-version', '23', '--max-sdk-version', '23', '--verbose', '--print-certs', $ApkPath)
        $jarReport = $jarResult.Output
        if ($jarResult.ExitCode -ne 0 -or -not ($jarReport -match 'Verified using v1 scheme .*: true')) {
            throw 'Distribution APK must also have a valid v1/JAR signature for installer compatibility.'
        }
        $jarFingerprints = @($jarReport | ForEach-Object { if ([string]$_ -match '^Signer #\d+ certificate SHA-256 digest: ([a-fA-F0-9]{64})$') { $Matches[1] } })
        if ($jarFingerprints.Count -ne 1 -or $jarFingerprints[0] -ne $ExpectedSha256) { throw 'APK v1 signer does not match the pinned upgrade identity.' }
        $badgingResult = Invoke-MctierSigningTool $Tools.Aapt @('dump', 'badging', $ApkPath)
        if ($badgingResult.ExitCode -ne 0) { throw 'Cannot inspect APK release flags.' }
        $badging = $badgingResult.Output
        if ($badging -match '^application-debuggable') { throw 'Refusing to publish a debuggable APK.' }
    }
    Write-Host "[Verified APK] SHA-256 certificate: $ExpectedSha256" -ForegroundColor Green
}

function Get-MctierWindowsCertificate {
    param($Configuration)
    if (-not (Get-PSDrive Cert -ErrorAction SilentlyContinue)) {
        Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
    }
    $config = $Configuration.Windows
    if ($config.CertificateThumbprint -notmatch '^[a-fA-F0-9]{40}$') { throw 'Configure Windows.CertificateThumbprint with the persistent code-signing identity; unsigned Windows releases are not exported.' }
    if ($config.StoreLocation -notin @('CurrentUser', 'LocalMachine')) { throw 'Windows StoreLocation must be CurrentUser or LocalMachine.' }
    $timestamp = $null
    if (-not [uri]::TryCreate([string]$config.TimestampUrl, [UriKind]::Absolute, [ref]$timestamp) -or $timestamp.Scheme -notin @('http','https')) { throw 'A valid RFC 3161 timestamp URL is required.' }
    $certificate = Get-Item -LiteralPath "Cert:\$($config.StoreLocation)\My\$($config.CertificateThumbprint)" -ErrorAction Stop
    if (-not $certificate.HasPrivateKey -or $certificate.NotAfter -le (Get-Date) -or $certificate.NotBefore -gt (Get-Date)) { throw 'Windows certificate has no private key or is not currently valid.' }
    if (-not ($certificate.EnhancedKeyUsageList | Where-Object { [string]$_.ObjectId -eq '1.3.6.1.5.5.7.3.3' })) { throw 'Windows certificate does not permit code signing.' }
    if ($config.Mode -notin @('SelfSigned', 'Trusted')) { throw 'Windows Mode must be SelfSigned or Trusted.' }
    if ($config.Mode -eq 'Trusted') {
        $chain = New-Object Security.Cryptography.X509Certificates.X509Chain
        try {
            if (-not $chain.Build($certificate)) { throw 'Windows code-signing certificate chain is not trusted or revocation checking failed.' }
        } finally { $chain.Dispose() }
    } elseif ($certificate.Subject -ne $certificate.Issuer) { throw 'SelfSigned mode requires the explicitly pinned self-issued certificate.' }
    return $certificate
}

function Find-MctierSignTool {
    $command = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $sdk = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
    foreach ($dir in @(Get-ChildItem -LiteralPath $sdk -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending)) {
        $candidate = Join-Path $dir.FullName 'x64\signtool.exe'
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    throw 'Install Windows SDK Signing Tools (signtool.exe).'
}

function Assert-MctierWindowsSignature {
    param([string]$Path, [string]$Thumbprint, [string]$Mode = 'Trusted')
    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    if ($signature.SignerCertificate.Thumbprint -ne $Thumbprint -or -not $signature.TimeStamperCertificate) {
        throw "Windows artifact must have a timestamped signature from the pinned publisher: $Path"
    }
    # Check Authenticode integrity, accepting ONLY the untrusted-root error in free mode.
    # Never accept HashMismatch/UnknownError wholesale or install our certificate as a root.
    if (-not ('MctierReleaseTrust' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class MctierReleaseTrust {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    struct FileInfo { public uint Size; [MarshalAs(UnmanagedType.LPWStr)] public string Path; public IntPtr File; public IntPtr Subject; }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    struct TrustData {
        public uint Size; public IntPtr Policy; public IntPtr Sip; public uint UI; public uint Revocation;
        public uint Choice; public IntPtr Info; public uint StateAction; public IntPtr State;
        public IntPtr URL; public uint Flags; public uint Context;
    }
    [DllImport("wintrust.dll", ExactSpelling=true, CharSet=CharSet.Unicode)]
    static extern uint WinVerifyTrust(IntPtr hwnd, [In] ref Guid action, ref TrustData data);
    public static uint Verify(string path) {
        var info = new FileInfo { Size=(uint)Marshal.SizeOf(typeof(FileInfo)), Path=path };
        var pointer = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(FileInfo)));
        Marshal.StructureToPtr(info, pointer, false);
        var data = new TrustData { Size=(uint)Marshal.SizeOf(typeof(TrustData)), UI=2, Choice=1, Info=pointer, StateAction=1 };
        var action = new Guid("00AAC56B-CD44-11d0-8CC2-00C04FC295EE");
        try { return WinVerifyTrust(new IntPtr(-1), ref action, ref data); }
        finally {
            data.StateAction=2; WinVerifyTrust(new IntPtr(-1), ref action, ref data);
            Marshal.DestroyStructure(pointer, typeof(FileInfo)); Marshal.FreeHGlobal(pointer);
        }
    }
}
'@
    }
    $result = [MctierReleaseTrust]::Verify([IO.Path]::GetFullPath($Path))
    $untrustedRoot = [Convert]::ToUInt32('800B0109', 16)
    if ($result -ne 0 -and -not ($Mode -eq 'SelfSigned' -and $result -eq $untrustedRoot)) {
        throw ('Windows signature verification failed: 0x{0:X8} ({1})' -f $result, $Path)
    }
}

function New-MctierTauriSigningConfig {
    param([string]$ConfigurationPath, [string]$OutputPath)
    # Structured args prevent spaces in source/build paths from becoming shell fragments.
    $command = @{ cmd = 'powershell.exe'; args = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'sign-windows.ps1'), '-ConfigurationPath', [IO.Path]::GetFullPath($ConfigurationPath), '-FilePath', '%1') }
    $overlay = @{ bundle = @{ windows = @{ signCommand = $command } } }
    [IO.File]::WriteAllText($OutputPath, ($overlay | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
}
