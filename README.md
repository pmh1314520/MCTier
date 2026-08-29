<div align="center">
  <img src="public/MCTierIcon.png" alt="MCTier Logo" width="120" height="120">

  # MCTier

  **虚拟局域网通用组网工具**

  <p>
    <img src="https://img.shields.io/badge/version-2.8.0-blue?style=flat-square" alt="Version">
    <img src="https://img.shields.io/badge/Windows-10%20%2F%2011-2ea44f?style=flat-square" alt="Windows 10/11">
    <img src="https://img.shields.io/badge/Android-supported-3ddc84?style=flat-square" alt="Android">
    <img src="https://img.shields.io/badge/license-Custom-orange?style=flat-square" alt="License">
  </p>

  **支持 Windows 10/11 与 Android。电脑端和手机端可加入同一个大厅，快速组成跨网络虚拟局域网。当前版本：2.7.5。**

  [GitHub](https://github.com/pmh1314520/MCTier) · [Gitee](https://gitee.com/peng-minghang/mctier) · [快速开始](#快速开始) · [运行预览](#运行预览) · [赞助支持](#赞助支持)

  [English](./README_EN.md) | 简体中文
</div>

---

## 项目简介

MCTier 基于 EasyTier 与 WebRTC，用来把不同网络环境下的设备组到同一个虚拟局域网中。它不是 Minecraft 专属工具，也不只服务游戏场景；只要你需要跨网络访问局域网服务、临时协作、语音沟通、文件夹共享或屏幕共享，都可以用 MCTier 搭一个轻量大厅。

典型用途包括：

- 局域网游戏联机，例如 Minecraft、泰拉瑞亚、饥荒等。
- 跨网络访问本地服务，例如开发调试页面、局域网后台、临时 HTTP 服务。
- 小团队临时协作，例如语音频道、聊天室、文件夹共享、屏幕共享。
- 手机与电脑互联，例如手机扫码加入大厅、复制邀请链接加入组网。

## 运行预览

预览图按桌面端与手机端分组，尽量用紧凑布局展示，避免图片过多导致阅读很累。

### Windows 端

<table>
  <tr>
    <td align="center" width="50%">
      <img src="public/软件预览-主界面.png" alt="Windows 主界面" width="420"><br>
      <b>主界面</b>
    </td>
    <td align="center" width="50%">
      <img src="public/软件预览-大厅界面.png" alt="Windows 大厅界面" width="420"><br>
      <b>大厅界面</b>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="public/软件预览-聊天室.png" alt="Windows 聊天室" width="420"><br>
      <b>聊天室</b>
    </td>
    <td align="center" width="50%">
      <img src="public/软件预览-文件夹共享.png" alt="Windows 文件夹共享" width="420"><br>
      <b>文件夹共享</b>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="public/软件预览-屏幕共享.png" alt="Windows 屏幕共享" width="420"><br>
      <b>屏幕共享</b>
    </td>
    <td align="center" width="50%">
      <img src="public/软件预览-设置.png" alt="Windows 设置" width="420"><br>
      <b>设置中心</b>
    </td>
  </tr>
</table>

<details>
<summary><b>查看更多 Windows 端预览</b></summary>

<table>
  <tr>
    <td align="center"><img src="public/软件预览-创建大厅.png" alt="创建大厅" width="320"><br><b>创建大厅</b></td>
    <td align="center"><img src="public/软件预览-加入大厅.png" alt="加入大厅" width="320"><br><b>加入大厅</b></td>
    <td align="center"><img src="public/软件预览-常用大厅信息.png" alt="常用大厅信息" width="320"><br><b>常用大厅</b></td>
  </tr>
  <tr>
    <td align="center" colspan="3"><img src="public/软件预览-大厅动态设置.png" alt="大厅动态设置" width="420"><br><b>大厅动态设置</b></td>
  </tr>
</table>
</details>

### Android 端

<table>
  <tr>
    <td align="center"><img src="public/手机端-主界面.jpg" alt="Android 主界面" width="180"><br><b>主界面</b></td>
    <td align="center"><img src="public/手机端-大厅界面.jpg" alt="Android 大厅界面" width="180"><br><b>大厅界面</b></td>
    <td align="center"><img src="public/手机端-大厅二维码.jpg" alt="Android 大厅二维码" width="180"><br><b>大厅二维码</b></td>
    <td align="center"><img src="public/手机端-设置.jpg" alt="Android 设置" width="180"><br><b>设置</b></td>
  </tr>
  <tr>
    <td align="center"><img src="public/手机端-聊天室.jpg" alt="Android 聊天室" width="180"><br><b>聊天室</b></td>
    <td align="center"><img src="public/手机端-文件夹共享.jpg" alt="Android 文件夹共享" width="180"><br><b>文件夹共享</b></td>
    <td align="center"><img src="public/手机端-屏幕共享.jpg" alt="Android 屏幕共享" width="180"><br><b>屏幕共享</b></td>
    <td align="center"><img src="public/手机端-大厅动态设置.jpg" alt="Android 大厅动态设置" width="180"><br><b>大厅设置</b></td>
  </tr>
</table>

## 核心功能

### 组网与连接

- **虚拟局域网组网**：基于 EasyTier 建立虚拟网络，无需公网 IP。
- **跨端加入大厅**：手机和电脑可加入同一个大厅，二维码邀请更方便。
- **公开大厅广场**：房主可把大厅公开到广场，陌生人也能在广场看到并一键加入一起玩。
- **自定义节点与虚拟域名**：支持添加自定义 EasyTier 节点，并为虚拟网络配置自定义域名。
- **内置 EasyTier 节点**：默认使用海波美国节点 `udp://us01.225284.xyz:11010`，也可切换海波中国大陆或唯爱厦门节点；客户端会记住上次选择。
- **邀请信息同步节点**：二维码、邀请链接、最近大厅和收藏大厅会同步并恢复对应的 EasyTier 节点与信令服务器配置，避免跨节点导致组网失败。
- **连接自动自愈**：桌面端和 Android 端均支持信令断线重连、成员状态二次确认与语音连接自动恢复，降低短暂网络波动造成的离线或听不到声音问题。
- **连接 / 网络诊断**：聚合成员直连、中继、延迟、丢包，给出整体评分与优化建议；网络诊断还能检测虚拟网卡、防火墙、UDP 端口与安全软件拦截，并支持一键放行防火墙。
- **私有化部署**：支持自建信令服务，便于掌控连接入口。

### 沟通与协作

- **实时语音频道**：大厅内可按频道语音，适合协作沟通。
- **语音小队**：把成员分到不同小队，只听同队语音，轻松实现分组开黑。
- **内置变声器**：实时语音变声，内置萝莉音、大叔音等多种音色，开麦聊天更有趣，支持先试听再应用。
- **大厅聊天室**：支持文字、图片与 Emoji 表情消息。
- **消息弹幕**：聊天消息以弹幕形式从屏幕顶部飘过，挂后台或玩游戏时也不错过消息；可调字号、速度、透明度、轨道数与颜色（含彩色随机），默认开启。
- **文件夹共享**：可向同大厅成员共享文件夹，支持下载与传输列表。
- **屏幕共享**：使用 WebRTC 查看对方屏幕画面。
- **远程控制**：基于 WebRTC 远程查看并实时操作对方设备，支持电脑↔手机互控；鼠标移动、左键/右键、长按、拖拽、滚轮、键盘输入、返回/主页/最近等手势一应俱全，并按对方分辨率自动选择横竖屏与最佳窗口尺寸。
- **房间工具**：内置掷骰子、倒计时与多人协同待办清单，方便跑团、抽签与团队任务安排，倒计时切界面或挂后台也不中断。

### 大厅管理与便捷

- **房主管理**：房主可发布滚动公告、设置人数上限、踢出成员、发布或下架到公开广场。
- **大厅二维码**：扫码加入或复制邀请链接。
- **常用大厅与最近联机**：收藏常用大厅一键填入，记录最近进入的大厅与一起玩过的玩家，并可收藏常用队友。
- **全局快捷键**：自定义快捷键，支持按键说话、一键静音等操作。
- **迷你悬浮窗**：在桌面端快速查看成员状态、控制语音和打开工具。
- **系统托盘运行**：桌面端支持快捷键或窗口按钮隐藏到系统托盘，恢复快捷键可自定义；隐藏后会显示 Windows 后台运行通知。
- **软件日志**：桌面端和 Android 端设置中提供日志查看或导出入口，便于排查连接、语音和界面问题。
- **游戏内 HUD 浮层**：游戏中以置顶穿透浮窗显示队友延迟、丢包与谁在说话，可静音、拖动、调透明度与缩放。

### 游戏联机增强

- **Minecraft 世界自动发现**：扫描大厅成员开放的 Minecraft 世界（MOTD/版本/在线人数/延迟），免输 IP 自动注入本机局域网列表一键加入。
- **游戏快连**：内置常见联机游戏端口预设，自动生成“虚拟 IP:端口”直连地址一键复制。
- **Minecraft 联机助手**：检测 Minecraft 安装路径与版本，提供局域网联机图文指南，并可自动为主流启动器关闭局域网正版验证。

### 进阶与其他

- **EasyTier 高级网络配置**：提供全局与单大厅级高级参数（KCP/QUIC 代理、延迟优先、P2P/打洞开关等），以及 SOCKS5、端口转发等出口节点设置。
- **物理设备绑定**：EasyTier 高级配置支持绑定指定物理网络设备，并在启动网络时使用正确的绑定参数。
- **本地数据统计**：纯本地统计联机时长、加入/房主次数、活跃时段与常玩伙伴排行，绝不上报网络。
- **新手引导向导**：首次启动逐步检测运行环境（权限、防火墙、安全软件）并一键修复。
- **版本更新检测**：启动时检测新版本并提示更新。

## 快速开始

### 系统要求

| 平台 | 要求 |
| --- | --- |
| Windows | Windows 10/11 64 位，建议 2GB 以上内存 |
| Android | Android 手机或平板，建议 Android 8.0+ |
| 网络 | 能访问所配置的 EasyTier 节点与 WebRTC 信令服务 |

### 下载与安装

前往 [GitHub Releases](https://github.com/pmh1314520/MCTier/releases) 或 [Gitee Releases](https://gitee.com/peng-minghang/mctier/releases) 下载最新版。

- Windows 安装包：下载 `MCTier_x.y.z_x64-setup.exe` 后双击安装。
- Windows 便携版：下载 `MCTier.exe` 后直接运行。
- Android：下载 `MCTier-Android.apk` 后在手机上安装。

### 创建或加入大厅

1. 创建方打开 MCTier，选择“创建大厅”。
2. 输入大厅名称、密码和显示名称。
3. 创建成功后，把大厅二维码或邀请链接发给其他成员。
4. 其他成员输入大厅信息或扫码加入。
5. 等待虚拟 IP 分配完成后，即可访问同大厅内设备开放的局域网服务。

## 示例：Minecraft 联机

MCTier 是通用组网工具，Minecraft 只是其中一个典型使用场景。

房主进入单人世界后，按 `Esc` 打开“对局域网开放”，记下端口号。其他人选择“直接连接”，输入房主的虚拟 IP 和端口，例如：

```text
10.126.126.1:25565
```

如果启用了虚拟域名，也可以使用类似 `成员名.mct.net:25565` 的地址连接。

## 私有化部署快速流程

如果你想自建 MCTier 信令服务器，请从 MCTier 官网获取 `MCTier信令服务器.zip` 及配套部署文档。本源码仓库只包含桌面端与 Android 客户端源码，不包含官网和信令服务器部署包。

基本流程：

1. 准备一台 Linux 服务器或局域网内主机。
2. 安装 Docker 与 Docker Compose。
3. 上传并解压 `MCTier信令服务器.zip`。
4. 进入解压目录，给部署脚本执行权限。
5. 运行部署脚本，按提示填写域名或 IP。
6. 在 MCTier 客户端设置中填入你的私有信令地址。

常用命令：

```bash
unzip MCTier信令服务器.zip
cd MCTier信令服务器
chmod +x deploy.sh
sudo ./deploy.sh
docker compose -f docker-compose-http.yml ps
docker compose -f docker-compose-http.yml logs -f
```

## 开发与构建

### 第一步：获取第三方二进制（首次 clone 后必做）

`src-tauri/src/modules/resource_manager.rs` 通过 `include_bytes!` 在编译期内嵌 5 个第三方二进制。这些文件受版权与许可限制（尤其是 Npcap 的 `Packet.dll`，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 第 8 节），因此不纳入本仓库。clone 之后必须先运行下面的脚本，否则 `cargo build` 会因找不到文件而失败：

```powershell
.\scripts\fetch-binaries.ps1
```

该脚本从 EasyTier 官方 Release 下载 `easytier-windows-x86_64-v2.5.0.zip`，逐个校验 SHA-256（任一不匹配即中止），再放入 `src-tauri/resources/binaries/`。已存在且校验通过的文件会被跳过；如需强制重新获取请加 `-Force`。

### 第二步：构建
```bash
npm install
npm run tauri dev
# 发布 Windows NSIS 安装包（推荐使用仓库内固定 Node）
npm run tauri build -- --bundles nsis --ci
```

桌面端的发布构建只生成 NSIS 安装包，避免同时生成 MSI 时重复处理离线 WebView2 安装器。仓库中的一键版本更新工具会自动准备固定 Node，并使用相同的 NSIS 参数。

Android 端源码位于：

```text
MCTier-Android/
```

调试或打包 Android：

```bash
cd MCTier-Android
gradlew.bat assembleDebug
```

## 赞助支持

MCTier 会持续维护桌面端和手机端体验。如果它帮你完成了组网、联机或协作，欢迎赞助支持开发工作。每一份赞助都会用于继续优化连接稳定性、双端体验和后续功能。

<div align="center">
  <table>
    <tr>
      <td align="center" width="50%">
        <img src="public/zfb.jpg" alt="支付宝收款码" width="240"><br>
        <b>支付宝赞助</b>
      </td>
      <td align="center" width="50%">
        <img src="public/wx.png" alt="微信收款码" width="240"><br>
        <b>微信赞助</b>
      </td>
    </tr>
  </table>
</div>

## 许可协议

MCTier **自有代码**使用自定义**源码可得（source-available）非商业**许可（详见 [LICENSE](LICENSE)）：

- 仅供个人学习与非商业使用。
- 允许二次开发，但必须保留原作者信息。
- 衍生项目需要按相同协议公开源代码。

> 用词说明：由于本许可禁止商业用途，它**不符合** OSI 对“开源许可证”的定义，
> 因此本项目对自有代码统一表述为“源码可得 / 非商业许可”，而非“开源许可证”。
> 项目源代码仍然完整公开。项目中包含的第三方组件多为真正的开源许可证，
> 其权利不受本许可限制（见下文）。

### 第三方组件与许可证边界

**上述限制仅适用于 MCTier 自有代码，不适用于项目中包含的 EasyTier 组件。**

本软件使用 [EasyTier](https://github.com/EasyTier/EasyTier) 提供虚拟组网能力。
EasyTier 及 MCTier 对其所作的任何修改，继续按 **LGPL-3.0** 授权：

```
本软件使用 EasyTier 项目。
EasyTier Copyright (c) EasyTier contributors.
EasyTier is licensed under the GNU Lesser General Public License version 3.0 (LGPL-3.0).
Source: https://github.com/EasyTier/EasyTier
```

- “禁止商业用途”**不适用于** EasyTier 的 LGPL-3.0 部分；
- “二次开发必须以相同协议开源”**不适用于** EasyTier 的 LGPL-3.0 部分；
- MCTier 自定义协议不得被解释为限制 LGPL-3.0 赋予使用者的任何权利。

| 组件 | 平台 | 版本 | Commit | 许可证 | 是否修改 |
| --- | --- | --- | --- | --- | --- |
| EasyTier | Windows（独立进程） | v2.5.0 | `88a45d11...` | LGPL-3.0 | 否 |
| EasyTier | Android（`.so` 动态库） | 基于 v2.6.0 | `79b562cd...` | LGPL-3.0 | 是（见补丁） |

相关文件：

- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) — 版本、commit、修改状态、源码获取方式、二进制 SHA-256
- [LICENSE-LGPL-3.0.txt](LICENSE-LGPL-3.0.txt) — LGPL-3.0 全文
- [LICENSE-GPL-3.0.txt](LICENSE-GPL-3.0.txt) — GPL-3.0 全文（LGPL-3.0 以引用方式并入）
- [patches/easytier-2.6.0-mctier-android.patch](patches/easytier-2.6.0-mctier-android.patch) — Android 端 EasyTier 修改补丁
- [docs/android/rebuild-with-modified-easytier.md](docs/android/rebuild-with-modified-easytier.md) — 用自行修改的 EasyTier 重新构建 Android 版
- [licenses/](licenses/) — 各第三方许可证全文（LGPL-3.0、GPL-3.0、GPL-2.0、Apache-2.0、MIT、BSD-3-Clause、Wintun）

`THIRD_PARTY_NOTICES.md` 覆盖 EasyTier、Wintun、WinDivert、Npcap、Javassist、
LocalVQE / GGML / 模型权重、WebRTC 及各应用级依赖的版本、SHA-256、许可证与修改状态。

### 商标与非官方声明

本项目不是官方 Minecraft 产品，未获 Mojang Studios 或 Microsoft 批准、认可、关联或背书。
Minecraft 是 Mojang Synergies AB 及其关联主体的商标。

WireGuard LLC、WireGuard 项目与 Wintun 项目均未对本项目作任何背书。

## 默认服务与元数据披露

MCTier 的通信内容（聊天、语音、文件、屏幕、远程控制）在成员设备之间点对点直接传输。但**建立连接**以及**版本检查**需要访问以下默认服务。若你使用默认配置，这些服务端会看到相应的连接元数据：

| 默认服务 | 地址 | 服务端可见的元数据 | 用途 |
|---|---|---|---|
| 信令服务器 | `wss://mctier.pmhs.top/signaling` | 公网 IP、连接时间、大厅名称与密码哈希用于匹配、玩家名、虚拟 IP/虚拟域名、成员数、客户端版本 | 交换 WebRTC 信令、发现同一大厅的成员 |
| EasyTier 公共节点 | `udp://us01.225284.xyz:11010` | 公网 IP、连接时间、EasyTier 网络标识 | P2P 打洞与必要时的流量中继 |
| 版本检查 | `https://gitee.com/api/v5/repos/peng-minghang/mctier/tags` | 公网 IP、请求时间（由 Gitee 记录） | 获取最新版本号 |

说明：

- **元数据 ≠ 通信内容**。信令服务器与 EasyTier 节点不解密、不存储你的聊天、语音、文件内容。
- **保留期限与删除**：官方信令服务器仅在会话期间于内存中保存大厅与成员映射，会话结束即释放；不建立长期用户画像。如需删除相关记录，可通过 issue 或官网联系方式提出。
- **版本检查**由 Gitee 提供，其日志策略遵循 Gitee 自身的隐私政策。
- **可以完全不使用官方服务**：在「设置 → 高级」中填入自建信令服务器与自建 EasyTier 节点即可（见「私有化部署快速流程」），此时不会有任何数据经过官方服务。版本检查可在设置中关闭。
- 功能列表中的「本地数据统计绝不上报网络」**仅指该统计功能本身**（联机时长、加入/房主次数等纯本地计算，不会离开你的设备），并不意味着其他功能不访问上述默认服务。
## 免责声明

- MCTier 是一款**中立的虚拟局域网组网与协作工具**，仅供在符合所在地法律法规的前提下用于个人合法用途（如局域网游戏联机、协作、访问你本人或已获授权的服务）。
- 通信内容（聊天、语音、文件、屏幕、远程控制等）均在成员设备之间**点对点直接传输**，开发者不参与、不控制、也无法审查任何用户内容或其具体使用行为。
- **使用者须对自己的全部使用行为及传输内容独立承担法律责任。** 严禁利用本项目从事任何违反法律法规的活动，包括但不限于：未经许可的经营性/跨境组网、传播违法违规及侵权信息、未经授权控制或监控他人设备、利用语音/变声进行诈骗或冒充他人等。
- 远程控制、屏幕共享、变声器等敏感功能在应用内均需用户**明确同意相应提示与协议后方可使用**，并提供风险与禁止性条款告知。
- 本软件按“现状”提供，不作任何明示或默示担保；在法律允许的最大范围内，开发者不对使用本软件造成的任何直接或间接损失负责。
- 如你不同意上述任何内容，请勿下载、安装或使用本项目。详见应用内《用户协议》《隐私政策》《免责声明》。

## 作者

青云制作_彭明航

- GitHub: <https://github.com/pmh1314520/MCTier>
- Gitee: <https://gitee.com/peng-minghang/mctier>

---

<div align="center">
  <b>MCTier 对个人非商业使用完全免费，源代码完整公开，祝使用顺利。</b>
</div>
