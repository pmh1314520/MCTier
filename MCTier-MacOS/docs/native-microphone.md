# Windows 原生麦克风

Windows 的开麦、语音消息、设备试音与变声试听统一使用 Rust / WASAPI。麦克风采集不经过 WebView2，因此没有浏览器或 MCTier 麦克风授权弹窗，也不受旧版网页权限记录影响。Windows 系统麦克风隐私开关和系统使用指示仍然有效；系统禁止访问、设备断开或被独占时显示错误，用户解决后可直接再次操作。

只枚举设备不会开始采集。开麦、按住录音或开始试音才打开设备；关麦、取消录音、停止试音、离开大厅以及退出应用通过音轨停止释放设备。主窗口重载会清理全部原生麦克风会话。设备失效会结束音轨并通知上层停止通话/录音/试音，避免界面继续显示正在录音。原生工作线程在五秒没有读取请求后释放设备。

数据链路：`WASAPI 共享模式 → 48 kHz 单声道 float32 → 二进制 Tauri IPC → AudioWorklet → MediaStream → 原有 WebRTC / MediaRecorder / 变声器`。浏览器仍承担播放、编码和传输，不承担 Windows 麦克风采集。录音按原方案使用 16 kbps Opus；网络协议无需修改，Android 继续使用其原生录音与系统权限流程。

每包 20 ms，每会话最多一个待处理的 IPC 读取；原生缓冲与音频线程环形缓冲各上限 100 ms，消息端口最多三包在途，音频线程消费后才补充。慢消费不累积无限延迟，欠载补静音。WASAPI 静音标记允许返回空指针，读取逻辑显式处理这一情况。PCM 不写临时文件、不转 Base64、不开放本地端口。最多同时四个采集会话，命令只接受主窗口的应用来源。

输入设备使用带 `wasapi:` 前缀的系统 endpoint ID。空值、`default` 和旧浏览器设备 ID 均使用系统常规默认麦克风（`eConsole`）。`communications` 才选择默认通信麦克风（`eCommunications`）；设备列表显示默认设备的实际名称，两个默认端点不同时提供独立的通信设备选项。旧浏览器设备 ID 无法可靠对应系统 endpoint，需要指定硬件时在语音设置重新选择。NVIDIA Broadcast、RTX Voice 和 AMD Streaming Audio Device 通过原生名称识别。普通输入请求 Windows 通信类别音效，虚拟降噪输入采用媒体类别避免再请求通信处理。驱动未提供 AEC/降噪时不能保证与浏览器内置 DSP 等效；使用扬声器通话、蓝牙设备以及厂商降噪听感需要硬件验收。

Windows 原生打开失败不会回退 `getUserMedia`。其它桌面平台保留原浏览器采集分支。此前 WebView2 自定义授权组件已移除，原浏览器媒体请求统一拒绝以避免意外浏览器弹窗。设置中的分类改为「重置软件」；重置按钮继续只清理 WebView 数据并重启，保留应用配置文件，符合此前确认的行为。

验证命令：`node --test tests/*.test.mjs`、`npm run build`；在 `src-tauri` 目录执行 `cargo test --release --lib --features tauri/custom-protocol native_microphone --no-run`。原生交互测试 `default_device_captures_pcm_and_releases_on_repeated_stop` 默认忽略，仅在有麦克风的 Windows 上用 `--include-ignored --test-threads=1` 运行，短暂读取两轮音频并释放，不保存或发送采集内容。测试 EXE 若缺少 Common Controls 清单，需按 [屏幕采集说明](native-screen-capture.md) 嵌入清单。

2026-09-30 无声问题排查：测试机常规默认输入为 Realtek 麦克风阵列，通信默认输入为 Voicemeeter Out B3。此前把「系统默认」映射到通信端点，读取到全零 PCM。改为常规默认后，两轮真实采集均收到非零样本，测试断言采集端点等于枚举得到的常规默认端点。麦克风桥接与试音主动恢复 AudioContext，恢复失败或超时会释放设备并报错。播放错误写入 `mctier.log` 的 `[AudioPipeline]` 记录；已保存输出失效时尝试回退默认输出，扬声器切换及试音失败不再提示成功。

本次验证：270 项前端测试、前端构建及 2 项原生麦克风测试通过。运行 `node scripts/build-audio-webview-check.mjs` 后，可执行忽略的 Rust 测试 `webview_native_bridge_and_bidirectional_audio`：它在真实 WebView2、应用 CSP 和媒体权限策略下，经生产代码的二进制 IPC / Worklet 桥接、双向本地 WebRTC、`WebRTCClient` 接收播放路径验证非零音频和 RTP 包。信令及应用 Store 使用隔离测试数据，不连接真实大厅。新配置及用户配置的临时副本均验证了 Realtek 输出；未保存或发送真实麦克风录音。Worklet 保持独立本地资源，避免 data URL 遭 CSP 拦截。

2026-10-01 的现场诊断已确认实时通话停在 ICE checking 后失败；原生采集没有触发浏览器媒体授权，Chromium 只提供 mDNS 地址且未枚举虚拟网卡。已添加 Rust 本机虚拟网卡 STUN 探测，详见 [实时通话诊断](realtime-voice-diagnostics.md)。仍保留原生采集和浏览器采集拒绝策略。Windows 与 Android 双机听感、长时间后台通话和所有驱动组合仍需实机验证，不能以本地双向测试代替跨设备验收。

修复版 Windows EXE 已完成 release 构建（2026-09-30 23:02，202,032,640 字节），位于 `src-tauri/target/release/mctier.exe`。
