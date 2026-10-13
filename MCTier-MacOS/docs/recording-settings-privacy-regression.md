# 录屏、设置与隐私协议修改记录（2026-10-03）

以下命令从源码仓库根目录执行。保留了工作区原有的夸克升级兼容、后台任务、录屏和远程控制修改，未 reset、checkout 或清除应用数据。

## 完成的行为

- 双端房间小工具每次打开默认选择屏幕录制；入口改为工具箱图标，标题统一为“记录精彩，留住瞬间”。删除录制内容不会发送到大厅的文案。
- 桌面保存后只显示软件顶部通知，移除原来的保存结果面板。保存目录默认为系统用户 Videos 下的 MCTier 文件夹；面板内可以修改、恢复默认。目录写入本机配置，重启及切换大厅后继续使用。开始录制不再逐次选择保存路径。
- 桌面关闭面板提示使用 11px 字体，正常面板宽度下为单行，极窄窗口允许换行以避免溢出。
- Android 保存结果与关闭面板提示均水平居中；移除播放、分享按钮。Android 10+ 发布到 Movies/MCTier 媒体库；Android 8/9 使用公共 Movies/MCTier，并申请该系统版本必需的存储权限、通知媒体扫描。
- Android 所有 Switch 的开启、关闭和禁用状态均使用白色圆球。弹幕选中色勾选背景为固定 18dp × 18dp 圆形。检查更新按钮、选中音色、选择文件夹按钮的图标和文字使用白色；English 下仍显示“简体中文”。
- 双端关于页按实际依赖更新：补充录屏、授权远程控制、本地语音转文字等功能；桌面移除仅 Android 使用的 LocalVQE/GGML 展示，修正 Magic DNS、自动故障转移和“完全隔离”等不准确描述。保留真正使用的 EasyTier、WebRTC、Wintun、WinDivert 及其许可声明。
- 桌面首次使用展示欢迎与四份协议，成功保存同意状态后才挂载主界面；不同意调用退出，保存失败保持门控。设置新增隐私与协议入口。双端启动提示顺序为首次协议确认 → 信令服务器最低版本限制 → Gitee 可选更新 → 夸克赞助（包括其详情）。桌面新手引导和自动进入大厅相应延后。
- 双端首次页和设置中的四份协议均通过独立的大弹窗查看，正文可滚动，底部保留“我已阅读”；关闭阅读弹窗不会自动同意首次使用协议。桌面设置顺序为隐私与协议 → 数据统计 → 配置管理，日志弹窗底部移除重复的关闭按钮。双端首次页和设置读取同一份中英文 `shared/compliance.json`，补充中继、可选夸克后台任务、本地转写、录屏、文件保留、权限撤回和反馈渠道说明。Android 同意前不自动进大厅、不发起启动版本检查或界面夸克启动检查。

## 麦克风共存

Windows 使用 WASAPI shared mode，会话按 ID 独立停止。实际测试同时开启录屏麦克风、系统声音、通话麦克风和语音消息录音，消息产生了编码数据，停止消息或录屏未终止通话麦克风。

Android 新增 `RecordingMicrophone`，通话建立前释放录屏自己的 AudioRecord，通话期间复用 RTC 采集的 PCM；没有通话时录屏可自行采集。语音消息和试听获得优先权，录屏让出物理麦克风并清空积压，结束后恢复。**语音消息/试听期间，录屏的麦克风轨暂时静音，视频与系统声音继续**，以避免 Android 抢占麦克风和重复广播语音消息。队列限制为 100ms，录屏不会积压无限音频。

## 主要文件

桌面功能与启动：
- `src/App.tsx`、`src/services/version/startupUpdates.ts`
- `src/components/ComplianceGate/ComplianceGate.tsx`、`ComplianceGate.css`
- `src/components/MainWindow/MainWindow.tsx`
- `src/components/QuarkSupport/QuarkStartupPrompt.tsx`
- `src/components/SettingsWindow/SettingsWindow.tsx`
- `src/components/AboutWindow/AboutWindow.tsx`
- `src/components/MiniWindow/MiniWindow.tsx`
- `src/components/NativeCapture/NativeCapture.tsx`
- `src/components/RoomTools/RoomTools.tsx`、`ScreenRecording.tsx`、`ScreenRecording.css`
- `src/services/screenRecording.ts`
- `src-tauri/src/lib.rs`
- `src-tauri/src/modules/config_manager.rs`、`screen_recording.rs`
- `src-tauri/src/modules/tauri_commands/settings.rs`

