# MCTier Linux 版（Debian 家族）

Linux 端与 Windows 端**共用同一份源码**，位于上一级的 `MCTier桌面应用/`。
平台差异全部由 Rust 的 `#[cfg(target_os = "linux")]` 分支实现，本目录只放
Linux 独有的构建、打包与运行时资产。

## 为什么不在这里再放一份源码

需求原本是"新增 MCTier-Linux 文件夹放 Linux 版源码"，同时"Linux 端与 Windows 端
同步更新"。这两条实际是冲突的：一旦复制出第二份源码，两边必然随提交发散，
"同步更新"就只能靠人工逐个搬运补丁，迟早漏。所以这里采取的是单一源码 + 条件编译：

- 改一次业务逻辑，双端同时生效，不存在"Windows 修了 Linux 没修"；
- Windows 侧的行为**逐字节不变**——所有原有代码路径都还包在 `#[cfg(windows)]` 里，
  新增分支只在非 Windows 目标上编译；
- CI 里 Windows 与 Linux 两个任务分别编译并跑单测，任何一侧写坏都会红灯。

## 目录内容

| 路径 | 用途 |
|---|---|
| `scripts/install-deps.sh` | 安装 Debian 家族的构建与运行依赖 |
| `scripts/fetch-binaries.sh` | 下载并校验 EasyTier Linux 二进制（与 Windows 同一 Release） |
| `scripts/build.sh` | 前端 + Rust 构建，产出 deb / AppImage |
| `scripts/run-linux.sh` | 启动包装脚本，收拢输入法 / 渲染 / 日志相关环境变量 |
| `packaging/mctier.desktop` | 桌面菜单条目，注册 `mctier://` 深链 |
| `packaging/com.mctier.app.policy` | polkit 动作定义，用于授予组网组件 TUN 能力 |

## 快速开始

```bash
cd MCTier桌面应用
./MCTier-Linux/scripts/install-deps.sh      # 装系统依赖（需要 sudo）
./MCTier-Linux/scripts/fetch-binaries.sh    # 取 EasyTier 二进制并校验 SHA-256
./MCTier-Linux/scripts/build.sh             # 构建并打包
```

产物在 `src-tauri/target/release/bundle/` 下。

## 权限模型：与 Windows 的关键差异

Windows 版需要管理员权限，因为 wintun 要装用户态驱动。Linux 上**应用本体全程以
普通用户运行**，只有 `easytier-core` 这一个文件需要能力：

```
cap_net_admin   建 TUN 虚拟网卡（TUNSETIFF）、配路由
cap_net_raw     原始套接字，用于对端探测 / ICMP
```

启动前先 `getcap` 预检，缺失才通过 `pkexec setcap` 弹一次图形授权框。因此
`is_admin` 在 Linux 返回 `true` 并不是敷衍——真实的权限判断前移成了对二进制的
能力检查（`linux_platform::ensure_easytier_tun_capability`），缺能力时创建大厅会
明确报错，不会静默失败。

两点实现上的讲究：

- `pkexec` 退出码 0 **不等于** setcap 生效（文件在 FAT/exFAT 或 nosuid 挂载点上会
  静默无效）。授权后必须再读一次 `getcap` 复核，我们这么做了。
- 授权是文件级持久化的，只需一次；但二进制被重新提取（版本更新）后新文件不继承
  旧能力，需要重新授权。

远程控制被控端不走 xdg-desktop-portal，用进程内 uinput 设备（与 RustDesk 在 KDE
Wayland 上同方案）。logind 对活动会话用户的 `/dev/uinput` 有 ACL 放行，无需提权。

## 功能状态

不做"编译通过即支持"的宣称。下表区分**已实机验证**、**已实现但未实机验证**和
**已知不可用**。

| 功能 | 状态 | 说明 |
|---|---|---|
| 虚拟组网（创建 / 加入大厅） | ✅ 已验证 | 内核 TUN，DHCP 10.126.126.0/24，与 Windows 同网段，p2p 直连公共节点 |
| 虚拟网卡检测 | ✅ 已验证 | 扫描 `/sys/class/net`，显式排除 docker0 / virbr0 / wg0 / tailscale0 等无关虚拟网卡 |
| TUN 能力授予（pkexec setcap） | ✅ 已验证 | 含授权后 getcap 复核 |
| 退出大厅资源回收 | ✅ 已验证 | 进程与网卡均干净回收 |
| 信令 / 大厅 / 聊天室 / 玩家列表 | ✅ 平台无关 | 走 WebSocket，无平台相关代码 |
| 文件夹共享 | ✅ 平台无关 | HTTP + 信令，无平台相关代码 |
| hosts 注入（Minecraft 域名映射） | 🔄 已实现 | 无写权限时经 `pkexec cp` 落盘；未实机验证 |
| 防火墙放行（ufw / firewalld） | 🔄 已实现 | 按 TUN 接口放行，范围比 Windows 按程序放行更窄；未实机验证 |
| 开机自启 | 🔄 已实现 | XDG autostart `.desktop`；未实机验证 |
| 远程控制（主控端） | 🔄 已实现 | 依赖 WebRTC，见下方已知限制 |
| 远程控制（被控端注入） | 🔄 已实现 | uinput 三设备（触摸绝对定位 / 鼠标按键滚轮 / 键盘）；未实机验证 |
| 语音通话 | ❌ 发行版阻塞 | 见下方已知限制 |
| 屏幕共享 | ❌ 发行版阻塞 | 同上 |
| 杀软检测 | ➖ 不适用 | Windows 语义，Linux 返回空列表 |
| 文本注入（穿越输入法） | ❌ 不支持 | uinput 只能发按键码，明确降级 |

