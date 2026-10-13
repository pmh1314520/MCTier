# Chat Media Update (2026-09-14)

## Implementation

- Desktop and Android share a sandboxed, offline PPTX slide renderer and libarchive WASM header viewer. ZIP, 7z, RAR4/5, TAR and compressed TAR formats use the same engine. Documents are not uploaded.
- Empty worksheet panels are filtered while retaining original sheet numbers. Zero values and boolean cells are not considered empty.
- Voice widths use the same formula on both clients: 144 + min(max(seconds, 0), 10) * 9.6 logical units, constrained by available message width. Playback and seeking remain custom controls.
- Desktop file/voice bubbles retain avatar clearance and text-bubble tails; attachment and emoji action icons use consistent size. Android retains its shared bubble-tail layout.
- Both clients use sherpa-onnx 1.13.8 with the same pinned SenseVoice int8 model. Initial model downloads show progress and verify file size and SHA-256 before replacing the local cache. Interrupted downloads are never treated as valid models. Transcripts remain below their voice message.

## Build

Run `npm ci` before building either client. `npm run build` and Android `preBuild` generate the same self-contained preview assets. Android downloads its pinned official sherpa AAR into the Gradle cache. Rust downloads its platform static libraries through sherpa-onnx-sys. No manually downloaded runtime file in the source directory is required.

For browser regression: `node scripts/verify-media-preview-browser.mjs <runtime-node-modules> <chromium-executable>`.

For actual model inference: set `MCTIER_SPEECH_TEST_CACHE` to an explicit cache directory, then run `cargo test --lib recognizes_real_chinese_and_english_offline -- --ignored --nocapture` from `src-tauri`. This opt-in test downloads the pinned model and public speech samples; ordinary unit tests do not download the model.

## Boundaries

- PPTX static slide appearance is supported, not PowerPoint animations or every advanced Office effect.
- Legacy binary PPT and ODP still require local Microsoft Office conversion on Windows. Android currently reports that these formats must be saved as PPTX/PDF; it no longer presents extracted text as a slide. This remains an explicit compatibility gap.
- Encrypted, damaged and resource-limit-exceeding archives/documents fail closed. Archive inner-file contents are not previewed.
- No Android device was connected during this work. JVM tests, APK assembly and browser rendering are not substitutes for Android JNI/codec/gesture verification or two-device lobby/private-message testing.
- Existing Android versionCode 67 and unrelated `network_service.rs.bak` were preserved.

## Local Disk

Generated Rust release/native-library/incremental caches (about 9.5 GiB) were moved to a local build-cache directory, with directory junctions preserving build paths. Source files and user data were not deleted. These local junctions are not repository dependencies.

## Verified Results

- `npm test`: 157 passing tests, including width and empty-sheet regression cases.
- `npm run build`: successful; existing chunk-size warnings remain.
- `cargo test --lib --no-fail-fast`: 209 passed; the network/model test is opt-in and skipped here.
- The opt-in sherpa test separately passed with real Chinese and English audio using the pinned model.
- `cargo build --bin mctier`: successful, including static sherpa/ONNX linking.
- Android `:app:jvmSecurityHardeningTest :app:assembleDebug`: 25 passing JVM tests and successful Debug APK assembly. APK contents include JNI libraries, model manifest and shared preview assets.
- Browser regressions cover 390px and 1100px widths, dark/light bubble geometry, avatar separation, tails, two rendered PPTX slides with actual shapes/images, ZIP/7z/RAR/TAR/TGZ file listings, and production-style CSP with script hashes. Existing feedback/search centering regression also passes.