Android（以下源文件位于 `MCTier-Android/app/src/main/java/top/pmh13/mctier/`）：
- `MainActivity.kt`、`MctierRepository.kt`
- `ui/MctierApp.kt`、`StartupVersionStage.kt`、`ScreenRecordingPanel.kt`、`Compliance.kt`、`ComplianceUi.kt`、`QuarkStartupPrompt.kt`
- `recording/RecordingEngine.kt`、`RecordingMicrophone.kt`
- `network/AndroidRtcController.kt`、`VoiceAuditioner.kt`
- `audio/VoiceMessageRecorder.kt`
- `MCTier-Android/app/src/main/AndroidManifest.xml`、`MCTier-Android/app/build.gradle.kts`
- 双端协议来源：`shared/compliance.json`

新增或扩展验证：`StartupVersionStageTest.kt`、`StartupPromptChecks.kt`、`RecordingMicrophoneTest.kt`、`RecordingChecks.kt`、`QuarkMediaChecks.kt`、`PeerUiInstrumentation.kt`、`tests/screen-recording.test.mjs`、`tests/auto-lobby.test.mjs`、`tests/android-security.test.mjs`、`tests/fixtures/recording-check.ts`、`tests/fixtures/ux-check.tsx`、`scripts/build-ux-check.mjs`、`src-tauri/src/modules/screen_recording_test.rs`，以及配置模块内的持久化测试。

## 构建和测试

从实际仓库根目录运行：

```powershell
npm run build
node --test tests/*.test.mjs
cargo check --release --manifest-path src-tauri/Cargo.toml
cargo test --release --manifest-path src-tauri/Cargo.toml --lib --no-run
node scripts/build-recording-check.mjs
node scripts/build-ux-check.mjs
```

Windows 测试使用编译得到的 release 测试可执行文件，复制为 `.artifacts/ux-tests.exe` 并用 Windows SDK mt.exe 嵌入已有 CommonControls 测试 manifest 后执行：

```powershell
& .artifacts/ux-tests.exe modules::config_manager::tests --nocapture
& .artifacts/ux-tests.exe modules::screen_recording::tests --nocapture
& .artifacts/ux-tests.exe quark --nocapture
& .artifacts/ux-tests.exe modules::app_paths::tests --nocapture
& .artifacts/ux-tests.exe modules::screen_recording::integration::real_screen_recording --ignored --exact --nocapture --test-threads=1
& .artifacts/ux-tests.exe modules::screen_recording::integration::real_startup_and_recording_ui --ignored --exact --nocapture --test-threads=1
.\scripts\test-quark-background.ps1 -TestExecutable .artifacts/ux-tests.exe
```

Android 目录运行：

```powershell
.\gradlew.bat :app:assembleDebug :app:assembleDebugAndroidTest :app:testDebugUnitTest --console=plain
.\gradlew.bat :app:testDebugUnitTest --tests "*Quark*" --console=plain
```

结果：
- 桌面 TypeScript/Vite 构建通过；有现有的大 chunk 警告。
- 全部 302 项 Node 测试通过。
- Android 两个 APK 构建通过；项目原有 `jvmSecurityHardeningTest` 运行 83 项 JUnit 测试通过。AGP 的 `testDebugUnitTest` 被项目现有兼容方案禁用，因此日志显示 SKIPPED；`--tests "*Quark*"` 不会限制自定义 JUnitCore 入口，实际仍执行 83 项，包括夸克和新增的启动优先级测试。
- Rust release 编译通过。配置持久化及保存失败回退（15 项）、录屏文件发布（1 项）、夸克逻辑（25 项通过、4 项默认忽略）与旧路径迁移（3 项）通过。两个显式启动的 WebView2 录屏/界面测试均通过。
- 桌面实际调度器测试通过：唯一任务注册/更新、同用户凭据解密、前后台共享统计、同日去重、主动退出及任务删除，测试任务已清理。

MuMu 使用 `C:\Android\sdk\platform-tools\adb.exe -s 192.168.0.103:5555`，覆盖安装 Debug 与 androidTest APK（均使用 `install -r`，没有卸载或清数据）。运行：

