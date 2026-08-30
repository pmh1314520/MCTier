# 第三方组件声明 / Third-Party Notices

本文件说明 MCTier 发布版本中包含的第三方组件、其许可证、来源、版本与修改状态。

This file documents the third-party components distributed with MCTier, together with
their licenses, upstream sources, versions and modification status.

最后更新 / Last updated: 2026-08-30（对应 MCTier 2.8.0）

---

## 1. 组件总览 / Component Summary

| 组件 | 来源 | 版本 | Commit | 许可证 | 是否修改 |
| --- | --- | --- | --- | --- | --- |
| EasyTier (Windows `easytier-core.exe` / `easytier-cli.exe`) | https://github.com/EasyTier/EasyTier | v2.5.0 | `88a45d115670631dfe6a05ba192387d615ddb95b` | LGPL-3.0 | 否 / No |
| EasyTier (Android `libeasytier_ffi.so` / `libeasytier_android_jni.so`) | https://github.com/EasyTier/EasyTier | 以 v2.6.0 为补丁基线 / patch baseline v2.6.0 | 基线 `79b562cdc9f1dc3f52195a47a02cf83542c225ab` + 本仓库补丁 | LGPL-3.0 | 是 / Yes（见 §5） |
| Wintun (`wintun.dll`) | https://www.wintun.net | 0.14.1 | — | Wintun Prebuilt Binaries License | 否 / No（见 §7） |
| WinDivert (`WinDivert64.sys`) | https://reqrypt.org/windivert.html | 2.2.2 | — | LGPL-3.0（双许可中所选分支） | 否 / No（见 §7） |
| Npcap (`Packet.dll`) | https://npcap.com | 1.79 | — | 专有 / Proprietary | 否 / No（授权状态见 §8） |
| Javassist（内嵌于 offline agent） | https://github.com/jboss-javassist/javassist | 3.29.2-GA | — | Apache-2.0（三重许可中所选分支） | 否 / No（见 §9） |
| LocalVQE (`liblocalvqe.so`，仅 Android 端) | https://github.com/localai-org/LocalVQE | 见 §10 | — | Apache-2.0 | 否 / No（见 §10） |
| GGML（内嵌于 LocalVQE） | https://github.com/ggerganov/ggml | 见 §10 | — | MIT | 否 / No（见 §10） |
| GTCRN 模型权重 (`*.gguf`，仅 Android 端) | https://huggingface.co/LocalAI-io/LocalVQE | pi-v1-49k-f32 | — | 训练数据含 CC BY 4.0 素材 | 否 / No（见 §10） |
| WebRTC | https://webrtc.googlesource.com/src | 见 §11 | — | BSD-3-Clause | 否 / No |

> 说明：本表覆盖 MCTier 分发物中所有**内嵌或随包分发**的第三方二进制与模型。
> 应用级依赖（npm / crate / Gradle）见 §11。

---

## 2. EasyTier 版权与许可证声明 / EasyTier Copyright and License

```
本软件使用 EasyTier 项目。
EasyTier Copyright (c) EasyTier contributors.
EasyTier is licensed under the GNU Lesser General Public License version 3.0 (LGPL-3.0).
Source: https://github.com/EasyTier/EasyTier
```

EasyTier 上游项目在其仓库根目录以 LGPL-3.0 授权（`LICENSE`，即 GNU LGPL-3.0 全文），
其 `easytier/Cargo.toml` 中 `authors = ["kkrainbow"]`、`license-file = "LICENSE"`。
MCTier 不对 EasyTier 的版权主体作任何额外主张。

许可证全文见本仓库：

- `LICENSE-LGPL-3.0.txt` — GNU Lesser General Public License v3.0 全文
- `LICENSE-GPL-3.0.txt` — GNU General Public License v3.0 全文（LGPL-3.0 以引用方式并入该许可证）
- `LGPL_LICENSE.txt` — 历史保留文件，内容同 LGPL-3.0 全文

---

## 3. 许可证边界 / License Boundary

