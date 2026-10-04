# MCTier Architecture Guide

This document describes the boundaries that new code should follow. It is
intentionally short and operational: the goal is to make the next change easy
to place, review, and test.

## Repository Layout

| Area | Responsibility | Entry points |
| --- | --- | --- |
| `src/components` | React presentation and user interaction | feature components |
| `src/services` | Browser-side orchestration, signaling, WebRTC, file and media workflows | service classes and coordinators |
| `src/stores` | Durable UI/session state | Zustand stores |
| `src/security` | Input and trust-boundary validation | `trustBoundary.ts` |
| `src-tauri/src/modules` | Rust domain services and platform adapters | domain modules |
| `src-tauri/src/command_registry.rs` | Tauri IPC command registration | `handler()` |
| `src-tauri/src/lib.rs` | Process startup, plugin setup, tray and lifecycle wiring | `run()` |
| `MCTier-Android` | Android UI, signaling client and EasyTier JNI integration | Gradle application |
| `shared` | Assets and small cross-platform build inputs | generated/runtime resources |

## Boundary Rules

1. React components call a service or store; they do not invoke Tauri commands
   directly except through a domain service.
2. A Tauri command validates its input and delegates to a module service. File
   access, process management, and platform APIs stay in Rust modules.
3. `command_registry.rs` is the only place where the application command list
   is maintained. Adding a command means adding it there and adding a focused
   test in its owning module.
4. Cross-domain Rust operations should not hold one service lock while awaiting
   another service. Copy the required value, release the first lock, then
   continue.
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
