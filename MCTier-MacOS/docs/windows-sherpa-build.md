# Windows Sherpa dependency preparation

The one-click version/build script runs `scripts/prepare-sherpa-windows.ps1`
before Cargo. Sherpa's own downloader reads proxy environment variables, but
does not automatically read the Windows Internet Settings proxy. Enabling a
system proxy therefore did not reliably route its GitHub asset download.

The preparation script uses an explicitly configured environment proxy first,
otherwise the enabled Windows system proxy (including per-protocol entries).
It downloads the official x64 MSVC static archive using curl, resumes `.part`
files after interruptions, and retries up to eight times. Each attempt has
connection, stall and total time limits. Failed HTTP requests preserve partial
data. An invalid completed archive is retained under a rejected filename.

The archive size and SHA-256 are pinned to the official GitHub release metadata
for Sherpa 1.13.8. Cargo only sees the final archive filename after validation.
Verified archives are reused without any network request. This is a build-time
dependency download; installed MCTier clients do not download this library.

To prepare it manually, use the same absolute target directory as Cargo:

```powershell
$env:CARGO_TARGET_DIR = 'D:\MCTierBuildCache'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\prepare-sherpa-windows.ps1 -CargoTargetDirectory $env:CARGO_TARGET_DIR
npm run tauri build -- --bundles nsis --ci
```

The outer `update_version.ps1` obtains this path from `build-paths.local.json`
and calls the preparation script automatically. To retry an already versioned
release without incrementing Android's versionCode again, invoke that script
with `-KeepAndroidVersionCode` and enter the current version.

When upgrading Sherpa in Cargo.toml, update the archive version, size and SHA-256
in the preparation script using the corresponding official release metadata.
