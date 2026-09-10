# Android Publisher Screen Sharing - 2026-09-10

## Findings

- Android remote control has STUN candidates, continual ICE gathering and MAXBUNDLE. Screen sharing previously used an empty ICE server list and default gathering/bundling. Both screen endpoints now retain host candidates and use the same STUN endpoints as Android remote control. This improves candidate availability; it does not provide TURN service or guarantee connectivity through every NAT.
- Desktop started a legacy offer after five seconds without video even after receiving a modern route. Android stores one outbound connection per share/viewer, so that second offer closes the first publisher connection. Meanwhile the 4.5-second first-frame deadline could report failure and start another route. Legacy fallback now runs only without an assigned upstream; modern routes get a 15-second first-frame budget within the existing 30-second overall viewing deadline.
- Duplicate route messages no longer replace a desktop connection already negotiating that route. Replaced desktop and Android connections cannot send late signaling or activate stale tracks. Android ICE application now compares the candidate route with the actual outbound connection route, including legacy/null routes.
- Android health messages lacked `limited`, which the desktop dispatcher requires to be boolean. They now include actual outbound frame counts and bandwidth limitation from RTC stats.
- The signaling server's typed relay message omitted `sequence`, `sourceSequence`, `sentSequence`, `limited`, and `reason`. Deserialization and reconstruction dropped these fields before forwarding. The server now preserves them and bounds counters/text. Registration, lobby isolation, peer generation and screen password/route checks remain enforced.

## Verification

- Windows `npm run tauri build -- --bundles nsis --ci` succeeded; the EXE and installer are in `../MCTier-屏幕共享修复-20260910/` alongside the new APK and signaling source archive.
- Desktop test suite passed (103 tests before adding the new fallback test); the updated media regression file passed all 6 cases, including legacy compatibility and Android health validation.
- Chromium used actual PeerConnections with ICE delivery delayed for seven seconds. It decoded 640x360 moving video, all 3072 inspected RGB values were nonblack, issued zero legacy offers, and reopened the viewer successfully. Results are in `verification-20260910/results.json`.
- Android `:app:testDebugUnitTest :app:assembleDebug --no-daemon` succeeded; the configured JUnit runner executed 5 tests. APK output: `MCTier-Android/app/build/outputs/apk/debug/app-debug.apk`.
- Signaling `cargo test`: 49 passed. Added serialization and authenticated WebSocket forwarding tests for Android-shaped health messages, including `limited: false` and session metadata.
- No device was attached to ADB during this work. Chromium tests do not exercise Android's native codec, MediaProjection, the user's VPN/network, or the deployed cloud server.

## Deployment

Update both clients and the signaling server for this repair. The client packaging entry remains `../一键更新MCTier版本.bat`; it includes these nested Android and desktop source changes. Running it does not deploy the cloud signaling service.

Replace the server source with this version, retain the deployment's existing environment, proxy configuration and persistent volume, and run `docker compose up -d --build mctier-signaling` in the server directory. Merely restarting an old image does not include the repaired relay schema.
