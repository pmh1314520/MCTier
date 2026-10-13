# 实时通话无声诊断（2026-09-30）

## 2026-10-01 现场日志与修复

### 第二次修复：等待 Windows 安装虚拟网卡地址

01:51 的实际运行日志说明第一版没有成功启用探测：EasyTier 输出配置中的 `10.126.126.110` 后约 300 ms，`voice_ice_server` 绑定该 IP 返回 Windows 10049（地址尚不可用）。前端捕获错误后仍继续连接信令；后续只有 `.local` 候选，ICE 再次失败。此前在已就绪网卡上的集成测试漏掉了这个启动时序。

现在后端每 200 ms 重新读取当前 IP 并尝试真实 UDP 绑定，最多等待 15 秒；仅对地址尚不可用重试，其它错误直接返回。等待期间不持有 AppCore / NetworkService 锁。退出大厅、停止 EasyTier 或窗口重载递增 generation，绑定和发布服务也在相同锁内核对 generation，避免待执行任务重新启动已取消的服务。前端等待成功再连信令；超时明确提示重新加入大厅，不再静默继续缺少可用路由的实时通话。

验证：5 项 Rust 测试通过（STUN 协议、socket 回收、精确模拟 10049 后就绪并实际收取 STUN 响应、退出取消、超时与永久错误），271 项前端测试及生产构建通过。真实 WebView2 使用原生麦克风桥接及生产 WebRTCClient 路径，在非默认网卡上双向 connected、收到 RTP 且声音能量非零；仅一端提供可用候选的兼容场景也通过。

核查 Android `AndroidRtcController`：原有标准候选处理、待 SDP 应用后刷新候选队列、onTrack/onAddTrack 接收均兼容，未为本次修复修改 Android 接收协议。上述 WebView2 验证是本机两个 peer，不是 Android 实机测试；未连接 Android 调试设备，Windows–Android 实际通话仍需现场验证。

### 第一版探测服务（保留排查记录）

00:36 的诊断日志确认：Android Offer 已接收，Windows Answer 的音频方向为 `sendrecv`，原生 Realtek 采集正常；但 Windows 本地仅生成两个 `.local` 候选，ICE 持续 `checking` 后连接 `failed`。没有建立实时音频传输，故不是双方语音解码失败。此前移除浏览器麦克风采集后，Chromium 的地址隐私策略限制了网卡枚举，未获得 EasyTier 虚拟地址。

Windows 新增 `voice_ice`：Rust 在当前大厅虚拟 IPv4 上绑定随机 UDP 端口，提供最小 STUN Binding 响应。只回答源 IP 等于自身绑定 IP 的请求，不作为公共 STUN 服务，不中继音频。前端在开始信令连接前取得该地址，WebRTC 的 UDP socket 据此探测虚拟网卡路由，获得标准 `srflx` 候选。没有授予浏览器麦克风权限，也没有修改系统浏览器策略；麦克风保持 Rust/WASAPI。协议、Android 实时接收代码均未改动。

重复初始化复用当前探测端点，换 IP 会替换端点；退出大厅、停止 EasyTier、主窗口重载时回收 socket。地址由后端当前网络服务读取，前端无法指定任意监听地址。第一版探测失败后仍保留现有候选尝试，这一行为已被上方第二次修复替换。

验证：271 项前端测试、前端构建、2 项 Rust 探测协议/生命周期测试通过。真实 WebView2 新配置下强制丢弃所有 host/mDNS 候选，仅允许非默认网卡探测出的地址，双向 RTP 和音频能量正常，选中连接对的两端地址均为该网卡 IP。生产 `WebRTCClient` 协商路径也通过；额外场景只有一端启用新探测、另一端所有候选都不转发，仍通过 ICE 对端反射地址建立双向音频。测试使用本机非默认 VMware 网卡（169.254.52.223），不等于实际 Android 双机或 EasyTier 跨网听感验收。

复现验证命令：构建 Rust 测试 EXE 并按原生麦克风文档嵌入清单，运行 `node scripts/build-audio-webview-check.mjs`，将 `MCTIER_AUDIO_CHECK_INTERFACE` 设为本机非默认 IPv4，再执行忽略的 `webview_native_bridge_and_bidirectional_audio`。完整通话测试入口为 `tests/fixtures/audio-call-check.ts`；构建 fixture 时设置 `MCTIER_AUDIO_CHECK_ONE_SIDED=1` 可验证只更新一端的标准 ICE 行为。

以下保留初始排查记录。

本次用户复现：Windows 与 Android 在同一大厅，双方能收听对方的聊天语音消息，但实时开麦双向无声。读取 `%LOCALAPPDATA%/com.mctier.app/mctier.log` 的 23:19–23:20 会话后，确认三次原生采集均选择 Realtek，AudioContext 为 running、48 kHz，没有采集或播放失败记录。聊天附件经 HTTP 传输，实时通话经 WebRTC 传输；前者正常不能证明后者的 ICE / RTP 已连通。

旧日志没有记录前端的 Offer/Answer、ICE 状态或 RTP 统计，因此无法从这份日志确定用户现场的实时通话根因。暂不修改音量、静音策略、系统权限或防火墙，也不把可疑因素当作已确认故障。

新的 `[AudioPipeline] realtime:` 日志包含：

- `peer-created`、`offer-created/received`、`answer-created/applied`：确定连接是否启动和完成协商。
- `offer/answer/ice-rejected`、`*-error`：区分身份校验、SDP 和候选应用失败。
- `ice-local/received`、`ice-state`、`connection`：检查双方候选地址、EasyTier 虚拟网卡候选与连接状态。
- `waiting`：每个未连接的 peer 最多每十秒一次状态；`no-peers`：没有 peer 时的已知人数、信令状态和开麦状态。
- `rtp`：已连接时每十秒记录收发包数、累计接收音频能量、发送音轨状态、接收播放/静音/音量与输出设备。
- `browser permission denied`：记录被应用拦截的 WebView2 权限种类编号。

诊断命令仍限定主窗口和可信应用来源，单条最长 512 字符。日志不主动记录完整 SDP、ICE 密钥或音频内容。

验证：271 项前端测试及前端构建通过。新增真实 WebView2 集成场景使用生产 `WebRTCClient` 创建连接、生成 Offer/Answer、验证信令身份、排队 ICE 和接收播放，模拟加入时关麦、协商后绑定音轨；双向 RTP 和非零音频能量均通过。信令传输仅在隔离测试内转发，服务器 generation 使用与生产服务器相同的数值注入语义。运行方式：

```text
node scripts/build-audio-webview-check.mjs tests/fixtures/audio-call-check.ts
```

然后按 `native-microphone.md` 运行忽略的 `webview_native_bridge_and_bidirectional_audio` 测试。

另已确认：没有历史浏览器媒体授权的新配置会生成 `.local` 候选，用户旧配置副本能生成真实 IP。关闭 mDNS 的实验参数只能改变地址形式，没有恢复全部网卡枚举，未写入产品配置。该发现不能代替 Windows–Android 实机复现；当前没有连接的 Android 调试设备。

现场下一步：运行带实时诊断的新版，两端加入同一大厅，各开麦说话并保持约二十秒，再读取相同日志文件；不需要重置软件或删除用户配置。
