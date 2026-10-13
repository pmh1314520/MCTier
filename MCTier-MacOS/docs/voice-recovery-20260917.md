# Voice Recovery, 2026-09-17

## Confirmed Code Defects

- Desktop media-stall detection called a scheduler that cancelled recovery whenever the PeerConnection was still connected. Manual forced recovery also passed through an unconditional connected/fresh guard, after already telling the remote peer to discard its connection.
- Desktop discarded valid streamless audio track events. It relied on autoplay without retrying paused playback, and reused negotiation paths that did not always flush queued ICE.
- Both clients needed deterministic offer-collision handling and stale-callback protection. Android mutated peer state from native callbacks and coroutine threads without one owner.
- Android treated only exceptions from addIceCandidate as failure. The API can return false before remote SDP is ready, silently losing candidates.
- Android full reconnection removed playerVolumes, losing effective per-player mute/group routing. Its connected-state RTP statistics were only logged, not used for recovery.

These are independently reproducible defects that can cause or prolong one-way voice. No packet capture or logs from the reported user incident were available, so they do not establish the sole cause of every reported failure.

## Changes

- Both clients sample health every two seconds. Android retains the separate 400 ms speaking indicator sampling.
- A bounded, optional WebRTC data channel named mctier-voice-health-v1 exchanges only cumulative audio RTP packet counts. RTCP remote-outbound counters remain a fallback. No audio, transcript, credentials, or new signaling message type is sent.
- Inbound stagnation requires evidence that remote RTP transmission is progressing. Silence, DTX, missing/stale telemetry, counter resets, and brief loss do not trigger media recovery.
- A missing/ended negotiated audio receiver, incorrect audio direction, or persistent sender-binding failure can also trigger repair. Paused desktop playback and detached live receivers are repaired locally first.
- Sustained media faults require eight seconds of evidence, plus the sampling interval. Per-peer retry backoff is 30, 60, then 120 seconds; rebuilding the PC does not erase it. One minute of healthy receiving clears old backoff. This is deliberately not an instant-disconnect-on-silence policy.
- Existing authenticated voice-reconnect signaling coordinates full rebuilds. Simultaneous repair elects the larger player ID as offerer; the other side yields. Missing initial offers and abandoned reconnection attempts have timeouts.
- Android peer state/native callback work is serialized on Main, with connection-generation checks. Early ICE false returns and exceptions enter the existing bounded TTL cache. Rebuilds retain volumes; actual departures clear them.
- Desktop offer, answer, track, health, and connection callbacks check connection identity. Answer generation binds the microphone to the offered audio m-line. Local microphone transitions cannot be overwritten by health sampling; ended desktop capture tracks trigger bounded capture recovery, and one failed peer binding does not abort all peers.
- Global mute, per-peer mute/volume, voice groups, and chat-recording transmit suppression remain authoritative. Health checks never enable the local microphone or bypass the capture gate.

## Files

- src/services/webrtc/WebRTCClient.ts
- src/services/webrtc/voiceHealth.ts
- MCTier-Android/app/src/main/java/top/pmh13/mctier/network/AndroidRtcController.kt
- MCTier-Android/app/src/main/java/top/pmh13/mctier/network/VoiceHealth.kt
- MCTier-Android/app/src/main/java/top/pmh13/mctier/MctierRepository.kt (route manual voice recovery through the controller)
- MCTier-Android/app/build.gradle.kts (register the new JVM test class)
- tests/voice-health.test.mjs
- tests/voice-recovery.test.mjs
- MCTier-Android/app/src/test/java/top/pmh13/mctier/network/VoiceHealthTest.kt

Existing unrelated worktree changes were preserved. No server changes, deployment, release publication, or installation were performed.

## Validation

- npm test: 181 passed. New tests cover policy and the real desktop orchestration with mocked platform/media implementations: connected-state repair, streamless tracks, policy-before-playback, stale callbacks, ICE flushing, glare, pending-offer invalidation, persistent replaceTrack failure, microphone-transition isolation, simultaneous rebuild arbitration, and cancellation on departure.
- npm run build: passed. Existing large-chunk and mixed static/dynamic import warnings remain.
- cargo test --lib --no-fail-fast: 210 passed, 1 ignored. Existing Rust warnings remain.
- gradlew.bat :app:jvmSecurityHardeningTest :app:assembleDebug --console=plain: 36 JVM tests passed and Debug APK built. New Android tests cover the matching health policy, bounded counter parsing, and early ICE queuing.
- git diff --check for changed tracked implementation files: passed.

## Verification Limits

- MuMu was not running; adb devices listed no devices and the previously used 192.168.10.33:5555 endpoint timed out. Native Android-to-desktop audio/route tests were not executed.
- The installed Tabbit verification launcher returned exit 69 (routing unavailable). Real browser RTCPeerConnection tests were not executed; the desktop orchestration tests above use media fakes.
- Cross-network, multi-player, long-running calls, NAT/firewall failures, Bluetooth/device unplug/replug, and real voice-changer audio quality still require device testing before a stability release. RTP progress alone cannot prove that hardware is producing audible speech. No TURN service was introduced.
- WebRTC may select candidates on the EasyTier virtual interface; claiming voice never traverses EasyTier is incorrect. This change does not require a new signaling protocol, but depends on the existing authenticated voice-reconnect support and working signaling connectivity. Updating both clients gives the strongest health detection; older peers can only supply whatever RTCP counters their engine exposes.
