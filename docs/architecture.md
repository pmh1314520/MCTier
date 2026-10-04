# MCTier Architecture Guide

This document describes the boundaries that new code should follow. It is
intentionally short and operational: the goal is to make the next change easy
to place, review, and test.

## Repository Layout

| Area                                | Responsibility                                                          | Entry points                     |
| ----------------------------------- | ----------------------------------------------------------------------- | -------------------------------- |
| `src/components`                    | React presentation and user interaction                                 | feature components               |
| `src/services`                      | Browser-side orchestration, signaling, WebRTC, file and media workflows | service classes and coordinators |
| `src/stores`                        | Durable UI/session state                                                | Zustand stores                   |
| `src/security`                      | Input and trust-boundary validation                                     | `trustBoundary.ts`               |
| `src-tauri/src/modules`             | Rust domain services and platform adapters                              | domain modules                   |
| `src-tauri/src/modules/tauri_commands/shared.rs` | IPC state and short-lived service handle access              | `AppState`                       |
| `src-tauri/src/modules/logs.rs`     | Bounded, UI-independent log reading                                     | `read_recent_log()`              |
| `src-tauri/src/command_registry.rs` | Tauri IPC command registration                                          | `handler()`                      |
| `src-tauri/src/lib.rs`              | Process startup, plugin setup, tray and lifecycle wiring                | `run()`                          |
| `MCTier-Android`                    | Android UI, signaling client and EasyTier JNI integration               | Gradle application               |
| `shared`                            | Assets and small cross-platform build inputs                            | generated/runtime resources      |
| `shared/signaling-protocol.json`    | WebSocket message inventory and client protocol version                 | frontend JSON import             |

## Migration Status

The command registry now resolves commands through explicit module paths. Its
handler uses `tauri::Wry`, matching the existing command arguments, rather than
claiming support for arbitrary runtimes.

Logging is the first command domain migrated internally to `AppResult<T>`.
The IPC boundary still returns `Result<T, String>` and strips error category
prefixes to preserve existing frontend behavior. Log content is read on a
blocking worker by seeking to the tail and reading at most 512 KiB, rather than
loading the whole file.

The signaling inventory lists WebSocket messages, including legacy registration
that the server rejects. It is not a payload schema or a replacement for
validation and authorization. The frontend reads its version directly; tests
guard the Rust and Android signing constants against version drift. Other
platform types and validation logic are not yet generated from this file.

In the separate signaling server repository, `config.rs` owns process
configuration and limits, `transport.rs` owns bounded delivery and session
metadata, `registration.rs` owns signed admission and ordered membership events,
and `moderation.rs` owns authorized host actions. `connection.rs` retains
connection lifecycle, authentication, cleanup, and dispatch of remaining
message domains.
The repositories remain independently buildable and releasable.

Ordinary configuration, file-share, P2P signaling, voice heartbeat, and player
domain commands now clone a service handle through `AppState`, then release the
core lock before taking the service lock. The outer `AppCore` mutex remains a
lifecycle gate for entry and cleanup, not a replacement for service locks.

Remaining work includes auditing other cross-service operations, migrating
additional command domains, splitting the remaining signaling dispatch, and
introducing payload-schema generation with cross-platform fixtures. UI feature
directory migration is also still pending.

## Concurrency And Tests

- Use `AppState` service accessors for ordinary commands. Do not hold
  `state.core` while waiting for a service mutex or performing service I/O.
- Keep the explicit core guard around create/join state checks and transitions,
  exit, and forced network-stop plus lobby cleanup. Removing it can let an old
  cleanup operation erase a newly created lobby.
- Lobby transitions acquire **lobby before network**. Shutdown uses the same
  order through `leave_lobby_for_shutdown()`; no path may acquire those two
  services in the reverse order.
- Read/modify/write must remain in one service guard. This includes microphone
  toggles, hosts-manager creation/publication, and file-server stop/restart.
  Shortening the core guard does not justify shortening these service guards.
- AppCore concurrency tests use an isolated configuration fixture. They queue
  lock waiters deterministically and verify the production shutdown helper,
  microphone toggle, and service accessor without stopping external processes.
- The full `test_app_core_shutdown` remains an ignored integration test: it
  modifies system hosts/config and can stop a real EasyTier process. Run it only
  on an isolated integration host with verified native resources, never on a
  developer's active game session or with compile-only placeholders.

## Boundary Rules

1. React components call a service or store; they do not invoke Tauri commands
   directly except through a domain service.
2. A Tauri command validates its input and delegates to a module service. File
   access, process management, and platform APIs stay in Rust modules.
3. `command_registry.rs` is the only place where the application command list
   is maintained. Adding a command means adding it there and adding a focused
   test in its owning module.
4. Prefer copying values and releasing a service lock before awaiting another
   service. For atomic lobby lifecycle operations that must hold both services,
   acquire lobby before network and preserve the lifecycle gate.
5. Signaling messages are protocol data, not ad-hoc UI state. Changes require
   updating the desktop client, Android client, signaling server, and a
   compatibility test or fixture.
6. Errors crossing the IPC boundary should use stable machine-readable codes.
   `AppError` now provides a structured payload while legacy string-returning
   commands remain compatible during migration.

## Change Checklist

- Identify the owning domain before adding a file.
- Keep platform-specific code behind the existing platform module.
- Add or update a focused test for validation, security, or protocol changes.
- Run the narrowest relevant checks first, then the repository quality checks:
  `npm run lint`, `npm run build`, `npm test`, and `cargo fmt --check`.
- If a full desktop build needs generated native resources, run the documented
  resource preparation step before `cargo check` or `cargo build`.
- Compile-only placeholder resources are never release artifacts. Do not run
  EasyTier integration tests or package an application with these placeholders.