- MCTier 自有代码使用 MCTier 自定义**源码可得（source-available）非商业**许可（见 `LICENSE`）。
- **本表及下文列出的全部第三方组件**（EasyTier、Wintun、WinDivert、Npcap、Javassist、
  LocalVQE、GGML、模型权重、WebRTC 及各应用级依赖），连同 MCTier 对它们所作的任何
  衍生或修改部分，**均不适用** MCTier 自定义许可，而继续按各自许可证授权。
- MCTier 自定义许可中的“禁止商业用途”“二次开发必须以相同协议开源”等条款
  **不适用于**上述任何第三方组件，也**不得**被解释为限制其许可证
  （LGPL-3.0、GPL-2.0、Apache-2.0、MIT、BSD-3-Clause、CC BY 4.0 及 Npcap 条款等）
  赋予使用者的任何权利。
- 各组件许可证全文集中存放于 `licenses/`。

详细条款见 `LICENSE` 中的“第三方组件与许可证边界”一节。

### 3.1 许可证文本如何随发行版交付 / How License Texts Are Delivered

LGPL-3.0 要求许可证文本随发行版一同提供，因此两端均**不依赖联网**即可读到全文：

- **Windows 桌面端**：`src-tauri/tauri.conf.json` 的 `bundle.resources` 将 `LICENSE`、
  `THIRD_PARTY_NOTICES.md`、`licenses/*`（含 LGPL-3.0 与 GPL-3.0 全文）以及 Android 端的
  EasyTier 补丁一并打进安装包的 `licenses/` 目录；应用「关于」窗口另有第三方组件声明区块。
- **Android 端**：`MCTier-Android/app/build.gradle.kts` 的 `syncLicenseAssets` 任务在构建时
  从仓库根目录复制 `LICENSE`（打包为 `LICENSE.txt`）、`LICENSE-LGPL-3.0.txt`、
  `LICENSE-GPL-3.0.txt`、`THIRD_PARTY_NOTICES.md` 与 EasyTier 补丁进 APK 的 `assets/`；
  「关于 → 开源许可与第三方组件」可直接在应用内查看这些全文。
  这些文件由构建任务从**单一来源**同步，不存在与仓库根目录不一致的副本；
  `isShrinkResources` 不会移除 `assets/` 下的文件（已在 release 产物中核验）。

---

## 4. Windows 端 EasyTier 集成 / Windows Integration

**集成方式：独立进程（未链接 EasyTier 库）**

- MCTier 通过 `std::process::Command::new(&easytier_path)` 以**独立子进程**方式启动
  `easytier-core.exe`，并通过命令行参数与标准输出交互
  （见 `src-tauri/src/modules/network_service.rs`）。
- `easytier-core.exe` / `easytier-cli.exe` 为上游官方发布的**独立可执行文件**，
  由 `src-tauri/src/modules/resource_manager.rs` 在运行时释放到应用数据目录后调用。
- MCTier 的 Rust 工程**没有**依赖 `easytier` crate：`src-tauri/Cargo.toml` 与
  `src-tauri/Cargo.lock` 中均不存在 `easytier` 依赖项，不存在静态链接、动态库调用或 FFI。

**未修改性证明（SHA-256）**

MCTier 发布包中分发的 EasyTier 二进制（构建时取自 `src-tauri/resources/binaries/`；
该目录下的 `.exe` / `.dll` 按 `.gitignore` 规则不纳入 Git 版本库，构建时直接使用上游官方发布包原件）
与上游官方发布包 `easytier-windows-x86_64-v2.5.0.zip`（tag `v2.5.0`）逐字节一致：

| 文件 | SHA-256 |
| --- | --- |
| `easytier-core.exe` | `A47B63A7763FB4CCF9D56F3A7E936163619C89A1E34C9D1E84022375A7D2711F` |
| `easytier-cli.exe` | `83A31B18CB92436BFD6D85C4A22B27594FB5A2EC7BB1E46ADF9245EBD935667B` |
| `easytier-web.exe` | `4AFF79986A665F2919D32AE5BD928733A8C0555A474578D1E90AB96CE38F11EC` |
| `easytier-web-embed.exe` | `3CE38602FD67499646CC8996D8B7A8A03E409C5F4B72623B09C97B97B75F850E` |

