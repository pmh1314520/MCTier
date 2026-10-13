# Quark login and upgrade regression

Run commands from the repository containing `src-tauri` and `MCTier-Android`
(the nested `MCTier` desktop application directory, not its parent).

## Android

```powershell
cd MCTier-Android
.\gradlew.bat :app:assembleDebug :app:assembleDebugAndroidTest :app:testDebugUnitTest --console=plain
.\gradlew.bat :app:testDebugUnitTest --tests "*Quark*" --console=plain
adb -s 192.168.0.103:5555 install -r app/build/outputs/apk/debug/app-debug.apk
adb -s 192.168.0.103:5555 install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb -s 192.168.0.103:5555 shell am instrument -w -e check quark-buttons top.pmh13.mctier.test/top.pmh13.mctier.PeerUiInstrumentation
adb -s 192.168.0.103:5555 shell am instrument -w -e check quark-work top.pmh13.mctier.test/top.pmh13.mctier.PeerUiInstrumentation
adb -s 192.168.0.103:5555 shell am instrument -w -e check quark-upgrade-seed top.pmh13.mctier.test/top.pmh13.mctier.PeerUiInstrumentation
adb -s 192.168.0.103:5555 install -r app/build/outputs/apk/debug/app-debug.apk
Start-Sleep -Seconds 8
adb -s 192.168.0.103:5555 shell am instrument -w -e check quark-upgrade-verify top.pmh13.mctier.test/top.pmh13.mctier.PeerUiInstrumentation
adb -s 192.168.0.103:5555 shell am instrument -w -e check quark-media top.pmh13.mctier.test/top.pmh13.mctier.PeerUiInstrumentation
adb -s 192.168.0.103:5555 shell am instrument -w -e check remote-frame top.pmh13.mctier.test/top.pmh13.mctier.PeerUiInstrumentation
```

Use the connected device's actual serial. Inspect instrumentation's `PASS` / `FAIL`
output: adb's exit code alone does not indicate assertion success. The existing
Gradle workaround runs JUnitCore through `jvmSecurityHardeningTest`; AGP's
`testDebugUnitTest` is disabled. Its `--tests` filter does not restrict this custom
runner, which ran all 78 tests, including the Quark test classes.

The upgrade fixture uses synthetic credentials and refuses to replace a real
logged-in account. Run seed and verify on the same Beijing calendar day. Verify
restores the original state, including on assertion failure. If interrupted
between commands, run instrumentation with `-e check quark-upgrade-cleanup`.
Do not clear app data or uninstall to reset this fixture.

Do not immediately start instrumentation after APK replacement: Android stops
the target process to start instrumentation, which can kill the asynchronous
update receiver before its WorkManager transaction completes. The wait allows
the actual package-replaced broadcast to finish; verify checks scheduling before
calling status or launching the UI.

Observed on MuMu (API 32, x86_64, 1080x1920): all five checks passed. Button
checks measure screenshot glyph bounds at 320dp and 360dp and switch the actual
phone-mode chip. Upgrade checks retain the encrypted file hash, account/name,
absolute cookie expiry and two contribution days; exactly one job exists before
UI launch and today's ledger prevents duplicate transfer. Work checks also cover
AtomicFile backup recovery, missing legacy fields, offline retries, concurrency,
invalid/account-changed verification preserving credentials and explicit logout.
No SMS or real cloud transfer is submitted. Screenshots are in the app's external
`files/media-checks` directory.

## Windows

```powershell
cd src-tauri
cargo test --release --lib quark --no-run
# Return to the repository root after compiling.
cd ..
& ./.artifacts/quark-upgrade-test.exe quark --nocapture
& ./.artifacts/quark-upgrade-test.exe modules::app_paths::tests --nocapture
& ./scripts/test-quark-background.ps1 -TestExecutable .artifacts/quark-upgrade-test.exe
node --test tests/quark-support.test.mjs tests/quark-mobile-login.test.mjs
```

The test EXE is an isolated copy of Cargo's compiled library test executable,
with the Common Controls v6 manifest embedded using the workaround documented
in `android-quark-remote-regression.md`. Do not alter the product executable.

Observed: 25 Quark tests and 3 migration tests passed. Four Rust tests are marked
ignored; the background script separately ran both scheduler/storage probes and
passed actual Windows task registration/update/run/removal, same-user vault
decryption, shared encrypted statistics, daily deduplication and logout checks.
The other two ignored tests (Windows invitation WebView and full Windows-to-Android
remote bridge) were not run in this regression. All 10 JavaScript tests passed.

The NSIS hook compiled with LogicLib and an UpdateMode variable in an isolated
harness using `makensis /INPUTCHARSET UTF8`. Source review confirms
`--quark-background-uninstall` is guarded by `$UpdateMode <> 1`; a full Windows
installer replacement was not executed. GUI and background retain
`data_root()/quark-support.bin` and keyring entry `quark-support-v1`; the background
CLI now migrates legacy paths before opening shared state. Android retains
`quark-support.bin` and Keystore alias `mctier-quark-v1`.
