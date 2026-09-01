<div align="center">
  <img src="public/MCTierIcon.png" alt="MCTier Logo" width="120" height="120">

  # MCTier

  **A universal virtual-LAN networking tool**

  <p>
    <img src="https://img.shields.io/badge/version-3.0.0-blue?style=flat-square" alt="Version">
    <img src="https://img.shields.io/badge/Windows-10%20%2F%2011-2ea44f?style=flat-square" alt="Windows 10/11">
    <img src="https://img.shields.io/badge/Android-supported-3ddc84?style=flat-square" alt="Android">
    <img src="https://img.shields.io/badge/license-Custom-orange?style=flat-square" alt="License">
  </p>


  **Supports Windows 10/11 and Android. Desktop and mobile can join the same lobby to quickly form a cross-network virtual LAN. Current version: 2.7.5.**

  [GitHub](https://github.com/pmh1314520/MCTier) · [Gitee](https://gitee.com/peng-minghang/mctier) · [Quick Start](#quick-start) · [Screenshots](#screenshots) · [Sponsor](#sponsor)

  English | [简体中文](./README.md)
</div>

---

## Overview

MCTier is built on EasyTier and WebRTC to bring devices on different networks into a single virtual LAN. It is not a Minecraft-only tool, nor limited to gaming; whenever you need cross-network access to LAN services, ad-hoc collaboration, voice chat, folder sharing or screen sharing, you can spin up a lightweight lobby with MCTier.

Typical use cases include:

- LAN game multiplayer, such as Minecraft, Terraria, Don't Starve, and more.
- Cross-network access to local services, such as dev/debug pages, LAN admin panels, or temporary HTTP services.
- Ad-hoc small-team collaboration, such as voice channels, chat rooms, folder sharing and screen sharing.
- Linking phones and PCs, such as scanning a QR code to join a lobby or pasting an invite link.

## Screenshots

Screenshots are grouped by desktop and mobile and laid out compactly to avoid an overwhelming wall of images.

### Windows

<table>
  <tr>
    <td align="center" width="50%">
      <img src="public/软件预览-主界面.png" alt="Windows Home" width="420"><br>
      <b>Home</b>
    </td>
    <td align="center" width="50%">
      <img src="public/软件预览-大厅界面.png" alt="Windows Lobby" width="420"><br>
      <b>Lobby</b>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="public/软件预览-聊天室.png" alt="Windows Chat Room" width="420"><br>
      <b>Chat Room</b>
    </td>
    <td align="center" width="50%">
      <img src="public/软件预览-文件夹共享.png" alt="Windows Folder Sharing" width="420"><br>
      <b>Folder Sharing</b>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="public/软件预览-屏幕共享.png" alt="Windows Screen Sharing" width="420"><br>
      <b>Screen Sharing</b>
    </td>
    <td align="center" width="50%">
      <img src="public/软件预览-设置.png" alt="Windows Settings" width="420"><br>
      <b>Settings</b>
    </td>
  </tr>
</table>

<details>
<summary><b>View more Windows screenshots</b></summary>

<table>
  <tr>
    <td align="center"><img src="public/软件预览-创建大厅.png" alt="Create Lobby" width="320"><br><b>Create Lobby</b></td>
    <td align="center"><img src="public/软件预览-加入大厅.png" alt="Join Lobby" width="320"><br><b>Join Lobby</b></td>
    <td align="center"><img src="public/软件预览-常用大厅信息.png" alt="Favorite Lobbies" width="320"><br><b>Favorite Lobbies</b></td>
  </tr>
  <tr>
    <td align="center" colspan="3"><img src="public/软件预览-大厅动态设置.png" alt="Lobby Settings" width="420"><br><b>Lobby Settings</b></td>
  </tr>
</table>
</details>

### Android

<table>
  <tr>
    <td align="center"><img src="public/手机端-主界面.jpg" alt="Android Home" width="180"><br><b>Home</b></td>
    <td align="center"><img src="public/手机端-大厅界面.jpg" alt="Android Lobby" width="180"><br><b>Lobby</b></td>
    <td align="center"><img src="public/手机端-大厅二维码.jpg" alt="Android Lobby QR Code" width="180"><br><b>Lobby QR Code</b></td>
    <td align="center"><img src="public/手机端-设置.jpg" alt="Android Settings" width="180"><br><b>Settings</b></td>
  </tr>
  <tr>
    <td align="center"><img src="public/手机端-聊天室.jpg" alt="Android Chat Room" width="180"><br><b>Chat Room</b></td>
    <td align="center"><img src="public/手机端-文件夹共享.jpg" alt="Android Folder Sharing" width="180"><br><b>Folder Sharing</b></td>
    <td align="center"><img src="public/手机端-屏幕共享.jpg" alt="Android Screen Sharing" width="180"><br><b>Screen Sharing</b></td>
    <td align="center"><img src="public/手机端-大厅动态设置.jpg" alt="Android Lobby Settings" width="180"><br><b>Lobby Settings</b></td>
  </tr>
</table>

## Core Features

### Networking & Connection

- **Virtual LAN networking**: Build a virtual network on EasyTier without a public IP.
- **Cross-platform lobbies**: Phones and PCs can join the same lobby, with handy QR-code invites.
- **Public lobby plaza**: Hosts can publish a lobby to the plaza, so strangers can find it and join with one click.
- **Custom nodes & virtual domains**: Add your own EasyTier nodes and configure a custom domain for the virtual network.
- **Built-in EasyTier nodes**: The default is the Haibo US node, `udp://us01.225284.xyz:11010`; Haibo Mainland China and Weiai Xiamen nodes are also available, and the last selection is remembered.
- **Node settings in invites**: QR codes, invite links, recent lobbies and favorite lobbies carry and restore the matching EasyTier node and signaling-server settings, preventing cross-node join failures.
- **Self-healing connections**: Both desktop and Android support signaling reconnects, secondary member-state confirmation and automatic voice-connection recovery to tolerate short network interruptions.
- **Connection / network diagnostics**: Aggregate members' direct/relay status, latency and packet loss into a score with tuning tips; network diagnostics can also check the virtual adapter, firewall, UDP ports and security-software blocking, with one-click firewall allow.
- **Community node submissions**: Submit your own EasyTier node to the public list for others to use, and browse submissions under "Settings → Community Nodes" sorted by online status and latency, saving any of them as a custom node in one click. The server probes reachability before accepting a submission, and nodes that stay unreachable for more than a day are removed automatically. This works outside a lobby too.
- **Self-hosting**: Run your own signaling server to control the connection entry.

### Communication & Collaboration

- **Real-time voice channels**: Voice by channel within a lobby, ideal for collaboration. Desktop voice is **fully unprocessed**: no noise suppression, echo cancellation or automatic gain control sits in the path, so the preview matches exactly what other members hear.
- **Voice squads**: Split members into squads so you only hear teammates in your squad — easy grouped voice chat.
- **Built-in voice changer**: Real-time voice changing with presets like loli and uncle voices, making mic chat more fun; preview before applying.
- **Lobby chat room**: Supports text, image and emoji messages.
- **Message danmaku**: Chat messages float across the top of the screen as bullets, so you never miss them while in the background or gaming; adjustable size, speed, opacity, tracks and color (including random rainbow), enabled by default.
- **Folder sharing**: Share folders with lobby members, with download and transfer lists, and a **customizable download directory** (pick a folder in desktop settings; Android grants a directory through the system file picker).
- **Personal avatars**: Both platforms can set a personal avatar, shown in the player list and chat room, and in the desktop mini overlay as well.
- **Screen sharing**: View another member's screen via WebRTC.
- **Remote control**: Remotely view and operate another device in real time via WebRTC, supporting PC↔phone control in both directions; mouse move, left/right click, long-press, drag, wheel, keyboard input, and back/home/recents gestures are all included, with automatic landscape/portrait and best window size based on the remote resolution.
- **Room tools**: Built-in dice roller, countdown timer and a shared multi-user to-do list — great for tabletop games, draws and team task planning; the countdown keeps running even when you switch views or run in the background.

### Lobby Management & Convenience

- **Host management**: Hosts can post a scrolling announcement, set a member cap, kick members, and publish or unpublish to the public plaza.
- **Lobby QR code**: Join by scanning or copy the invite link.
- **Favorites & recents**: Save favorite lobbies for one-click fill, keep a history of recently joined lobbies and players you've played with, and favorite frequent teammates.
- **Global hotkeys**: Customizable hotkeys supporting push-to-talk, one-key mute and more.
- **Mini overlay**: Quickly check member status, control voice and open tools on desktop.
- **System tray**: Hide the desktop app to the system tray with a hotkey or window button, customize the restore hotkey, and receive a Windows background-running notification.
- **Application logs**: Desktop and Android settings provide log viewing or export entry points for diagnosing connection, voice and UI issues.
- **In-game HUD overlay**: A pinned click-through overlay shows each teammate's latency, packet loss and who's talking while gaming, with mute, drag, opacity and scale controls.

### Gaming Enhancements

- **Minecraft world auto-discovery**: Scan Minecraft worlds opened by lobby members (MOTD/version/players/latency) and auto-inject them into your local LAN list to join without typing an IP.
- **Game quick connect**: Built-in port presets for common multiplayer games, auto-generating a "virtual IP:port" direct address to copy in one click.

### Advanced & More

- **EasyTier advanced network config**: Global and per-lobby advanced options (KCP/QUIC proxy, latency-first, P2P/hole-punching toggles), plus exit-node settings like SOCKS5 and port forwarding.
- **Physical-device binding**: EasyTier advanced settings can bind a selected physical network device and pass the correct binding argument when starting the network.
- **Local statistics**: Purely local stats for play time, join/host counts, active hours and a most-played-with ranking — never uploaded to any server.
- **Onboarding wizard**: On first launch, step through environment checks (permissions, firewall, security software) with one-click fixes.
- **Update detection**: Check for new versions on launch and prompt to update.

## Quick Start

### System Requirements

| Platform | Requirements |
| --- | --- |
| Windows | Windows 10/11 64-bit, 2GB+ RAM recommended |
| Linux | Debian-family distributions (Debian / Ubuntu / Deepin / UOS / Mint), x86_64 |
| Android | Android phone or tablet, Android 8.0+ recommended |
| Network | Able to reach the configured EasyTier node and WebRTC signaling server |

### Download & Install

Download the latest build from [GitHub Releases](https://github.com/pmh1314520/MCTier/releases) or [Gitee Releases](https://gitee.com/peng-minghang/mctier/releases).

- Windows Installer: download `MCTier_x.y.z_x64-setup.exe` and double-click to install.
- Windows Portable: download `MCTier.exe` and run it directly.
- Android: download `MCTier-Android.apk` and install it on your phone.
- Linux (Debian family): see [MCTier-Linux/README.md](MCTier-Linux/README.md) for build and packaging steps. The app itself runs as a normal user and only needs `cap_net_admin` granted once to `easytier-core`; voice, screen sharing and remote control are not yet usable on stock Debian — see the per-feature status matrix in that directory.

### Create or Join a Lobby

1. The host opens MCTier and chooses "Create Lobby".
2. Enter a lobby name, password and display name.
3. After creating, send the lobby QR code or invite link to other members.
4. Other members enter the lobby info or scan the QR code to join.
5. Once virtual IPs are assigned, you can access LAN services exposed by devices in the same lobby.

## Example: Minecraft Multiplayer

MCTier is a universal networking tool; Minecraft is just one typical use case.

After entering a singleplayer world, the host presses `Esc` and clicks "Open to LAN", then notes the port. Others choose "Direct Connect" and enter the host's virtual IP and port, for example:

```text
10.126.126.1:25565
```

If virtual domains are enabled, you can also connect with an address like `membername.mct.net:25565`.

## Self-hosting Quick Flow

If you want to host your own MCTier signaling server, download `MCTier信令服务器.zip` and the deployment documentation from the official MCTier website. This source repository contains the desktop and Android client source code, not the website or signaling-server deployment package.

> Self-hosting the signaling server needs a host with a public IP. If you do not have one yet, take a look at our sponsor:
>
> <a href="https://langlangy.cn/?imctier" target="_blank" rel="noopener">
>   <picture>
>     <source media="(prefers-color-scheme: dark)" srcset="public/langlangyun-logo-white.png">
>     <source media="(prefers-color-scheme: light)" srcset="public/langlangyun-logo-black.png">
>     <img src="public/langlangyun-logo-black.png" alt="Langlangyun" height="34">
>   </picture>
> </a>
>
> **[Langlangyun BGP servers — lower latency and faster game networking](https://langlangy.cn/?imctier)**

Basic flow:

1. Prepare a Linux server or a host on your LAN.
2. Install Docker and Docker Compose.
3. Upload and unzip `MCTier信令服务器.zip`.
4. Enter the unzipped directory and grant the deploy script execute permission.
5. Run the deploy script and fill in your domain or IP as prompted.
6. Set your private signaling address in the MCTier client settings.

Common commands:

```bash
unzip MCTier信令服务器.zip
cd MCTier信令服务器
chmod +x deploy.sh
sudo ./deploy.sh
docker compose -f docker-compose-http.yml ps
docker compose -f docker-compose-http.yml logs -f
```

## Development & Build

### Step 1: Prepare third-party binaries (required after the first clone)

`src-tauri/src/modules/resource_manager.rs` embeds 4 third-party binaries at compile time via `include_bytes!`. They are large and subject to their own licenses, so they are not tracked in this repository. After cloning you must prepare them, otherwise `cargo build` fails because the files are missing.

```powershell
# 1) Download the freely redistributable driver files (wintun.dll / WinDivert64.sys)
.\scripts\fetch-binaries.ps1

# 2) Rebuild easytier-core.exe / easytier-cli.exe without the Npcap dependency
.\scripts\build-easytier-npcap-free.ps1
```

The first script downloads `easytier-windows-x86_64-v2.5.0.zip` from the official EasyTier release, verifies the SHA-256 of every file (aborting on any mismatch), then places them into `src-tauri/resources/binaries/`. Files that already exist and pass verification are skipped; pass `-Force` to re-fetch.

The second script exists for a specific reason: the official `easytier-core.exe` build **statically imports** Npcap's `packet.dll`, and Npcap is not open source software — it may not be redistributed with other software without written permission from the Nmap Project. This script clones EasyTier v2.5.0 (the same commit, so no version bump), applies [patches/pnet_datalink-0.35.0-no-npcap.patch](patches/pnet_datalink-0.35.0-no-npcap.patch) to drop that import, and then parses the resulting PE import table as a hard gate. It requires `cargo` (MSVC toolchain), `protoc` and `libclang`. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) section 8.

### Step 2: Build
```bash
npm install
npm run tauri dev
# Build the Windows NSIS installer (recommended with the pinned Node runtime)
npm run tauri build -- --bundles nsis --ci
```

Desktop release builds generate the NSIS installer only. This avoids processing the offline WebView2 installer twice when MSI is also enabled. The repository's one-click version update tool prepares the pinned Node runtime and uses the same NSIS arguments.

The Android source code is located at:

```text
MCTier-Android/
```

Debug or package Android:

```bash
cd MCTier-Android
gradlew.bat assembleDebug
```

## Sponsor

MCTier will keep improving the desktop and mobile experience. If it helped you with networking, multiplayer or collaboration, your sponsorship is welcome. Every contribution goes toward improving connection stability, the cross-platform experience and future features.

<div align="center">
  <table>
    <tr>
      <td align="center" width="50%">
        <img src="public/zfb.jpg" alt="Alipay QR Code" width="240"><br>
        <b>Sponsor via Alipay</b>
      </td>
      <td align="center" width="50%">
        <img src="public/wx.png" alt="WeChat QR Code" width="240"><br>
        <b>Sponsor via WeChat</b>
      </td>
    </tr>
  </table>
</div>

## License

MCTier's **own code** uses a custom **source-available, non-commercial** license (see [LICENSE](LICENSE)):

- For personal learning and non-commercial use only.
- Modification is allowed, but the original author's information must be retained.
- Derivative projects must publish their source code under the same license.

> Wording note: because this license prohibits commercial use, it does **not** meet the
> OSI definition of an "open source license". This project therefore describes its own
> code as "source-available / non-commercial" rather than "open source". The source code
> remains fully public. Most third-party components bundled with the project are covered
> by genuine open source licenses, and their rights are not restricted by this license
> (see below).

### Third-Party Components and License Boundary

**The restrictions above apply only to MCTier's own code, not to the EasyTier components
bundled with this project.**

This software uses [EasyTier](https://github.com/EasyTier/EasyTier) for virtual networking.
EasyTier, and any modifications MCTier makes to it, remain licensed under **LGPL-3.0**:

```
This software uses the EasyTier project.
EasyTier Copyright (c) EasyTier contributors.
EasyTier is licensed under the GNU Lesser General Public License version 3.0 (LGPL-3.0).
Source: https://github.com/EasyTier/EasyTier
```

- "No commercial use" **does not apply** to the EasyTier LGPL-3.0 portions;
- "Derivatives must be open source under the same license" **does not apply** to the
  EasyTier LGPL-3.0 portions;
- MCTier's custom license shall not be construed to limit any right granted by LGPL-3.0.

| Component | Platform | Version | Commit | License | Modified |
| --- | --- | --- | --- | --- | --- |
| EasyTier | Windows (separate process) | v2.5.0 | `88a45d11...` | LGPL-3.0 | No |
| EasyTier | Android (`.so` shared libs) | based on v2.6.0 | `79b562cd...` | LGPL-3.0 | Yes (see patch) |

Related files:

- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) — versions, commits, modification status, how to obtain source, binary SHA-256
- [LICENSE-LGPL-3.0.txt](LICENSE-LGPL-3.0.txt) — full LGPL-3.0 text
- [LICENSE-GPL-3.0.txt](LICENSE-GPL-3.0.txt) — full GPL-3.0 text (incorporated by reference into LGPL-3.0)
- [patches/easytier-2.6.0-mctier-android.patch](patches/easytier-2.6.0-mctier-android.patch) — EasyTier modifications for Android
- [patches/pnet_datalink-0.35.0-no-npcap.patch](patches/pnet_datalink-0.35.0-no-npcap.patch) — removes the static Npcap `Packet.dll` link dependency on Windows
- [docs/android/rebuild-with-modified-easytier.md](docs/android/rebuild-with-modified-easytier.md) — rebuild the Android app with your own modified EasyTier
- [licenses/](licenses/) — full third-party license texts (LGPL-3.0, GPL-3.0, GPL-2.0, Apache-2.0, MIT, BSD-3-Clause, Wintun)

`THIRD_PARTY_NOTICES.md` covers versions, SHA-256 hashes, licenses and modification status
for EasyTier, Wintun, WinDivert, LocalVQE / GGML / model weights, WebRTC
and the application-level dependencies. Section 8 documents the cause and removal of the
Npcap `packet.dll` dependency — this project no longer ships any Npcap file.

### Trademarks and Non-Affiliation

This project is not an official Minecraft product. It is not approved by or associated with
Mojang Studios or Microsoft. Minecraft is a trademark of Mojang Synergies AB.

Neither WireGuard LLC, the WireGuard project, nor the Wintun project endorses this project.

## Default Services and Metadata Disclosure

MCTier transmits communication content (chat, voice, files, screen, remote control) peer-to-peer directly between members' devices. However, **establishing connections** and **version checking** require the following default services. If you keep the default configuration, those servers observe the corresponding connection metadata:

| Default service | Address | Metadata visible to the server | Purpose |
|---|---|---|---|
| Signaling server | `wss://test.pmhs.top` | Public IP, connection time, lobby name and password hash used for matching, player name, virtual IP/domain, member count, client version | Exchange WebRTC signaling, discover members of the same lobby |
| EasyTier public node | `udp://us01.225284.xyz:11010` | Public IP, connection time, EasyTier network identifier | P2P hole punching and relaying when required |
| Version check | `https://gitee.com/api/v5/repos/peng-minghang/mctier/tags` | Public IP, request time (recorded by Gitee) | Retrieve the latest version number |

Notes:

- **Metadata is not content.** The signaling server and EasyTier nodes do not decrypt or store your chat, voice or file content.
- **Retention and deletion**: the official signaling server keeps lobby and member mappings in memory only for the duration of a session and releases them when the session ends; it does not build long-term user profiles. To request deletion of related records, contact us via an issue or the website.
- **Version checking** is served by Gitee, whose logging follows Gitee's own privacy policy.
- **You can avoid the official services entirely**: configure your own signaling server and EasyTier node under Settings → Advanced (see "Self-hosting Quick Flow"); no data then passes through official services. Version checking can be disabled in settings.
- The feature bullet "never uploaded to any server" refers **only to the local statistics feature itself** (play time, join/host counts and similar are computed purely locally and never leave your device). It does not imply that other features avoid the default services above.
## Disclaimer

- MCTier is a **neutral virtual-LAN networking and collaboration tool**, intended only for lawful personal use in compliance with the laws of your jurisdiction (e.g., LAN gaming, collaboration, accessing your own or authorized services).
- Communication content (chat, voice, files, screen, remote control, etc.) is transmitted **peer-to-peer directly** between members' devices; the developer does not participate in, control, or audit any user content or specific conduct.
- **Users are solely responsible for all their use and transmitted content.** Using the project for any unlawful activity is strictly prohibited, including but not limited to: unlicensed commercial/cross-border networking, spreading illegal or infringing content, unauthorized control or monitoring of others' devices, or using voice/voice-changer for fraud or impersonation.
- Sensitive features such as remote control, screen sharing and the voice changer require the user's **explicit in-app agreement to the corresponding notices and terms** before use, with risk and prohibition disclosures provided.
- The software is provided "as is" without any warranty; to the maximum extent permitted by law, the developer is not liable for any direct or indirect loss arising from its use.
- If you do not agree with any of the above, do not download, install or use the project. See the in-app User Agreement, Privacy Policy and Disclaimer for details.

## Author

QingYun Studio_PengMingHang

- GitHub: <https://github.com/pmh1314520/MCTier>
- Gitee: <https://gitee.com/peng-minghang/mctier>

---

<div align="center">
  <b>MCTier is completely free for personal, non-commercial use, and its source code is fully public. Enjoy!</b>
</div>