`easytier-core.exe --version` 输出 `easytier-core 2.5.0-88a45d11`，与 tag `v2.5.0`
的 commit `88a45d115670631dfe6a05ba192387d615ddb95b` 对应。

任何人可通过以下方式独立复核：下载上述官方发布包，对同名文件计算 SHA-256 并比对。

---

## 5. Android 端 EasyTier 集成与修改说明 / Android Integration and Modifications

**集成方式：动态库（`.so`）+ JNI/FFI**

- `libeasytier_ffi.so`：EasyTier 的 C ABI 动态库（`easytier-contrib/easytier-ffi`）。
- `libeasytier_android_jni.so`：EasyTier 的 Android JNI 动态库
  （`easytier-contrib/easytier-android-jni`），动态链接 `libeasytier_ffi.so`。
- 位置：`MCTier-Android/app/src/main/jniLibs/arm64-v8a/`（已纳入 Git 版本库），
  安装后位于 APK 的 `lib/arm64-v8a/`。
- 由 `MCTier-Android/scripts/build-easytier-jni.ps1` 通过 Android NDK 交叉编译产生。

**修改状态：已修改（B）**

Android 端 `.so` 由**经过修改的** EasyTier 源码构建。该源码可由公开的 EasyTier v2.6.0
（commit `79b562cdc9f1dc3f52195a47a02cf83542c225ab`）加上本仓库提供的补丁精确重建
（基线的详细说明见下文“关于基线的诚实说明”）。完整差异以补丁形式提供：

```
patches/easytier-2.6.0-mctier-android.patch
```

该补丁共涉及 22 个文件（21 个修改 + 1 个新增），SHA-256：
`A9563F1798C86EF7DC123F6037568C37771CD3B464F4100CDA8EE94D9F2E951A`

主要修改项及目的：

| 文件 | 修改目的 |
| --- | --- |
| `easytier-contrib/easytier-ffi/src/lib.rs` | `set_tun_fd` 失败时输出具体错误信息与已知实例名，便于 Android 侧定位 TUN 传递失败原因 |
| `easytier-contrib/easytier-android-jni/build.rs`（新增） | 声明链接搜索路径并动态链接 `easytier_ffi`，使 JNI 库可在 NDK 交叉编译下正确链接 |
| `easytier-contrib/easytier-android-jni/Cargo.toml` | 启用上述 `build.rs` |
| `easytier/src/tunnel/mod.rs` | 为 `TunnelType` 派生 `IntoStaticStr` |
| `easytier/src/tunnel/*.rs`、`easytier/src/connector/*.rs`、`easytier/src/proto/*` | 与所用源码快照一致的 `resolved_remote_addr` 相关差异 |
| `tauri-plugin-vpnservice/Cargo.toml` | 固定 `tauri` / `tauri-plugin` 版本以适配构建环境 |

**关于基线的诚实说明**

Android 侧所用的 EasyTier 源码快照与上游任何单一发布 tag 均**不是**逐字节相同，
因此本项目**不**声称“基于某个 tag 且未修改”。经比对确认：

- 该快照的 `easytier/Cargo.toml` 版本号为 `2.6.0`；
- 但它**缺少** v2.6.0 tag 中已包含的部分 `resolved_remote_addr` 相关改动，
  而 v2.5.0 中完全不存在该特性 —— 说明该快照对应 v2.5.0 与 v2.6.0 之间的某个**中间提交**
  （版本号已提升为 2.6.0、但 tag 尚未发布时的状态）；
- 在该上游快照之上，还存在 MCTier 自行所作的修改（例如 `known_names` 错误信息、
  新增 `easytier-contrib/easytier-android-jni/build.rs`，这些内容在
  v2.5.0 / v2.6.0 / v2.6.1 / main 中均不存在）。

