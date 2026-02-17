# MCTier - Minecraft 虚拟局域网联机工具

MCTier 是一款基于 Tauri + React + TypeScript 构建的桌面应用程序，旨在为 Minecraft 玩家提供简单易用的虚拟局域网联机解决方案。

## ⚠️ 重要提示

**本软件需要管理员权限运行！**

MCTier 需要创建虚拟网卡（TUN设备）来实现 Minecraft 局域网联机功能。请右键点击程序图标，选择"以管理员身份运行"。

## 技术栈

- **后端**: Rust + Tauri
- **前端**: React + TypeScript + Vite
- **虚拟网络**: EasyTier
- **语音通信**: WebRTC

## 开发环境要求

- Node.js 18+
- Rust 1.70+
- npm 或 yarn

## 开发指南

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run tauri dev
```

### 构建生产版本

```bash
npm run tauri build
```

## 推荐 IDE 设置

- [VS Code](https://code.visualstudio.com/)
- [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
- [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## 许可证

MIT