```powershell
adb -s 192.168.0.103:5555 shell am instrument -w -e check recording top.pmh13.mctier.test/top.pmh13.mctier.PeerUiInstrumentation
adb -s 192.168.0.103:5555 shell am instrument -w -e check ux top.pmh13.mctier.test/top.pmh13.mctier.PeerUiInstrumentation
adb -s 192.168.0.103:5555 shell am instrument -w -e check quark-buttons top.pmh13.mctier.test/top.pmh13.mctier.PeerUiInstrumentation
adb -s 192.168.0.103:5555 shell am instrument -w -e check quark-work top.pmh13.mctier.test/top.pmh13.mctier.PeerUiInstrumentation
adb -s 192.168.0.103:5555 shell am instrument -w -e check quark-upgrade-seed top.pmh13.mctier.test/top.pmh13.mctier.PeerUiInstrumentation
adb -s 192.168.0.103:5555 install -r MCTier-Android/app/build/outputs/apk/debug/app-debug.apk
# 等待更新广播完成后（本次等了 8 秒）
adb -s 192.168.0.103:5555 shell am instrument -w -e check quark-upgrade-verify top.pmh13.mctier.test/top.pmh13.mctier.PeerUiInstrumentation
```

另外运行 `-e check quark-media` 和 `-e check remote-frame`，官方手机号登录页绘制、截图二维码识别和远程画面显示均通过。

上述检查全部通过。录屏四种声音组合生成可解码 MP4，暂停期间时间戳无大间断，通知栏停止成功；两个带麦克风场景均建立本机 WebRTC 测试呼叫，发送音频包，录制真实 MediaRecorder 语音消息后恢复通话。样式检查包含亮暗主题白色圆球、圆形色标、English 中文选项；协议交互现已由下拉展开改为独立阅读弹窗，复验见文末。夸克按钮在 320dp、360dp 下测量截图中文字边界，水平/垂直居中且点击切换正确。

## 旧登录兼容保留

Android 继续使用 `quark-support.bin` 和 Keystore `mctier-quark-v1`；已有升级广播、兼容字段默认值、失败保留凭证、唯一 WorkManager 和同日去重逻辑保留。使用旧格式的**合成测试账号**执行实际 APK 覆盖安装，验证了加密文件哈希、账号、昵称、Cookie 绝对过期时间、两天支持统计保持一致；未启动 UI 前更新广播已注册唯一任务。测试最后恢复了原状态，没有提交真实夸克转存。

Windows 继续使用 `data_root()/quark-support.bin` 与 `quark-support-v1`；保留 `migrate_legacy_data()`。NSIS `NSIS_HOOK_PREUNINSTALL` 仅在 `$UpdateMode <> 1` 时调用 `--quark-background-uninstall`，覆盖升级不走后台卸载。GUI 和静默服务使用同一加密状态和统计账本，跨进程及实际计划任务测试验证了共享与去重。

## 验证范围和限制

- MuMu 是 Android 12/API 32，未验证真实 Android 8/9 公共相册保存、Android 14 单应用录制或不同厂商/蓝牙设备的声音表现。
- Android 通话验证为同设备两个真实 WebRTC PeerConnection，Windows 验证为实际 WASAPI 并发采集；没有进行跨公网、多种物理设备的人工听感测试。
- 桌面启动顺序/目录 UI 使用真实组件与隔离模拟 IPC；真实目录配置写盘重读由 Rust 测试验证。没有操作用户日常配置的原生选文件夹对话框。
- 未实际运行 Windows NSIS 覆盖安装；安装行为依据脚本检查及现有回归测试。未调用真实夸克账号的云端转存。
- 本机 Cargo debug 目录有 OS 183 错误，改用 release 测试。tabbit 启动器返回 69 且无诊断输出，没有完成该浏览器后端验证；桌面组件改由项目隔离 WebView2 测试运行。
- 详细运行输出保存在 `.artifacts/ux-*.log`。中途发现并修正了编译错误及旧测试的主题/启动状态假设，以上结果指修正后的运行。


## 启动弹窗优先级修正与复验

按最后确认的顺序实现：**首次隐私协议 → 最低版本强制更新 → Gitee 可选更新 → 夸克赞助**。