因此，上述补丁 `patches/easytier-2.6.0-mctier-android.patch` 是**以公开可获取的 v2.6.0
tag 为基线**的完整差异记录，其中同时包含「上游中间提交与 v2.6.0 的差异」与
「MCTier 自身的修改」两部分。以 v2.6.0 作为基线是为了让任何人都能用一个明确、
可下载的公开版本 + 一个补丁，精确重建出 MCTier 实际使用的源码。

**可复现性验证**

以 v2.6.0 源码为基线应用该补丁后，所得源码与 MCTier 实际构建所用源码逐字节一致
（已对补丁涉及的全部 22 个文件校验通过）。复核步骤见
`docs/android/rebuild-with-modified-easytier.md`。

构建产物 SHA-256（供对应关系参考；Rust 构建默认不保证比特级可复现）：

| 文件 | SHA-256 |
| --- | --- |
| `libeasytier_ffi.so` | `E30B48D5D04A85C0A244FF250173B7D476029ED985368DC6F1029466A8CBB60B` |
| `libeasytier_android_jni.so` | `353B19D46FD1329C0C13EC060A4366BB080E7BCCD00C413FD0B63689FE9B3E4F` |

---

## 6. 源码获取方式 / How to Obtain the Corresponding Source

使用者**无需联系 MCTier 作者**即可获得 EasyTier 对应源码：

1. **上游源码**：https://github.com/EasyTier/EasyTier
   - Windows 端：tag `v2.5.0`
     （https://github.com/EasyTier/EasyTier/releases/tag/v2.5.0）
   - Android 端基线：tag `v2.6.0`
     （https://github.com/EasyTier/EasyTier/releases/tag/v2.6.0）
2. **MCTier 所作修改**：本仓库 `patches/easytier-2.6.0-mctier-android.patch`
   （随源码仓库公开分发，GitHub 与 Gitee 镜像均可获取）。
3. **重新构建说明**：`docs/android/rebuild-with-modified-easytier.md`。

MCTier 承诺在提供对应发布版本期间持续保持上述源码与补丁可公开获取。

---

## 7. Windows 端其他内嵌二进制 / Other Bundled Windows Binaries

以下二进制随 EasyTier 官方 Windows 发布包一同获得，构建时内嵌进 `MCTier.exe`，
运行期由 `resource_manager.rs` 释放到应用数据目录，供 `easytier-core.exe` 使用。
均**未经修改**，SHA-256 可独立复核。

| 组件 | 版本 | 许可证 | 版权 | SHA-256 | 是否修改 |
| --- | --- | --- | --- | --- | --- |
| `wintun.dll` | 0.14.1 (amd64) | Wintun Prebuilt Binaries License | Copyright (C) 2018-2021 WireGuard LLC. All Rights Reserved. | `E5DA8447DC2C320EDC0FC52FA01885C103DE8C118481F683643CACC3220DAFCE` | 否 |
| `WinDivert64.sys` | 2.2.2 | **LGPL-3.0**（双许可中所选分支） | Copyright (C) Basil Nemeth / WinDivert contributors | `8DA085332782708D8767BCACE5327A6EC7283C17CFB85E40B03CD2323A90DDC2` | 否 |
| `Packet.dll` | Npcap 1.79 | 专有（Npcap License）— 见 §8 | Copyright (c) 2023, Insecure.Com LLC. | `C7C03A87EAC7243CCBE331554624B18803010B740E311FC8CFDDB573096EACAC` | 否 |

### Wintun

Wintun 官方 `Prebuilt Binaries License` 全文见 `licenses/LICENSE-Wintun.txt`
（取自 `https://www.wintun.net/builds/wintun-0.14.1.zip` 内 `wintun/LICENSE.txt`）。

MCTier 仅通过官方 `wintun.h` 暴露的 Permitted API 间接使用该库（由 EasyTier 调用），
未反向工程、未修改、未移除任何版权或专有声明，符合其 §3(b)(c)(d)。

依其 §3(e)：**WireGuard LLC、WireGuard 项目与 Wintun 项目均未对 MCTier 作任何背书。**

### WinDivert

