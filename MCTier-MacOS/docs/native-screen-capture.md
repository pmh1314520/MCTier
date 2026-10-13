# Windows / macOS 原生屏幕采集与应用界面

2026-09-30：Windows 屏幕共享和远程控制使用 Windows Graphics Capture（WGC）与 Direct3D 11，应用源代码不再调用 `navigator.mediaDevices.getDisplayMedia`。因此启动共享不会打开 WebView2 屏幕选择器，也不会产生其浏览器共享提示条。

2026-10-04：macOS 补齐同构的原生采集后端（CoreGraphics），屏幕共享、录屏与被控端视频在 macOS 上与 Windows 走同一套命令与帧包协议；前端依旧没有浏览器选屏回退。

## 使用方式

- 共享画质、密码设置之后，在 MCTier 明暗主题选择器中明确选择显示器或应用窗口，再点击共享。取消、刷新和目标消失均可重试；不自动选取整个桌面。
- 共享期间不创建独立提示窗口、悬浮状态条或托盘停止入口。手动停止请在 MCTier 软件窗口中点击“停止共享”；主窗口隐藏到托盘后，可通过托盘恢复主窗口再操作。离开大厅或退出应用时自动停止。
- 远程控制复用此选择器和采集链路。当前输入注入按主显示器坐标工作，所以被控端只允许选择主显示器，避免分享副屏或窗口却在主屏误点击。普通共享可选择多显示器中的任一显示器或独立窗口。
- 最低要求为 Windows 10 1903，且显卡驱动支持 D3D11/WGC；Windows 11 可用。不支持时显示应用错误，不回退浏览器选屏。Windows 自身的捕获边框、系统隐私设置和 UAC 属于操作系统 UI，不是浏览器提示，不通过隐蔽捕获方式规避。
- Android 保持原生 MediaProjection 授权和前台服务。接收端沿用 WebRTC SDP/视频轨协议，无需为了 Windows 采集更换服务器或 Android 传输协议。实际双机观看仍须验收。

## 数据流与释放

`Windows Graphics Capture → D3D11 GPU 等比缩放 → 有界二进制 Tauri IPC → WebCodecs 视频轨 → 原有 WebRTC`

优先使用 `MediaStreamTrackGenerator`，减少对不可见 Canvas 刷新的依赖；较旧运行时使用 `canvas.captureStream(0)` 与显式 `requestFrame()` 兼容路径。整个链路没有 JPEG 中间编码、Base64、临时图片文件或监听本地 TCP 端口。

保留 720p / 1080p / 1440p / 2160p，以及 30 / 60 / 120 FPS 与原有码率设置。先在 GPU 缩放，固定两个 WGC 帧槽，每个会话最多一个未处理帧请求；消费端落后时丢弃旧帧。画面静止时每秒重复最新帧，让新观看者无需等目标变化即可看到画面。原生帧率按请求档位限速，WebRTC 编码参数仍限制帧率和码率。IPC 需要读回像素和复制，4K / 120 FPS 不是性能保证；硬件编码、显卡驱动、分辨率及网络均影响实测结果。

用户停止、离开大厅、取消选择、原生源关闭、IPC 出错、主窗口重载都会结束采集。主窗口失联后原生工作线程在 12 秒未收到帧请求时自动释放。迟到的初始化结果和旧选择器响应不会重新激活已结束的会话。原生采集停止后立即禁止远程输入，不等待前端轮询完成。

采集命令验证受信任的应用来源及窗口身份，仅主窗口能够枚举、启动、读取帧和停止采集。WebView2 媒体权限请求直接拒绝；麦克风另由 Rust / WASAPI 按用户操作采集，不再触发浏览器授权。

## macOS（CoreGraphics 后端）

