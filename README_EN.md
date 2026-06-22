<div align="center">
  <img src="public/MCTierIcon.png" alt="MCTier Logo" width="120" height="120">

  # MCTier

  **A universal virtual-LAN networking tool**

  <p>
    <img src="https://img.shields.io/badge/version-2.2.8-blue?style=flat-square" alt="Version">
    <img src="https://img.shields.io/badge/Windows-10%20%2F%2011-2ea44f?style=flat-square" alt="Windows 10/11">
    <img src="https://img.shields.io/badge/Android-supported-3ddc84?style=flat-square" alt="Android">
    <img src="https://img.shields.io/badge/license-Custom-orange?style=flat-square" alt="License">
  </p>


  **Supports Windows 10/11 and Android. Desktop and mobile can join the same lobby to quickly form a cross-network virtual LAN.**

  [Website](../MCTier官网/index.html) · [GitHub](https://github.com/pmh1314520/MCTier) · [Gitee](https://gitee.com/peng-minghang/mctier) · [Quick Start](#quick-start) · [Screenshots](#screenshots) · [Sponsor](#sponsor)

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
- **Connection / network diagnostics**: Aggregate members' direct/relay status, latency and packet loss into a score with tuning tips; network diagnostics can also check the virtual adapter, firewall, UDP ports and security-software blocking, with one-click firewall allow.
- **Self-hosting**: Run your own signaling server to control the connection entry.

### Communication & Collaboration

- **Real-time voice channels**: Voice by channel within a lobby, ideal for collaboration.
- **Voice squads**: Split members into squads so you only hear teammates in your squad — easy grouped voice chat.
- **Built-in voice changer**: Real-time voice changing with presets like loli and uncle voices, making mic chat more fun; preview before applying.
- **Lobby chat room**: Supports text, image and emoji messages.
- **Message danmaku**: Chat messages float across the top of the screen as bullets, so you never miss them while in the background or gaming; adjustable size, speed, opacity, tracks and color (including random rainbow), enabled by default.
- **Folder sharing**: Share folders with lobby members, with download and transfer lists.
- **Screen sharing**: View another member's screen via WebRTC.
- **Remote control**: Remotely view and operate another device in real time via WebRTC, supporting PC↔phone control in both directions; mouse move, left/right click, long-press, drag, wheel, keyboard input, and back/home/recents gestures are all included, with automatic landscape/portrait and best window size based on the remote resolution.
- **Room tools**: Built-in dice roller, countdown timer and a shared multi-user to-do list — great for tabletop games, draws and team task planning; the countdown keeps running even when you switch views or run in the background.

### Lobby Management & Convenience

- **Host management**: Hosts can post a scrolling announcement, set a member cap, kick members, and publish or unpublish to the public plaza.
- **Lobby QR code**: Join by scanning or copy the invite link.
- **Favorites & recents**: Save favorite lobbies for one-click fill, keep a history of recently joined lobbies and players you've played with, and favorite frequent teammates.
- **Global hotkeys**: Customizable hotkeys supporting push-to-talk, one-key mute and more.
- **Mini overlay**: Quickly check member status, control voice and open tools on desktop.
- **In-game HUD overlay**: A pinned click-through overlay shows each teammate's latency, packet loss and who's talking while gaming, with mute, drag, opacity and scale controls.

### Gaming Enhancements

- **Minecraft world auto-discovery**: Scan Minecraft worlds opened by lobby members (MOTD/version/players/latency) and auto-inject them into your local LAN list to join without typing an IP.
- **Game quick connect**: Built-in port presets for common multiplayer games, auto-generating a "virtual IP:port" direct address to copy in one click.
- **Minecraft helper**: Detect the Minecraft install path and version, provide an illustrated LAN multiplayer guide, and automatically disable LAN online-mode verification for mainstream launchers.

### Advanced & More

- **EasyTier advanced network config**: Global and per-lobby advanced options (KCP/QUIC proxy, latency-first, P2P/hole-punching toggles), plus exit-node settings like SOCKS5 and port forwarding.
- **Local statistics**: Purely local stats for play time, join/host counts, active hours and a most-played-with ranking — never uploaded to any server.
- **Onboarding wizard**: On first launch, step through environment checks (permissions, firewall, security software) with one-click fixes.
- **Update detection**: Check for new versions on launch and prompt to update.

## Quick Start

### System Requirements

| Platform | Requirements |
| --- | --- |
| Windows | Windows 10/11 64-bit, 2GB+ RAM recommended |
| Android | Android phone or tablet, Android 8.0+ recommended |
| Network | Able to reach the configured EasyTier node and WebRTC signaling server |

### Download & Install

Download the latest build from [GitHub Releases](https://github.com/pmh1314520/MCTier/releases) or [Gitee Releases](https://gitee.com/peng-minghang/mctier/releases).

- Windows Installer: download `MCTier-安装包-vx.y.z.exe` and double-click to install.
- Windows Portable: download `MCTier-便携版-vx.y.z.exe` and run it directly.
- Android: download `MCTier-Android.apk` and install it on your phone.

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

If you want to host your own MCTier signaling server, download `MCTier信令服务器.zip` from the official website, or check `快速部署信令服务器.md` and `私有化部署README.md` in the repository root.

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

```bash
npm install
npm run tauri dev
npm run tauri build
```

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

This project uses a custom open-source license:

- For personal learning and non-commercial use only.
- Modification is allowed, but the original author's information must be retained.
- Derivative projects must be open-sourced under the same license.

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
  <b>MCTier is completely free and open source. Enjoy!</b>
</div>