WinDivert 采用 LGPL-3.0 / GPL-2.0 双许可。**MCTier 选择 LGPL-3.0 分支。**

- LGPL-3.0 全文：`licenses/LICENSE-LGPL-3.0.txt`
- GPL-3.0 全文（LGPL-3.0 引用并入）：`licenses/LICENSE-GPL-3.0.txt`
- GPL-2.0 全文（另一可选分支，一并提供以便复核）：`licenses/LICENSE-GPL-2.0.txt`
- 上游：https://reqrypt.org/windivert.html

WinDivert 属 §3 许可证边界所述的 LGPL 组件，MCTier 自定义协议同样**不适用**于它。

---

## 8. Npcap（`Packet.dll`）授权状态 / Npcap Licensing Status

**当前状态：项目方尚未取得 Npcap OEM Redistribution License。**

Npcap 不是开源软件，未经 Nmap Project 书面许可不得随其他软件再分发。经核验：

- 内嵌 `Packet.dll` 与 Npcap 1.79 **免费版安装器**内的同名文件逐字节相同
  （SHA-256 `C7C03A87...`），PE 版本资源为 `ProductName: Npcap`、
  `ProductVersion: 1.79`、`Copyright (c) 2023, Insecure.Com LLC.`；
- 该逐字节一致性同时说明它**不是**来自 OEM 授权版（OEM 版为独立构建）。

### 8.1 `Packet.lib`：已停止捆绑 / No Longer Bundled

`Packet.lib` 是 **MSVC 链接期导入库（import library）**，仅在编译链接阶段被 `link.exe` 使用，
运行期完全不需要。已实测验证：在仅含 `easytier-core.exe`、`Packet.dll`、`wintun.dll`、
`WinDivert64.sys`（**不含** `Packet.lib`）的目录中执行 `easytier-core.exe --version`，
输出 `easytier-core 2.5.0-88a45d11`，退出码 0。

因此自本次整改起，`Packet.lib` **不再**通过 `include_bytes!` 内嵌进 `MCTier.exe`，
也不再由 `resource_manager.rs` / `network_service.rs` 释放到工作目录，
并已从 `scripts/fetch-binaries.ps1` 的必需文件清单中移除。
Npcap 再分发面仅剩 `Packet.dll` 一项。

### 8.2 `Packet.dll`：运行期硬依赖的真实成因 / Root Cause of the Runtime Dependency

**技术事实（已实测）**：`easytier-core.exe` 的 PE 导入表中**静态导入** `packet.dll`
（`easytier-cli.exe` 不导入）。在缺少 `Packet.dll` 的目录中运行 `easytier-core.exe --version`
会以 `0xC0000135`（`STATUS_DLL_NOT_FOUND`）失败。因此**仅删除发布包中的 `Packet.dll`
会导致 EasyTier 无法启动**，即使使用 Wintun 模式亦然。

该硬依赖**不是**由某个 pcap/npcap feature 开关引入的（此前本节的表述有误，现予更正）。
已定位到源码级成因：

- `pnet_datalink-0.35.0/src/bindings/winpcap.rs` 中的 `#[link(name = "Packet")]`
  仅由 `#[cfg(windows)]` 门控，**并未**置于任何 `pcap` feature 之后；
- `pnet_datalink` 由 `pnet` 的**默认 `std` feature** 间接引入，而 EasyTier 在
  `easytier/Cargo.toml` 中声明为 `pnet = { version = "0.35.0", features = ["serde"] }`
  （未关闭默认 feature），于是 `Packet` 被无条件链接。

最小复现（已实测）：新建仅依赖 `pnet` 的空 crate，
使用默认 feature 时报 `LNK1181: 无法打开输入文件"Packet.lib"`；
改为 `default-features = false` 后链接成功。

**因此正确的消除路径**是重新编译 EasyTier 并关闭 `pnet` 默认 feature（或避免 `pnet::datalink`）。
在 Windows 上 `pnet::datalink` 仅用于两处降级回退：

- `easytier/src/common/network.rs` 中 `collect_interfaces_windows()` 在
  `network-interface` crate 失败时的回退；