## 已知限制

### Debian 官方的 webkit2gtk 编译期没开 WebRTC

这是 Linux 上语音 / 屏幕共享 / 远程控制无法工作的**根因**，与 MCTier 的代码无关：
Debian 官方构建的 webkit2gtk 里 `RTCPeerConnection === undefined`（而
`getUserMedia` 反而存在，很容易误判成应用 bug）。`enable-media-stream` 设为
`true` 也救不回来，因为能力在编译期就被裁掉了。

排查 Linux 上的媒体问题时，**第一优先级是确认发行版的 WebKit 构建**，而不是查代码。
在页面控制台里执行 `typeof RTCPeerConnection` 即可判定。

解法是用 `-DENABLE_WEB_RTC=ON` 自建 WebKitGTK，放到下列任一目录，
`run-linux.sh` 会通过 `LD_LIBRARY_PATH` **只对本应用**生效，不影响系统里其他程序：

```
$MCTIER_WEBKIT_LIB_DIR
~/.local/lib/mctier-webkit
/opt/mctier/webkit/lib
```

此处的信息来自 fork 作者 [xingshuo-j/MCTier](https://github.com/xingshuo-j/MCTier)
在 Debian 13 (trixie) + KDE Plasma 6 Wayland 真机上的实测，我们未独立复验；
但结论可用一行控制台命令自查，成本很低。

### 输入法在密码框吞键

fcitx5 / ibus 的 GTK IM 模块在 WebKitGTK 的 `<input type="password">` 上会吞掉按键，
表现为"密码框一个字都打不出来"。这里做了两层处理：

1. `run-linux.sh` 默认清空 `GTK_IM_MODULE`，让 GTK 走 Wayland 的 text-input-v3，
   普通输入框的中文输入不受影响。若你的环境不受此影响，可设 `MCTIER_KEEP_IM_MODULE=1` 跳过。
2. 仅靠上面这条**不够**——fork 作者在 Debian 13 + KDE Plasma 6 Wayland 上实测同款写法仍会复现。
   因此前端在 Linux 下不再使用原生密码框，改用普通文本框 + CSS `-webkit-text-security`
   遮罩并配显示/隐藏切换（`src/components/PasswordInput/`），从引擎层绕开这条冲突路径。
   Windows 继续走原生密码框，保留浏览器自带的密码语义。

第 2 条是兜底，所以即使第 1 条被 `MCTIER_KEEP_IM_MODULE=1` 关掉，密码也仍然能输入。

### 透明窗口在部分核显驱动上显示异常

主窗口是无边框 + 透明。少数 AMD / Intel 核显驱动下 WebKitGTK 的 GPU 合成路径会让
透明窗口出现黑底或花屏。默认不改渲染路径（性能更好），遇到问题用
`MCTIER_SOFTWARE_RENDER=1` 兜底。

## 相对 fork 版修正的问题

移植 fork 的 uinput 实现时发现三处会让远程控制"看起来能用实际不通"的缺陷，已在
本仓库的实现里修掉：

1. **键盘事件发到了鼠标设备**。该设备只声明了 3 个 `BTN_*` 位，内核会静默丢弃所有
   `KEY_*` 码——键盘从未真正工作过。现在键盘是独立设备，且有单测断言所有映射到的
   键码都落在该设备声明的位范围内。
2. **滚轮方向反了**。fork 发的是 `-ticks`，与 Windows 的 `MOUSEEVENTF_WHEEL` 相反，
   双端联动时滚动方向会不一致。
3. **数字键与字母键映射错位**。fork 用 `KEY_0 + (code - 0x30)` 和
   `KEY_A + (code - 0x41)` 线性推算，但 evdev 的键码是物理 QWERTY 顺序而非字母顺序，
   多数按键会打错字符。现在改为显式映射表。

另外，fork 写 `/etc/hosts` 用的是
`pkexec /bin/sh -c "cat '<tmp>' > /etc/hosts"` —— 把路径拼进 **root shell** 属于
命令注入面。本仓库改为 `pkexec /bin/cp -- <tmp> <path>`，argv 数组传参，不经 shell。

## 三端互通

Linux、Windows、Android 三端使用同一套信令协议与同一个 EasyTier Release
（v2.5.0，commit `88a45d11`），虚拟网段一致，因此组网层互通不依赖任何平台特判。
`fetch-binaries.sh` 里固定了版本号与 SHA-256，防止 Linux 侧悄悄升级到不同版本后
出现"Windows 能连、Linux 连不上"的错配。
