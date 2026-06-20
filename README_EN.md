<div align="center">

# MCTier

**A universal virtual-LAN networking tool — play, collaborate and access services across different networks.**

English | [简体中文](./README.md)

</div>

---

## What is MCTier

MCTier brings devices on different networks into a single virtual LAN. Built on **EasyTier** (virtual networking) and **WebRTC** (voice / screen sharing), it lets you and your friends bypass network barriers and play LAN games, collaborate or access each other's local services — no public IP required.

It works for **any** game or app that supports LAN multiplayer, not just Minecraft.

## Features

- **Virtual LAN** — P2P virtual network powered by EasyTier; direct connections without a public IP.
- **Cross-platform lobbies** — Desktop (Windows) and Android can join the same lobby; enter by QR code or invite link.
- **Real-time voice** — Low-latency WebRTC voice with hotkey control and per-player volume / mute.
- **P2P chat room** — Text and image messages, @mentions, replies, emoji, all over the virtual network.
- **Folder sharing** — Built-in HTTP file server with batch download and optional "compress before sending".
- **Screen sharing** — Real-time WebRTC screen sharing with optional password protection.
- **Public plaza** — Publish your lobby publicly so others can discover and join it (the host's node is synced to joiners automatically).
- **Room tools** — Shared clipboard, collaborative to-do list, countdown, dice and a shared whiteboard.
- **Lobby isolation** — Lobbies are fully isolated from each other for privacy.
- **Auto-start & auto-lobby** — Optionally launch on boot and auto create/join a lobby.
- **Magic DNS** — Use virtual domain names instead of IP addresses.
- **Self-hosting** — Run your own EasyTier nodes and signaling server.
- **Bilingual UI** — Full Simplified Chinese / English interface that follows your system language on first launch.

## Platforms

- Windows 10 / 11 (desktop, Tauri + React)
- Android (Kotlin + Jetpack Compose)

## Download

Get the latest installers from the [Gitee Releases](https://gitee.com/peng-minghang/mctier/releases) or the [official website](https://mctier.pmhs.top):

- **Windows Installer** (`.exe` / `.msi`) — recommended for everyday use.
- **Windows Portable** (`.7z`) — unzip and run, no installation.
- **Android APK** — install on your phone.

> When MCTier asks for permissions, please allow them — granting them later can be troublesome.

## Quick Start

1. Install MCTier on every device that will play together.
2. On one device, **Create a lobby** (set a name and password). On the others, **Join** with the same name and password, **or** scan the lobby QR code / paste the invite link.
3. Make sure everyone uses the **same server node** (joiners from the public plaza sync the host's node automatically).
4. Start your game's "Open to LAN" / LAN server and connect using the virtual IP shown in MCTier.

## Tech Stack

- **Desktop**: Tauri 2, React, TypeScript, Rust
- **Mobile**: Android native (Kotlin, Jetpack Compose)
- **Networking**: EasyTier (virtual LAN), WebRTC (voice / screen), a custom WebSocket signaling server
- **Signaling server**: Rust (open source, self-hostable)

## Self-hosting the Signaling Server

The signaling server source (with Dockerfile and a deployment guide) is available on the official website. In short:

```bash
unzip MCTier-Signaling-Server.zip
cd MCTier-Signaling-Server
chmod +x deploy.sh
sudo ./deploy.sh
```

Then, in MCTier settings, set the WebRTC signaling server to your own address (e.g. `wss://your-domain:8445`).

## License

This software uses a custom open-source license:

- **No commercial use** — for personal learning and non-commercial use only.
- **Modification allowed** — feel free to modify and extend the project.
- **Attribution required** — derivative projects must credit the original author.
- **Derivatives must stay open source** under the same license.

By using this software you agree to the terms above.

## Author

QingYun Studio _ PengMingHang

- Website: https://mctier.pmhs.top
- GitHub: https://github.com/pmh1314520/MCTier
- Gitee: https://gitee.com/peng-minghang/mctier

---

<div align="center">

Completely free and open source. Enjoy playing with your friends!

</div>
