# MCTier Linux 版

MCTier 是虚拟局域网联机工具。Linux 版提供大厅、虚拟组网、聊天和文件共享等功能，可与其他平台的兼容版本联机。本目录包含 Linux 专用构建脚本、启动脚本和打包配置；应用源码位于仓库根目录的 `src/` 和 `src-tauri/`，与 Windows 版共用。

## 系统要求

- 构建脚本面向使用 APT 的 Debian、Ubuntu 及其衍生发行版；其他发行版需要自行安装对应依赖。
- 需要图形桌面环境、WebKitGTK、可用的 TUN 设备以及 polkit 授权组件。
- EasyTier 下载脚本支持的架构以 `scripts/fetch-binaries.sh` 为准，请勿混用不同架构的安装包。
- 语音、屏幕共享和远程控制存在平台限制，详见下文。

## 安装与启动

如项目发布页提供对应架构的 Linux 安装包，优先使用发布包；没有发布包时可从源码构建。

### Debian / Ubuntu 安装包

在下载目录执行，将文件名替换为实际下载的文件名：

```bash
sudo apt install ./MCTier.deb
```

安装后从桌面应用菜单启动 MCTier。

### AppImage

```bash
chmod +x ./MCTier.AppImage
./MCTier.AppImage
```

若提示缺少 FUSE，请安装发行版对应的运行库，或使用 AppImage 的解包方式运行。不要为了绕过权限提示而用 `sudo` 启动整个应用。

## 从源码构建

准备 Git、Node.js（建议 22 LTS）、npm 和 Rust stable。以下命令在含有 `package.json`、`src-tauri/` 和 `MCTier-Linux/` 的仓库根目录执行：

```bash
git clone https://github.com/pmh1314520/MCTier.git
cd MCTier
bash MCTier-Linux/scripts/install-deps.sh
bash MCTier-Linux/scripts/fetch-binaries.sh
bash MCTier-Linux/scripts/build.sh
```

依赖安装脚本需要系统授权，但不会代替你安装 Rust 或 Node.js。二进制获取脚本下载固定版本的 EasyTier 并校验 SHA-256；构建脚本安装前端依赖、运行检查和测试，再生成安装包。

产物位于 `src-tauri/target/release/bundle/`。其他构建选项及启动方式：

```bash
bash MCTier-Linux/scripts/build.sh --bundles deb
bash MCTier-Linux/scripts/build.sh --debug
bash MCTier-Linux/scripts/run-linux.sh
```

## 首次组网与权限

1. 启动 MCTier，创建或加入大厅。
2. EasyTier 缺少创建 TUN 网卡所需的权限时，应用通过 polkit 请求授权。
3. 授权成功后，等待大厅显示虚拟 IP，再使用该 IP 连接游戏。

界面以普通用户身份运行；组网权限通过给 EasyTier 二进制授予 `cap_net_admin` 和 `cap_net_raw` 实现。授权后程序复核能力是否生效。更新二进制后可能需要再次授权；不支持文件能力的文件系统或挂载选项可能导致授权无效。

写入 hosts、修改防火墙可能另行请求授权。被控端输入注入使用 `/dev/uinput`，可用性还取决于系统设备权限与桌面会话配置。

## 功能与限制

| 功能 | 说明 |
| --- | --- |
| 大厅、虚拟组网 | 已有 Linux 适配，需要 TUN 设备和正确授权 |
| 聊天、文件共享 | 使用公共业务协议，实际可用性取决于网络与服务状态 |
| hosts 映射、防火墙、自启动 | 已实现 Linux 分支，需在具体发行版上验证 |
| 语音、屏幕共享、远程控制 | 依赖 WebRTC、媒体后端和系统权限，存在已知限制 |

部分发行版的 WebKitGTK 构建不提供 `RTCPeerConnection`，相应 WebRTC 功能无法使用。即使自行启用 WebRTC，也曾报告过开麦导致 WebKitGTK / GStreamer 卡死的问题，不能保证更换引擎就能解决。普通用户不建议为这些功能直接替换系统 WebKitGTK。

被控端还需要 `/dev/uinput` 可访问；Wayland 与 X11 的权限和行为可能不同。应用能启动或编译通过，不代表上述功能全部经过实机验证。

## 常见问题

- **大厅启动失败**：检查 `/dev/net/tun`、polkit 授权代理、`getcap` / `setcap` 是否可用，以及授权是否成功；同时排除网络和服务不可达的问题。
- **黑屏、透明背景异常或花屏**：尝试软件渲染启动。
- **输入法或密码输入异常**：启动脚本默认清空 `GTK_IM_MODULE`；不需要此处理时可保留原设置。

```bash
MCTIER_SOFTWARE_RENDER=1 bash MCTier-Linux/scripts/run-linux.sh
MCTIER_KEEP_IM_MODULE=1 bash MCTier-Linux/scripts/run-linux.sh
MCTIER_DEBUG=1 bash MCTier-Linux/scripts/run-linux.sh
```

最后一条命令启用调试日志。反馈时请附发行版、CPU 架构、桌面环境、X11 / Wayland 类型、应用版本和脱敏日志，不要公开大厅密码、令牌或个人信息。

## 目录与许可

| 路径 | 用途 |
| --- | --- |
| `scripts/install-deps.sh` | 安装 APT 系统依赖 |
| `scripts/fetch-binaries.sh` | 获取并校验 EasyTier |
| `scripts/build.sh` | 构建、检查与打包 |
| `scripts/run-linux.sh` | 启动及兼容性环境变量 |
| `packaging/` | 桌面菜单和 polkit 配置 |

项目许可和第三方组件说明见仓库根目录的 `LICENSE` 与 `THIRD_PARTY_NOTICES.md`。
