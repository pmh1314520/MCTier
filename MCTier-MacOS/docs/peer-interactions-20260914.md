# Avatar Viewing and Private Conversation Preferences

## Behavior

- Other members' image avatars open the same fullscreen viewer as chat images, including player lists, public chat, private peer lists and private messages. Initial-letter avatars do not open a viewer. Own avatars retain upload/edit behavior.
- Desktop uses a body portal so transformed ancestors cannot offset or clip the viewer. Zoom, pan, close, Escape, focus restoration and keyboard focus containment are supported. Android reuses its pinch/pan image dialog.
- Desktop peer rows support right-click and Shift+F10; Android supports touch long-press, including the avatar. Viewing an avatar does not enter the private conversation.
- Pinning sorts online peers first, preserving the original order within each group. Pin, DND and manual unread preferences persist locally by the full public-key fingerprint, never by name, IP or roster position.
- Leaving/rejoining does not erase preferences. A changed nickname still matches the same identity. Another member with the same nickname does not inherit preferences. Offline members are not displayed; manual unread remains saved but does not produce an inaccessible global badge while that peer is absent.
- DND applies only to private messages: delivery and per-peer unread remain enabled; message sounds, danmaku and global unread counts exclude muted private conversations. Lobby messages keep their existing rules. Entering a visible private conversation clears its manual unread marker.
- Settings apply on the device where the user changed them, not automatically across their own devices.

## Identity and Security

The previous identity was regenerated per lobby. Reliable preference restoration therefore required changing identity lifetime, not simply saving the temporary player ID.

- Desktop stores the P-256 private scalar in the OS credential store as `MCTier/chat-identity-p256-v1`; it never enters frontend state or localStorage.
- Android stores the key pair through the existing AES-GCM/Android Keystore preference wrapper. Restoration verifies that its public and private keys match. Corrupt/unavailable credentials fail closed rather than silently creating a new identity.
- Session authorization, registration challenges, tokens, generations and replay checks still apply. Clearing a session disables signing until registration is established again.
- This is an installation identity. It is linkable across lobbies, and changing/deleting its protected credential creates a new identity. It does not add forward secrecy: the existing P-256 key is also used by the chat encryption protocol. Separate ephemeral agreement keys would require a versioned protocol change.
- Peers running older versions still regenerate their identities and cannot reliably retain preferences across their own rejoin. Both endpoints must update for stable behavior. No nickname-based migration is attempted.

## Changed Areas

- Desktop: `Avatar.tsx`, shared `ImageViewer.tsx`, `ChatRoom.tsx`/CSS, `MiniWindow.tsx`, `appStore.ts`, `peerPreferences.ts`.
- Native desktop: `chat_auth.rs`, `chat_service.rs`.
- Android: `MctierApp.kt`, `MctierRepository.kt`, `SecurePreferenceStore.kt`, `ChatAuth.kt`, `PeerPreferences.kt`.
- Tests: peer preference unit tests on both platforms, Rust identity restoration test, Playwright UI script, test-only Android instrumentation runner and Gradle test registration.

## Verification

- `npm test`: 160 passing.
- `npm run build`: passing, existing bundle-size warnings remain.
- `cargo test --lib --no-fail-fast`: 210 passing, one opt-in speech-model download/inference test ignored in the default suite.
- `cargo build --bin mctier`: passing.
- `gradlew.bat :app:jvmSecurityHardeningTest :app:assembleDebug --console=plain`: 28 passing and APK built.
- `scripts/verify-peer-ui-browser.mjs`: actual components at 1100px and 390px widths, dark/light themes; avatar bitmap and centering, inert initials, own upload, click propagation, pin/DND/unread, leave/rejoin and reload restoration.
- MuMu via ADB: non-destructive APK update; actual Keystore restoration plus synthetic-peer UI tests for player/public/private avatar viewers, touch long-press menus, persisted preference writes, rejoin and unread clearing. Screenshots inspected in both themes. The instrumentation lives only in the test APK and restores the preferences it touches.
- No claim of exhaustive application validation or real two-device lobby transport validation: the new UI tests deliberately use synthetic peers and do not prove actual peer connectivity, message/audio delivery, NAT traversal or every media format.

## Local Build Storage

The previous task's generated cache directory was moved from C: to `D:\文件盘扩展\MCTierBuildCache-20260914`, with a compatibility junction. The desktop `target/debug/deps` directory was also moved into its `debug-deps` subdirectory and replaced with a junction, releasing approximately 10.2 GiB on E:. No source files or user documents were deleted.
