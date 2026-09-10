# Release Lobby Validation - 2026-09-08

Scope: reproduce the immediate create/join failure in the actual Windows 3.0.0
release executable, fix confirmed causes, rebuild, and exercise its UI.
This is not a full Android/audio/file-sharing acceptance report.
Log timestamps below are UTC; local timezone is UTC+08:00.

## 1. Passed

- Release startup validation accepts the legitimate Windows verbatim runtime
  path supplied by Tauri, including first launch before runtime extraction.
- Passwordless lobby startup accepts the empty `--network-secret` value.
- Actual release UI automatically created `codex-mumu-20260904` as `DeskTest`:
  log at 15:31:08.970 reports `10.126.126.1`, followed by `Connecting -> InLobby`.
  Windows separately reported this address on `MCTier_Net`.
  This proves local creation, not reachability through the public relay.
- Normal leave after creation at 15:32:23 returned to the home page.
- Failed joins can be retried; a persistent error alert remains visible.
- Controlled local-peer join succeeded at 15:41:52.684. An isolated no-TUN
  reference core connected inbound to the desktop's UDP listener on loopback.
  The desktop acquired `10.126.126.2/24`, entered the real lobby UI, and Windows
  reported the address as Preferred on `MCTier_Net`.
- EasyTier CLI for that join (RPC 37007) reported:

  ```text
  10.126.126.2/24  desktest               Local
  10.126.126.1/24  codex-local-reference  p2p  0.33ms  0.0% loss
  reference peer: rx 1.29 kB, tx 7.09 kB, tunnel udp
  ```

  The reference was not an Android/MCTier participant; the UI player list
  contained only DeskTest. Do not interpret this as a two-client public test.
- Real .NET ClientWebSocket connection to `wss://test.pmhs.top`: State Open.
  Application identity/signature requests also succeeded at 15:41:52-53.
- Normal UI leave at 15:42:51.054: `InLobby -> Idle`; file HTTP server stopped.
- Normal UI close: no MCTier or easytier-core processes remained; the count of
  adapters named `MCTier_Net` was zero. Temporary probe processes were stopped.
- 3 targeted Rust tests and 19 JavaScript tests passed.
- Release EXE build and NSIS packaging succeeded. Source build outputs and
  copies in the release directory have identical SHA256 hashes.

## 2. Confirmed Problems

- Fixed: release helper compared an ordinary install path with a verbatim
  `\\?\` runtime path lexically and rejected a legitimate runtime location.
  Observed error: runtime path outside controlled runtime directory.
- Fixed: helper rejected empty passwords as an invalid command argument.
  Observed error: invalid EasyTier argument content.
- Improved: lobby errors previously disappeared with transient feedback;
  the form now retains the actual error until the next submit.
- Still failing: untouched public-node joins timed out after 60 seconds.
  RPC responded, but only the local node existed, without an IPv4 address.
  Node connector status was Disconnected.
- The bundled EasyTier 2.5.0 CLI `connector ... add` printed `add connector`
  without adding a connector. Its list remained unchanged. Consequently the
  direct-IP diagnostic was performed with a separate real core process instead.

## 3. Environment and Diagnostic Limits

- System DNS returned `198.18.0.45` for `us01.225284.xyz`.
  AliDNS HTTPS resolution returned `38.147.105.185`.
- Real core probes to `udp://38.147.105.185:11010` repeatedly timed out both with
  default device binding and with `--bind-device false`. This does not establish
  whether the cause is the remote node, intermediary network, or local routing.
  Fake-IP alone is therefore not a proven root cause.
- Loopback reference initially returned Windows error 10049 with default device
  binding. `--bind-device false` on the isolated reference fixed that diagnostic.
  The application's persistent configuration was not changed.
- No proxy/security settings were changed. MuMu was not stopped/reset.
- Existing compiler warnings (unused imports/variables) remain.

## 4. Unverified

- Public-node desktop/Android create/join reliability and almost-100% success.
- All broader chat, file, voice, screen-share and Android cleanup acceptance
  checks. Earlier 502/401, AudioManager permission warnings, zero renderer
  frames, file authentication/list synchronization and JUnit class-loading
  reports are NOT cleared by this focused test.
- The claim that the same release-helper regression caused version 2.7.5
  instability. Current reproduction does not establish that historical cause.

## 5. Commands and Evidence

Main log: `C:\Users\pmh13\AppData\Local\MCTier\mctier.log`.
UI evidence: Windows Computer Use screenshots/accessibility results in this
task, including the persistent timeout alert and joined lobby IP 10.126.126.2.

```powershell
cargo test runtime_path_tests --lib --quiet
node --test tests/tauri-command-security.test.mjs tests/trust-boundary.test.mjs tests/lobby-invite.test.mjs
npm run tauri build -- --no-bundle --ci
npm run tauri bundle -- --bundles nsis --ci
Resolve-DnsName us01.225284.xyz -Type A
curl.exe --max-time 15 --noproxy '*' 'https://dns.alidns.com/resolve?name=us01.225284.xyz&type=A'
easytier-cli.exe -p 127.0.0.1:37007 peer
Get-NetIPAddress -InterfaceAlias MCTier_Net -AddressFamily IPv4
Get-CimInstance Win32_Process -Filter "Name='MCTier.exe' OR Name='easytier-core.exe'"
```

The RPC/listener ports were read from the log for each fresh attempt; they
must not be reused as fixed ports for future runs.

Release directory: `E:\GitHubProjects\MCTier-master\MCTier-发布-v3.0.0`.

```text
MCTier.exe
0CCD9A8B05E2468B03BDB7A442164992C104C78E29D6D31DA6C9739DEFE0A932
MCTier_3.0.0_x64-setup.exe
2094984F4E937A9411B29C75F308CF55DC1625AF5773A0813FF41E55B0315E4A
```

## 6. Code Changes

- `src-tauri/src/modules/privileged_helper.rs`: canonicalize existing runtime
  parents before controlled-location comparison; permit an empty secret only
  as the value of `--network-secret`; add three focused regression tests.
  Reparse-point, executable identity and controlled config checks remain.
- `src/components/LobbyForm/LobbyForm.tsx`: persistent submit-error alert.
- Existing unrelated workspace changes were preserved. No commits or resets.