- `easytier/src/tunnel/netfilter/mod.rs` 中 `netfilter::pnet::PnetTun` 在 WinDivert 失败时的回退。

两处均为回退路径，具备可移除性；该改造需要重新构建 EasyTier 二进制，
因此排在后续版本落地，完成后会将构建 commit、参数与 SHA-256 登记入本文件。

### 8.3 处理计划 / Remediation Plan

1. ✅ 已完成：停止捆绑 `Packet.lib`（见 §8.1）；
2. ⏳ 进行中：重新编译 EasyTier（关闭 `pnet` 默认 feature）以移除 `packet.dll` 的启动期
   硬依赖，之后新的 Windows 发布包将不再捆绑 `Packet.dll`，改为在缺失时引导用户自行前往
   https://npcap.com 下载安装（Npcap 官方亦推荐此方式）；
3. 若后续取得 Npcap OEM Redistribution License，将在此处写明"本项目已取得再分发许可"
   （不公开合同细节）。

在上述整改落地前，使用者如需自行构建，请自 https://npcap.com 获取 Npcap 并遵守其许可证。

---

## 9. `minecraft-offline-agent.jar` 内嵌的 Javassist / Javassist in the Offline Agent

该 JAR（794,605 字节，SHA-256
`30AC1A18CC80E505077E5F1EEB21BF2E952947B47FFC5801AD9356E2E7BBBEE2`）共 451 个条目，
其中 443 个属 `javassist/`，另有 3 个 `com/mctier/agent/` 类。

Javassist 采用 MPL 1.1 / LGPL 2.1 / Apache-2.0 三重许可。**MCTier 选择 Apache-2.0 分支。**

```
Javassist 3.29.2-GA
Copyright (C) 1999- Shigeru Chiba and contributors
Licensed under the Apache License, Version 2.0
Source: https://github.com/jboss-javassist/javassist
```

Apache-2.0 全文见 `licenses/LICENSE-Apache-2.0.txt`。

---

## 10. LocalVQE / GGML / 模型权重 / LocalVQE, GGML and Model Weights

> **桌面端已移除**：桌面端不再做任何语音降噪/回声消除处理，改为直接发送未经处理的
> 麦克风原声。原先随前端分发的 Web 版 LocalVQE 资产（`localvqe.wasm`、`localvqe.js`、
> `localvqe-worker.js`、`localvqe-bridge-worklet.js`、`localvqe-pi-v1-49k-f32.gguf`）
> 以及纯 Rust 的 `sonora` APM 依赖均已从仓库与发布物中删除。本节现仅适用于 Android 端。

| 组件 | 平台 | 许可证 | SHA-256 |
| --- | --- | --- | --- |
| `liblocalvqe.so` | Android | Apache-2.0（含 GGML，MIT） | `F89813078AE254854807BF2577F59CA42691CAE6E94C4DDFC01DFE2260EF2B51` |
| `localvqe-pi-v1-49k-f32.gguf` | Android | 模型权重，见下 | `0E0C82A8E9703E818B64DEDD0FC306394CF5BBB59FCEC1CCCA82099D352D0C26` |

- **LocalVQE**：Apache-2.0，https://github.com/localai-org/LocalVQE
  （全文：`licenses/LICENSE-Apache-2.0.txt`）
- **GGML**：MIT，Copyright (c) 2023 Georgi Gerganov，https://github.com/ggerganov/ggml
  （全文：`licenses/LICENSE-MIT.txt`）。`liblocalvqe.so` 中包含 `ggml_*` 符号，即运行时静态包含 GGML。
- **模型权重**：GTCRN 结构，模型来源 https://huggingface.co/LocalAI-io/LocalVQE 。
  其训练数据来自 **ICASSP 2023 Deep Noise Suppression (DNS) Challenge**
  与 **AEC Challenge**（Microsoft，**CC BY 4.0**）。按 CC BY 4.0 要求保留数据集署名：

  ```
  Portions of the training data are derived from the Microsoft DNS Challenge
  and AEC Challenge datasets, licensed under Creative Commons Attribution 4.0
  International (CC BY 4.0).
  https://creativecommons.org/licenses/by/4.0/
  ```