- 实现位于 `src-tauri/src/modules/native_capture/macos.rs`：显示器经 `CGGetActiveDisplayList` + `CGDisplayCreateImage`，应用窗口经 `CGWindowListCopyWindowInfo` + `CGWindowListCreateImage`，帧在复用的 RGBA 位图上下文中按 720p–2160p 档位缩放。帧包为 `[u32 LE 宽][u32 LE 高][RGBA8]`，与 Windows 完全一致，前端的解码、`MediaStreamTrackGenerator` 桥和 WebRTC 路径不区分平台。有单元测试固定「自顶向下」的行序，避免远端看到倒屏。
- 窗口列表只列普通应用窗口：layer 0、在屏、非本进程、非透明、尺寸非空且有归属应用。未授权屏幕录制时系统不给其他应用的窗口标题，此时显示所属应用名。
- 屏幕录制是 TCC 授权门控：未授权时这些 API 静默只返回没有窗口内容的画面，因此枚举前先 `CGPreflightScreenCaptureAccess` 预检，未授权则请求系统弹窗一次并返回错误，提示到「系统设置 › 隐私与安全性 › 屏幕录制」授权；授权后需重启应用才对本进程生效。
- 与 Windows 的差异：帧内不含鼠标光标；共享的窗口被最小化时本次采集结束（报“共享目标已关闭或已不可见”），而非停在最后一帧。被控端输入注入与本机采集活跃状态绑定，规则与 Windows 相同。
- 旧版 CoreGraphics 采集符号在 macOS 15 SDK 起标记为 obsoleted，但运行时仍可用（已在 macOS 26 上验证符号存在）。若将来被系统移除，迁移路径是在同一 `platform` 模块接口后换用 ScreenCaptureKit（macOS 13+）。
- 录屏的系统声音在 macOS 13+ 走 ScreenCaptureKit 音频流（`native_microphone/macos_system_audio.rs`，WASAPI loopback 的对应实现）：48 kHz 单声道 float32、排除本进程声音、原生端积压超过两秒自动停止，与 Windows 共用同一录制管线与包契约。需要屏幕录制授权（与视频同一授权）；macOS 12 及以下仍提示 BlackHole 虚拟设备方案。
- 实机验证需要给宿主终端授予屏幕录制权限后运行 `cargo test --lib native_capture -- --include-ignored`；未授权时这两个测试自行跳过，不会误弹系统对话框。

## 其它浏览器界面

应用 WebView 关闭默认右键菜单、默认脚本弹窗、链接状态栏、浏览器快捷键、自动填充和保存密码提示；新的屏幕采集启动事件取消任何意外浏览器采集请求。聊天 PDF 预览改用本地 PDF.js Canvas 渲染与 MCTier 翻页/缩放/密码控件，不再嵌入浏览器 PDF 工具栏。PDF 解码器、Worker、字体与 CMaps 全部随包，不访问 CDN。文件选择窗口仍是 Windows 文件对话框。

## 验证

- `node --test tests/*.test.mjs`：263 项全部通过，覆盖采集选择/取消、旧响应竞态、二进制边界、帧背压、原生结束通知、WebCodecs 与 Canvas 清理、共享画质/编码、远程会话与 PDF 引擎回归。原生采集 4 项和麦克风授权 3 项测试也全部通过。
- 先在应用根目录运行 `npm run build`，再在 `src-tauri` 目录运行 `cargo check --release --lib` 与 `cargo build --release --bin mctier --features tauri/custom-protocol`。必须在该目录执行，让 `.cargo/config.toml` 的静态 CRT 设置生效；发布 EXE 必须启用 `tauri/custom-protocol`，以嵌入前端资源并使用应用来源，不能依赖开发服务器。常规安装包发布可使用 `npm run tauri build`。
- `cargo test --release --lib native_capture -- --include-ignored --test-threads=1` 含交互式 Windows/D3D11 测试：真实显示器画面、GPU 色序与缩放，以及窗口尺寸变化和关闭；非交互构建机应省略 `--include-ignored`。本机 Rust 测试可执行文件需用 Windows SDK `mt.exe` 嵌入 `build.rs` 中的 Common Controls 清单后运行，否则依赖的 `TaskDialogIndirect` 会使测试进程在进入测试前退出。
- 本次 Tabbit 启动器仍退出失败，未完成真实 WebView2 选择器的视觉操作、最小化后台长时间播放、Android 接收与多显示器硬件组合验收。不能把源码/单机采集测试当成这些场景已通过。