- 未同意协议时不挂载后续桌面界面，也不发起 Android 启动更新检查。Android 启动检查通过原子标记保证同一进程只启动一次，避免 Activity 重建或同意回调导致重复请求。
- 桌面移除原有 3 秒人为延迟。两端均显式记录更新检查是否结束，不能因 Gitee 响应较慢而先弹赞助。已是最新版、检查失败/超时、当前会话已经检查过，都会放行赞助；有可选更新时先展示更新，用户跳过后继续赞助。
- 赞助仍沿用原有规则：已登录不弹邀请；未登录每次启动可选择跳过或打开详情。最低版本错误到达时隐藏邀请和详情，但保留待处理状态。
- 信令最低版本在连接大厅握手时才获知，并非启动就有独立查询接口。因此实现的是“收到限制立即优先显示”，不是声称未连接前已经验证服务器最低版本。服务器已拒绝的连接不会因关闭提示而获准；返回首页/设置仍可更换服务器。未新增对信令服务器的预探测或修改服务端限制。
- 桌面最低版本弹窗不再等待赞助完成，关闭窗口时销毁旧弹窗，阻止 Escape/遮罩关闭；新手引导也会在较高优先级提示出现时暂时隐藏。

本次实际复跑：

```powershell
npm run build
node --test tests/*.test.mjs
node scripts/build-ux-check.mjs
& .artifacts/ux-tests.exe modules::screen_recording::integration::real_startup_and_recording_ui --ignored --exact --nocapture --test-threads=1
# 在 MCTier-Android 目录
.\gradlew.bat :app:assembleDebug :app:assembleDebugAndroidTest :app:testDebugUnitTest --console=plain
.\gradlew.bat :app:testDebugUnitTest --tests "*Quark*" --console=plain
# 回到仓库根目录；adb 完整路径为 C:\Android\sdk\platform-tools\adb.exe
adb -s 192.168.0.103:5555 install -r MCTier-Android/app/build/outputs/apk/debug/app-debug.apk
adb -s 192.168.0.103:5555 install -r MCTier-Android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb -s 192.168.0.103:5555 shell am instrument -w -e check startup-prompts top.pmh13.mctier.test/top.pmh13.mctier.PeerUiInstrumentation
adb -s 192.168.0.103:5555 shell am instrument -w -e check ux top.pmh13.mctier.test/top.pmh13.mctier.PeerUiInstrumentation
adb -s 192.168.0.103:5555 shell am instrument -w -e check quark-buttons top.pmh13.mctier.test/top.pmh13.mctier.PeerUiInstrumentation
adb -s 192.168.0.103:5555 shell am instrument -w -e check quark-work top.pmh13.mctier.test/top.pmh13.mctier.PeerUiInstrumentation
```

本次结果：桌面构建成功、302 项 Node 回归通过、隔离 WebView2 界面测试通过；Android Debug / AndroidTest APK 构建成功，83 项 JVM 测试通过。MuMu 的 `startup-prompts` 验证真实 Compose 提示宿主在检查未完成时不展示赞助、最低版本优先于可选更新、跳过更新后恢复赞助、迟到的最低版本错误抢占以及已跳过邀请不重复。`ux`、`quark-buttons`、`quark-work` 复验全部通过：包含两种主题设置样式、320dp/360dp 登录按钮居中、旧加密状态/中断写入备份恢复、唯一 WorkManager、离线重试、前后台同日去重及主动退出清理。日志见 `.artifacts/ux-priority-*.log`。

桌面界面测试使用真实协议、可选更新、赞助组件及实际启动检查 Hook；IPC、网络结果、最低版本状态使用隔离夹具。Android 使用内存合成版本/账号界面状态，测试结束恢复；未写入登录凭据或提交云端转存。没有对生产信令服务器制造真实旧版本拒绝，也没有在本次顺序修正后重跑 Windows NSIS 安装。之前的录屏、音频并发和升级兼容实测记录仍保留在前文。本次日志统一为 `.artifacts/ux-priority-*`。

## 协议阅读弹窗与设置布局复验

