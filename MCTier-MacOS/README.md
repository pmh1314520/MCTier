# MCTier macOS 版

MCTier 是虚拟局域网联机工具。本目录收录 PR #70 的 macOS 适配源码，包含前端、Rust 后端、平台模块和构建脚本，与仓库根目录的 Windows / Linux 源码分开维护。

macOS 适配贡献者：**DNPMBHC**，来源为 [PR #70](https://github.com/pmh1314520/MCTier/pull/70) 和 [原始适配仓库](https://github.com/DNPMBHC/MCTier_macOS)。本目录以提交 `f89f4c86968a45ac7fcf6b51389f444175914b58` 为基础，整理路径并修正提权方式。它不是已经完成签名、公证和所有机型验证的正式安装包。

## 系统与架构

- 支持 Apple Silicon（`aarch64-apple-darwin`）和 Intel（`x86_64-apple-darwin`）的本机架构构建，不会自动生成 Universal 包。
- 配置声明的最低系统版本为 macOS 11.0，不等于每项功能均在该版本上验证。
- 系统音频捕获使用 ScreenCaptureKit，需要 macOS 13 或更高版本；麦克风与屏幕捕获使用独立的原生模块。
- 需要可授权的管理员账户创建虚拟网络，以及互联网连接获取构建依赖。

## 安装与首次使用

如发布页提供与设备架构匹配的 macOS 安装包，可打开 DMG，将 MCTier 拖入“应用程序”后启动；没有安装包时，按下文从源码构建。

1. 创建或加入大厅时，同意系统管理员授权窗口。**每次启动大厅都会请求授权**，无需在 MCTier 的聊天或大厅密码输入框内填写系统密码。
2. 等待显示虚拟 IP 后，再通过该地址连接游戏。
3. 使用语音、屏幕共享或被控端功能时，在“系统设置 → 隐私与安全性”授予相应权限。

只有 EasyTier 组网进程以管理员身份运行，界面与聊天、语音逻辑仍以普通用户身份运行。退出大厅或应用时，监管脚本负责停止 EasyTier。本版本不启用原 PR 的运行期常驻 root 命令 FIFO 通道，也不安装永久特权服务。

未签名或未经 Apple 公证的构建可能被 Gatekeeper 阻止。请仅对确认来源的构建使用系统提供的打开选项，不要关闭系统整体安全保护。

## 从源码构建

### 准备工具链

- Xcode Command Line Tools：运行 `xcode-select --install`。
- Node.js 22 LTS 和 npm。
- Rust stable / rustup，并确认 `cargo`、`rustc` 可用。
- Git、CMake、Protobuf 编译器；使用 Homebrew 时可执行：

```bash
brew install cmake protobuf
```

### 构建 DMG

以下命令从仓库根目录开始：

```bash
git clone https://github.com/pmh1314520/MCTier.git
cd MCTier/MCTier-MacOS
bash ./build-dmg.command
```

脚本安装锁定的 npm 依赖、构建前端、运行回归测试及 Rust 单元测试，再生成 DMG。EasyTier 二进制缺失时，会从固定源码提交构建。日志位于 `build-logs/`，DMG 位于 `src-tauri/target/release/bundle/dmg/`。

调试构建或不打包构建：

```bash
bash scripts/build.sh --debug
bash scripts/build.sh --no-bundle
```

`--ui-only` 仅用于验证界面与应用包，不包含可用的 EasyTier 组网资源，不能作为完整联机版本发布。

### EasyTier 版本

当前脚本固定 EasyTier 2.5.0，源码提交为 `88a45d115670631dfe6a05ba192387d615ddb95b`。脚本检查源码提交、Mach-O 架构及版本输出，并记录 SHA-256，不会将 Linux ELF 二进制冒充 macOS 文件。

```bash
bash scripts/build-easytier.sh
bash scripts/fetch-binaries.sh
```

`fetch-binaries.sh` 的作用是**验证已构建的文件**，不是下载预编译的 macOS 安装包。产物存放在 `src-tauri/resources/binaries/macos/<目标架构>/`。

## 权限与功能限制

| 功能 | 所需权限 / 注意事项 |
| --- | --- |
| 创建 / 加入大厅 | 系统管理员授权，用于创建 utun 虚拟网络接口 |
| 语音 / 麦克风 | 麦克风权限；切换设备后应检查实际输入 |
| 屏幕共享 / 录屏 | 屏幕录制权限；授权后通常需要重启应用 |
| 远程控制被控端 | 辅助功能权限，并需存在有效的本地屏幕捕获会话 |
| 系统音频录制 | macOS 13+；具体行为取决于系统版本和捕获授权 |
| 保存密码 | 登录钥匙串；重新签名的开发包可能再次请求访问 |

目前屏幕捕获不绘制鼠标指针，最小化被共享窗口可能结束捕获。部分 CoreGraphics 捕获接口已被新 SDK 标记为过时，后续系统兼容性需要持续验证。

本次整理在 Windows 环境中进行，不能替代真实 Mac 上的 Rust 编译、DMG 打包、TCC 权限和组网验证。Apple Silicon 与 Intel、不同系统版本都应分别测试后再发布。

## 常见问题

- **缺少 Xcode SDK / 链接失败**：确认 Command Line Tools 已安装。刚更新 Xcode 时，可按系统要求运行 `sudo xcodebuild -license accept`；脚本会尝试回退到可用的 Command Line Tools。
- **创建大厅提示权限不足**：重新发起连接并完成系统管理员授权；不要用 `sudo` 启动整个界面。
- **语音无声 / 共享黑屏**：检查“隐私与安全性”中的权限，退出并重新启动应用。
- **快捷键不生效**：检查系统及其他应用是否占用了相同组合键，按提示修改。
- **构建失败**：检查 `build-logs/` 的日志，并记录系统版本、架构和工具链版本。

提交问题时请提供版本、复现步骤和脱敏日志，不要公开大厅密码、令牌或系统账户密码。

## 目录结构

| 路径 | 用途 |
| --- | --- |
| `src/` | React / TypeScript 界面 |
| `src-tauri/` | Rust 后端、macOS 模块与应用配置 |
| `scripts/` | 构建和资源准备脚本 |
| `shared/`、`public/` | 共享协议、资源及静态文件 |
| `tests/` | 回归测试；跨平台一致性测试读取上一级 Android 源码 |
| `build-dmg.command` | DMG 构建入口 |

构建需保留整个仓库结构；部分测试依赖同级的 `MCTier-Android/`，不要只下载本目录后直接运行完整测试套件。macOS 构建不会生成或覆盖 Android 的预览资源。

## 发布与许可

公开分发前应配置 Apple Developer ID 签名、所需 entitlements 和 Apple 公证，并在实际 Mac 上验证安装、更新、权限与退出清理流程。

本目录保留原项目许可和第三方组件说明。发布时遵守 `LICENSE`、`THIRD_PARTY_NOTICES.md` 及 EasyTier 等第三方组件的许可要求，提供对应源码和必要声明。
