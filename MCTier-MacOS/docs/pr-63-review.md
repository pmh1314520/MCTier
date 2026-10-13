# PR #63 review

Audited source: `a21393e1aa0bf1d4ac40b4f3ec9793aedec452d7` against desktop `master` `6240cf882448d2c4b0305f46fff33de994ca87a5`.

## Accepted

- Split Tauri command registration into `command_registry.rs`; verified all 163 command names and their order are unchanged.
- Added bounded tail log reading and moved logging work off the async executor.
- Added typed internal application errors while preserving existing string IPC responses.
- Reduced unnecessary `AppCore` lock duration for read/accessor commands and retained lifecycle serialization for file-server/share mutations.
- Added lock-order and microphone read/modify/write regression coverage.
- Added the shared signaling message inventory and protocol-version compatibility checks.
- Added architecture guidance and focused protocol/registration regression tests.

## Corrections and exclusions

- Excluded the PR's `.github` directory and ignore-file exceptions so dot-prefixed directories and generated/local material are not introduced.
- Kept the original core gate around the five file-server/share mutation commands; the refactor's broader lock reduction could change lifecycle ordering.
- Corrected architecture wording to describe the actual create/join/leave lock scope rather than claiming the whole lobby lifecycle is atomic.
- No dependency, credential, telemetry, shell-download, or external endpoint injection was found in the reviewed changes.

## Verification

- `npm test`: 318 passed.
- `npm run build`: passed (existing chunk-size warning).
- `cargo check --locked --lib --tests`: passed.
- `cargo test --locked --lib --tests -- --test-threads=1`: 274 passed, 11 ignored; native security: 10 passed.
- Native WebView2 startup/recording fixture: passed.
- `gradlew.bat :app:assembleDebug :app:assembleDebugAndroidTest :app:testDebugUnitTest --console=plain`: passed; 88 JVM security checks passed. The Android build intentionally skips its standard `testDebugUnitTest` task in favor of the configured JVM security task.
- MuMu instrumentation: lobby, settings, compatibility, prompts, buttons, and recording/voice checks passed; recording covered system audio/microphone combinations and voice-message/WebRTC use during recording.
- MuMu legacy encrypted-state/WorkManager and light/dark settings/agreements checks passed. Cloud transfer responses were faked; real user Quark credentials were not used.
- The first Android recording run failed a 250 ms audio-gap threshold (about 276 ms) during desktop compilation. A subsequent full recording run passed. Android recording source is unchanged by these PRs; this is recorded as an intermittent result, not dismissed as proven harmless.
- Full ESLint remains a pre-existing baseline failure (changed `WebRTCClient.ts` has identical 29 errors/193 warnings before and after the PR).
- Full desktop `cargo fmt --all -- --check` remains unsuccessful because of existing formatting differences; focused formatting checks for the new registry, error/log modules and core changes passed.
- Hardware-dependent EasyTier, live Quark, and some real capture tests remain ignored.
- These results do not cover every device, physical network, production TLS proxy, or real game session. No guarantee of zero defects is implied.
