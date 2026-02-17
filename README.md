<div align="center">

<img src="public/MCTierIcon.png" alt="MCTier Logo" width="150" height="150">

# **MCTier**

### Minecraft 虚拟局域网联机工具

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-blue?style=flat-square" alt="Version">
  <img src="https://img.shields.io/badge/platform-Windows-lightgrey?style=flat-square" alt="Platform">
  <img src="https://img.shields.io/badge/license-Custom-orange?style=flat-square" alt="License">
</p>

<p align="center">
  <a href="https://github.com/pmh1314520/MCTier">GitHub</a> •
  <a href="https://gitee.com/peng-minghang/mctier">Gitee</a> •
  <a href="#-功能特性">功能特性</a> •
  <a href="#-快速开始">快速开始</a> •
  <a href="#-使用说明">使用说明</a>
</p>

---

### 让跨网络联机变得简单

MCTier 是一款专为 Minecraft 玩家打造的虚拟局域网联机工具，让您可以轻松与好友跨越网络限制，享受联机游戏的乐趣。

**🎮 不仅仅是 Minecraft** - 适用于任何支持局域网联机的游戏

**🌐 局域网互访** - 同一大厅内的玩家可以互相访问本地开放的网站和服务

</div>

---

## ✨ 功能特性

### 核心功能

- **🌐 虚拟局域网** - 基于 EasyTier P2P 技术，实现跨网络的直连通信
- **🎙️ 实时语音** - 内置 WebRTC 语音通话，低延迟、高质量
- **⚡ 快捷键控制** - 全局快捷键控制麦克风（默认 Ctrl+M）
- **🎯 迷你悬浮窗** - 游戏时不遮挡视野，随时查看玩家状态
- **🔒 大厅隔离** - 每个大厅独立隔离，保护隐私安全
- **🛠️ 自动配置** - 无需手动设置，自动完成网络配置

### 技术亮点

| 技术栈 | 说明 |
|--------|------|
| **Tauri 2.0** | 现代化桌面应用框架，轻量高效 |
| **React 19** | 最新的 React 版本，流畅的用户体验 |
| **EasyTier** | P2P 虚拟网络技术，实现跨网络直连 |
| **WebRTC** | 实时语音通信技术，低延迟高质量 |
| **Rust** | 高性能后端，安全可靠 |

---

## 🚀 快速开始

### ⚠️ 重要提示

**MCTier 必须以管理员权限运行！**

软件需要创建虚拟网卡（TUN 设备）来实现虚拟局域网功能。

**推荐设置方法：**

1. 右键点击 `mctier.exe`
2. 选择 **属性** → **兼容性**
3. 勾选 **以管理员身份运行此程序**
4. 点击 **应用** → **确定**

设置完成后，以后双击即可自动以管理员身份运行。

### 系统要求

- **操作系统**: Windows 10/11 (64位)
- **内存**: 至少 2GB RAM
- **磁盘空间**: 至少 100MB
- **网络**: 稳定的互联网连接

### 下载安装（务必以管理员身份运行！）