- **安全说明**：Android 端音频增强全程在本地完成，麦克风与播放音频不会被上传。

---

## 11. 应用依赖 / Application Dependencies

以下为主要直接依赖；完整清单可分别用 `npm ls`、`cargo tree`、Gradle 依赖报告生成，
其许可证文本随各自包分发。

**Android（Gradle）**

| 依赖 | 版本 | 许可证 |
| --- | --- | --- |
| `io.github.webrtc-sdk:android` | 144.7559.09 | BSD-3-Clause（The WebRTC project authors） |
| `com.squareup.okhttp3:okhttp` | 4.12.0 | Apache-2.0 |
| `org.nanohttpd:nanohttpd` | 2.3.1 | BSD-3-Clause |
| `com.google.zxing:core` | 3.5.3 | Apache-2.0 |
| `com.journeyapps:zxing-android-embedded` | 4.3.0 | Apache-2.0 |
| `top.yukonga.miuix.kmp:miuix` | 0.8.8 | Apache-2.0 |
| `org.jetbrains.kotlinx:kotlinx-*` | 见 `build.gradle.kts` | Apache-2.0 |
| `androidx.*` / Compose BOM | 见 `build.gradle.kts` | Apache-2.0 |

**桌面端**：Tauri 2（Apache-2.0 / MIT）、React（MIT）、Ant Design（MIT）、
axum / tokio / serde 等 Rust crate（多为 Apache-2.0 / MIT 双许可）。

常用许可证全文集中存放于 `licenses/`：Apache-2.0、MIT、BSD-3-Clause、
GPL-2.0、GPL-3.0、LGPL-3.0、Wintun Prebuilt Binaries License。

---

## 12. 商标与非官方声明 / Trademarks and Non-Affiliation

```
本项目不是官方 Minecraft 产品，未获 Mojang Studios 或 Microsoft 批准、认可、关联或背书。
Minecraft 是 Mojang Synergies AB 及其关联主体的商标。

This project is not an official Minecraft product. It is not approved by or
associated with Mojang Studios or Microsoft. Minecraft is a trademark of
Mojang Synergies AB.
```

Wintun / WireGuard 相关声明见 §7。

---

## 13. 默认服务与元数据披露 / Default Services and Metadata Disclosure

使用**默认**配置时会连接以下由项目方或第三方运营的服务；自建部署可完全避免：

| 服务 | 默认地址 | 服务端可见的元数据 |
| --- | --- | --- |
| 信令服务器 | `wss://mctier.pmhs.top/signaling` | 客户端公网 IP、连接时间、大厅标识、成员数与昵称、客户端版本 |
| EasyTier 节点 | `udp://us01.225284.xyz:11010` | 客户端公网 IP、连接时间、流量特征（作为中继时转发加密流量） |
| 版本检查 | `https://gitee.com/api/v5/repos/peng-minghang/mctier/tags` | 请求发起 IP 与时间（由 Gitee 记录） |

- **用途**：信令用于成员发现与房间管理；EasyTier 节点用于 P2P 打洞与必要时中继；
  版本检查用于提示新版本。
- **保留期限与删除**：项目方自建服务仅保留运行期必要的连接状态，不做长期用户画像；
  如需删除相关记录可通过仓库 issue 或作者联系方式提出。第三方服务（Gitee）的数据
  处理遵循其自身政策。
- **澄清**：应用内"本地数据统计绝不上报网络"仅指**本地使用统计**功能不外发；
  它**不代表**所有功能都不访问网络 —— 组网、信令、版本检查按上表访问对应服务。
- 可在设置中更换为自建信令与自建 EasyTier 节点，从而不接触上述默认服务。

---

## 14. 维护承诺 / Maintenance Commitment

每次升级第三方组件时，MCTier 将同步更新本文件中的：版本号、commit SHA、修改状态、
补丁文件与二进制 SHA-256，并在发布说明中一并记录。