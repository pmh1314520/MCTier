# 屏幕录制与 Android 后台自动支持

## 功能

- Android 登录夸克后注册唯一 WorkManager 周期任务，主动退出时取消；验证失效时阻止转存并保留凭据供用户处理。每 12 小时由系统安排一次有网络条件的检查，按北京时间自然日去重；软件启动和恢复时补充检查。
- Worker 与界面使用同一个 `QuarkSupport` 实例、互斥锁及 AndroidKeyStore 加密状态文件，不复制账号凭证到 WorkManager 数据库。成功次数、支持天数、执行结果即时共享并持久化。
- 退出请求先写持久化停止标记并取消网络调用，再清除凭证；即使进程在退出期间被终止，下次也不会恢复旧登录。
- 双端大厅工具新增“屏幕录制”，支持分辨率上限、30/60 FPS、码率、系统声音和麦克风开关、暂停/恢复、停止保存。
- 双端默认画质为 1080p、60 FPS、16 Mbps，标题统一为“记录精彩，留住瞬间”。Windows 开始按钮铺满容器并居中，保存目录可配置并持久化，保存后通过顶部通知提示路径。
- Windows 复用分享屏幕选择器，支持显示器/窗口、开始倒计时。优先 MP4 H.264/AAC，旧 WebView2 根据编码能力回退；录像分块写盘，退出时先完成保存。临时文件不覆盖既有录像。
- Android 复用系统画面选择器，输出 MP4 H.264/AAC 至公共 Movies/MCTier；Android 8/9 按需申请存储权限并通知媒体库更新，用户可通过相册查看或分享。录屏使用系统要求的前台通知，可在通知中暂停/停止；关闭工具面板不停止录制。录屏与本机屏幕共享/被控互斥。

## 系统边界

- WorkManager 不是常驻服务，系统可能因省电、待机、无网络或厂商后台限制延后任务，不能保证每天准时运行。系统设置中“强行停止”后需要用户重新启动应用。普通进程回收后由系统重新调度，重启后系统恢复已注册任务。
- Android 14 及以上的系统选择器可能提供单应用捕获；旧版本只提供整屏。系统录屏授权不可跳过，受保护画面或禁止音频捕获的应用可能黑屏/无声。
- 录制分辨率不会放大原始画面；帧率和编码能力受设备限制。扬声器与麦克风同时开启可能产生回声。
- 测试不等于覆盖所有驱动、手机系统及真实夸克账号。下面的后台转存测试使用合成账号与模拟 HTTP 响应，没有产生真实网盘转存或计佣。

## 2026-10-02 验证

- 前端 Node 回归：301 项通过，含录屏取消、重复停止、编码器末尾数据、磁盘错误、分块写入、批量音频背压和传输抖动下的连续音频；TypeScript/Vite 发布构建通过。
- Rust：261 项通过，9 项交互测试默认跳过；另外单独执行真实 WebView2 录屏测试，整屏无声/系统声/麦克风/双声音、系统音中断再恢复、窗口录制全部通过。
- Windows 实际 MP4 经 ffprobe 检查 H.264/AAC、时长和尺寸，并以 FFmpeg 解码。1080p/60 FPS/16 Mbps 下每 180 ms 人为阻塞界面线程 40 ms，系统音、麦克风、双声音均未出现 Worklet 缓冲缺帧；双声音连续录制约 42 秒并暂停/恢复。系统音和双声音测试音轨按 5 ms 分段检查，去除起止边缘后无静音断点。
- Android JVM：78 项通过，含画面尺寸与 PCM 混音；APK 和 instrumentation 构建通过。
- MuMu（Android 12 / API 32）实际录屏：新标题、60 FPS/16 Mbps 默认值、四种声音组合、取消授权、暂停/恢复、暂停期间退到后台、通知栏停止保存通过；生成 MP4 可解码，内部音频录到了测试信号。
- MuMu WorkManager：唯一持久任务、重复注册保持唯一、加密凭证/统计冷重载、离线重试、前后台并发只提交一次并共享成功记录、退出取消、冷重载保持退出通过。
- 额外尝试 Android Release 构建时，仓库既有 POI/Log4j 的 AWT/可选依赖缺失导致 R8 失败，生成表情资产的任务与 lint model 之间也缺少依赖声明。本次提供的是已实测的 Debug APK，不能将其标为正式 Release 包。

## 录屏音频与界面修复

- Windows 录音断续不是视频码率不足。原来音频 IPC 每次只返回 20 ms，高清画面传输和界面繁忙时往返时间会超过 20 ms，音频来不及送入 Worklet；语音低延迟队列还会丢弃积压 PCM。
- 录屏采用独立模式：原生 PCM 按 20 ms 的整数倍批量传输（单次最多 200 ms），不再沿用语聊丢弃旧数据的策略；录屏 Worklet 预缓冲 300 ms，固定容量 600 ms，原生端积压超过两秒停止并报错，内存有界。语聊保留原来的低延迟行为。Windows 编码音频设置为 192 kbps。
- 真实整屏压力测试曾检出双音源短缺，增加录屏预缓冲后重测通过；只检查“存在音轨”无法发现这类断音，不能替代连续性检查。
- 录屏下拉菜单现在挂在弹窗内部，避免被全局高层级弹窗遮挡。浅色危险按钮只绘制一层背景，图标和文字保持透明背景。
- 修正 Explorer 可执行文件目录，由 Windows 目录启动。使用真实保存录像的路径授权调用打开位置命令，并在资源管理器中确认进入录像所在目录。

## 重跑

前端：`npm test`、`npm run build`。

Android 目录：`gradlew.bat :app:assembleDebug :app:assembleDebugAndroidTest :app:testDebugUnitTest`。本仓库由 `jvmSecurityHardeningTest` 执行 JVM 测试，AGP 的同名测试任务跳过是既有配置。

安装主 APK 与测试 APK 后，分别运行：

```text
adb shell am instrument -w -e check quark-work top.pmh13.mctier.test/top.pmh13.mctier.PeerUiInstrumentation
adb shell am instrument -w -e check recording top.pmh13.mctier.test/top.pmh13.mctier.PeerUiInstrumentation
```

`quark-work` 测试要求测试设备没有真实夸克登录，使用隔离状态文件与模拟响应；`recording` 会在本机产生测试录像并播放低音量测试信号。

Windows：先 `node scripts/build-recording-check.mjs`，再从 `src-tauri` 编译 Rust 测试；运行 `modules::screen_recording::integration::real_screen_recording --ignored --exact --nocapture --test-threads=1`。测试打开独立 WebView2 窗口并短暂捕获本机画面与音频，结果保存在 `.artifacts/recording-check`。