- 桌面首次欢迎页和设置页共用 `ComplianceDocuments`，四个入口打开 800px 宽（受窗口宽度限制）的阅读弹窗。正文独立滚动，标题与“我已阅读”按钮保持可见。
- Android 首次欢迎页和设置页共用 `ComplianceDocDialog`，使用独立 Compose Dialog，宽度最高 720dp，高度为可用区域的 85%；正文滚动，按钮固定在底部。
- 桌面设置已按隐私与协议、数据统计、配置管理排序；配置管理仍是最后一块。软件运行日志保留右上角关闭入口，底部仅刷新、复制日志、导出日志。
- 本轮 `npm run build` 和 `:app:assembleDebug :app:assembleDebugAndroidTest :app:testDebugUnitTest --console=plain` 均通过；额外运行 `:app:testDebugUnitTest --tests "*Quark*" --console=plain`，自定义 JUnitCore 入口仍为 83 项通过（AGP 任务为既有 SKIPPED）。
- 重建 `node scripts/build-ux-check.mjs` 后运行 `real_startup_and_recording_ui`：1 项通过，覆盖四份协议阅读、阅读不授予同意、关闭与重新打开、亮暗主题设置阅读入口及既有启动顺序。初次失败为固定等待时间短于关闭动画，测试现改为轮询关闭结果；没有为测试移除界面动画。
- MuMu 覆盖安装 Debug 与 AndroidTest APK 后运行 `-e check ux`：通过，检查首次页与设置页共 8 次协议打开/关闭、独立窗口及按钮未被裁切，并保留亮暗主题设置样式检查。没有卸载或清除应用数据。
- 构建及实测日志为 `.artifacts/ux-readers-build.log`、`ux-readers-android.log`、`ux-readers-webview.log`、`ux-readers-mumu.log`。本轮没有重跑完整 Node/Rust 套件、真实 Windows 安装或录屏音频实测；其此前结果见上文。

## v3.9.0 源码提交前验证

- 与 GitHub `v3.8.0`（`dbb7bbd`）核对差异，新增 `CHANGELOG-3.9.0.md`，记录客户端实际实现的变化。
- 协议入口的文字箭头替换为对称 SVG，按钮使用 `align-items: center`；WebView2 在亮暗主题下测量全部四个箭头与按钮的中心，偏差小于 1px，协议阅读及既有启动顺序检查通过。
- `npm run build`、`node --test tests/*.test.mjs`（302 项）、`cargo check --release --manifest-path src-tauri/Cargo.toml` 均通过。Android 再次执行 `:app:assembleDebug :app:assembleDebugAndroidTest :app:testDebugUnitTest --console=plain` 成功，自定义 JVM 入口 83 项通过。
- 待提交 TypeScript 文件单独执行 ESLint：0 错误、181 警告。提交钩子最初因录屏测试夹具的空负载循环失败，补充用途注释后检查通过。全仓 `cargo fmt --check` 仍报告格式差异，包含未修改的既有文件；为避免全仓格式化，本次提交单次跳过本地 hook，未宣称格式检查或 `cargo clippy -- -D warnings` 通过。构建也有既有 chunk/dead-code 等警告。
- 提交清单排除了所有点号目录、构建产物、安装包、日志、缓存、本地配置与凭据；新增忽略根目录 `release-artifacts/`、`binaries/`。保留必要源码、测试、构建配置、依赖锁和项目文档。已跟踪的 Android 原生依赖和表情资源保持原样，本次没有重新上传其内容。
- 详细输出位于本地 `.artifacts/v390-*.log`，这些日志不提交。本次没有重新执行 MuMu、NSIS 安装或真实音频采集测试，之前实测范围见前文。

## 录屏操作入口与停止观看按钮调整

- Android 屏幕观看页红色“停止观看”按钮显式指定白色内容颜色，点击行为保持原样。
- Windows 移除大厅底部录屏悬浮操作条及其 CSS；暂停、继续、停止并保存从房间小工具进入操作。原组件改为不渲染界面的 `ScreenRecordingExitHandler`，继续监听退出事件并完成保存。
- `npm run build`、`node --test tests/screen-recording.test.mjs`（5 项）及 Android `:app:assembleDebug :app:assembleDebugAndroidTest :app:testDebugUnitTest --console=plain` 通过（自定义 JVM 入口 83 项，AGP 任务仍为既有 SKIPPED）。变更的 TypeScript 文件 ESLint 为 0 错误、34 警告，差异空白检查通过；本轮没有进行设备安装和人工界面复验。
- 为保持小范围差异，手动执行检查后单次跳过会整文件自动格式化的本地提交 hook；没有修改永久 hook 配置。构建、测试日志保留在忽略的 `.artifacts/v390-recording-controls-*` 和 `v390-screen-watch-android.log`。