前往 [GitHub Releases](https://github.com/pmh1314520/MCTier/releases) 或 [Gitee Releases](https://gitee.com/peng-minghang/mctier/releases) 下载最新版本。

**安装程序版本**（推荐）
- 下载 `MCTier-Setup.exe`
- 双击运行安装程序
- 按照向导完成安装

**免安装版本**

- 下载 `MCTier-Portable.zip`
- 解压到任意目录
- 双击 `mctier.exe` 启动

---

## 📖 使用说明

### 创建大厅（开房的玩家）

1. 启动 MCTier，点击 **创建大厅**
2. 输入自定义大厅名称
3. 设置自定义大厅密码
4. 随便起个玩家名称
5. 点击 **创建** 按钮
6. 等待虚拟网络初始化完成
7. 将大厅的名称和密码分享给你的朋友

### 加入大厅（入房的玩家）

1. 启动 MCTier，点击 **加入大厅**
2. 输入你朋友发给你的大厅名称和密码
3. 随便起个玩家名称
4. 点击 **加入** 按钮
5. 等待连接到虚拟网络

### 开始游戏（开房的玩家一般都需要安装 mcwifipnp 模组以关闭正版验证！）

成功加入大厅后，你会获得一个虚拟 IP 地址（如 `10.126.126.2`）

**在 Minecraft 中：**

1. 房主打开单人世界，按 ESC 键
2. 点击 **对局域网开放**，记住端口号（如 25565）
3. 其他玩家在多人游戏中点击 **直接连接**
4. 输入房主的虚拟 IP 和端口（如 `10.126.126.1:25565`）
5. 点击加入服务器

**房主的虚拟 IP 通常是 `10.126.126.1`**

### 语音通话

- **开启/关闭麦克风**: 点击麦克风图标或按快捷键（默认 Ctrl+M）
- **静音玩家**: 点击玩家列表中的扬声器图标
- **全局静音**: 点击全局静音按钮

### 迷你窗口

进入大厅后，软件会自动切换到迷你悬浮窗模式：
- 可以拖动窗口到任意位置
- 点击展开/收起按钮控制窗口大小
- 游戏时不会遮挡视野

---

## 🛠️ 开发指南

### 环境要求

- **Node.js**: 18.0+
- **Rust**: 1.70+
- **npm**: 9.0+

### 安装依赖

```bash
# 克隆仓库
git clone https://github.com/pmh1314520/MCTier.git
cd MCTier/mctier

# 安装依赖
npm install
```

### 开发模式

```bash
npm run tauri dev
```

### 构建项目

```bash
npm run tauri build
```

构建完成后，文件位于 `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/`

### 项目结构

```
mctier/
├── src/                          # 前端源代码
│   ├── components/              # React 组件
│   │   ├── MainWindow/         # 主窗口
│   │   ├── MiniWindow/         # 迷你窗口
│   │   ├── LobbyForm/          # 大厅表单
│   │   ├── PlayerList/         # 玩家列表
│   │   ├── VoiceControls/      # 语音控制
│   │   ├── NetworkDiagnostic/  # 网络诊断
│   │   ├── MinecraftHelper/    # Minecraft 助手
│   │   └── AboutWindow/        # 关于窗口
│   ├── services/                # 服务层
│   │   ├── webrtc/             # WebRTC 客户端
│   │   └── hotkey/             # 快捷键管理
│   ├── stores/                  # 状态管理
│   └── types/                   # TypeScript 类型
├── src-tauri/                   # Tauri 后端
│   └── src/
│       └── modules/            # 功能模块
│           ├── easytier.rs     # EasyTier 集成
│           ├── minecraft_agent.rs  # Minecraft 助手
│           └── tauri_commands.rs   # Tauri 命令
└── public/                      # 静态资源
```

---

## ❓ 常见问题

### 软件无法启动？

- 确保以管理员权限运行
- 检查是否安装了 WebView2 运行时
- 查看日志文件：`%APPDATA%/mctier/logs/`

### 无法创建虚拟网卡？

- 确认以管理员权限运行
- 检查防火墙设置
- 检查是否有其他虚拟网卡软件冲突

### 无法连接到大厅？

- 检查网络连接是否正常
- 确认大厅 ID 和密码正确
- 使用网络诊断工具检查连接状态

### 语音通话没有声音？

- 检查麦克风权限设置
- 确认麦克风设备正常工作
- 检查是否被静音

### Minecraft 无法检测到局域网世界？

- 确认虚拟网络已成功连接
- 检查虚拟 IP 地址是否正确分配
- 尝试手动输入虚拟 IP 地址加入游戏

---

## 📜 开源协议

本软件采用自定义开源协议：

- 🚫 **禁止商业用途** - 仅供个人学习和非商业使用
- ✅ **允许二次开发** - 欢迎基于本项目进行修改和扩展
- 📝 **必须标明原作者** - 二次开发项目需注明原作者信息
- 🔓 **二次开发必须开源** - 衍生项目必须以相同协议开源

使用本软件即表示您同意遵守以上协议条款。

---

## 👨‍💻 关于作者

**青云制作_彭明航**

这是我开源的第三款软件项目，希望能为 Minecraft 社区带来便利！

- **GitHub**: [https://github.com/pmh1314520/MCTier](https://github.com/pmh1314520/MCTier)
- **Gitee**: [https://gitee.com/peng-minghang/mctier](https://gitee.com/peng-minghang/mctier)

---

## 🙏 致谢

感谢以下开源项目：

- [Tauri](https://tauri.app/) - 跨平台桌面应用框架
- [EasyTier](https://github.com/EasyTier/EasyTier) - 虚拟网络解决方案
- [React](https://react.dev/) - 用户界面库
- [Ant Design](https://ant.design/) - UI 组件库
- [Framer Motion](https://www.framer.com/motion/) - 动画库

---

<div align="center">

## 💖 赞助支持

如果这个软件对您有帮助，欢迎请开发者喝杯咖啡 ☕

您的支持是我持续开发的动力！

<table>
  <tr>
    <td align="center">
      <img src="public/zfb.jpg" alt="支付宝收款码" width="200"><br>
      <b>支付宝</b>
    </td>
    <td align="center">
      <img src="public/wx.png" alt="微信收款码" width="200"><br>
      <b>微信</b>
    </td>
  </tr>
</table>

**感谢每一位支持者！** 🙏

---

### ⭐ 如果这个项目对你有帮助，请给我一个 Star！⭐

**祝各位玩家游玩愉快，享受与好友联机的快乐时光！** 🎮✨

---

Made with ❤️ by 青云制作_彭明航

Copyright © 2026 青云制作_彭明航. All rights reserved.

**✨ 本软件完全免费开源 ✨**

</div>
