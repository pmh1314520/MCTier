# Android 登录白屏与远控黑屏回归记录（2026-10-02）

## 已复现的原因

手机号表单已经使用 PC User-Agent 和 `display=pc`。MuMu 的实际 WebView 尺寸为 864×720 px（288×240 CSS px），但滚动 Compose Dialog 中的 WebView 使用 `WRAP_CONTENT`，包装页 `height:100%` 导致 body 和 iframe 的实际高度均为 0。官方脚本与验证码组件加载成功，用户仍只能看到白框。将 iframe 改为明确的 240 CSS px 后，官方手机号、短信验证码、获取验证码及登录按钮均可见。

远控页面把 AndroidView 工厂创建的 SurfaceViewRenderer 写入 Compose state，再用该 state 作为 DisposableEffect 的 key。工厂更新 state 后，effect 可以在旧 key 下捕获刚创建的 renderer；下一次重组销毁旧 effect 时将仍在显示的 renderer 释放。MuMu 使用正常绿色 I420 视频帧也能复现黑屏，日志为 `Dropping frame - Not initialized or already released`。现由 AndroidView 的 update 绑定视频轨道、onRelease 解绑并释放 EGL，避免将渲染器生命期绑定到 state 重组。

Windows 远控恢复使用与普通屏幕分享一致的 MediaStreamTrackGenerator / 原生帧桥接，删除此前缺乏实测依据的强制 Canvas 分支。`remote` 仍用于原生输入授权，不改变视频来源。

二维码以自然模块尺寸生成，移除额外外边距与固定 480 px 画布造成的多余空白，保留扫描需要的四模块静区及 8dp 圆角。仪器测试对实际截图进行 ZXing 解码，防止仅缩边导致无法识别。

## 验证方法

Android 测试使用实际生产 Composable、原生 WebRTC 与系统 WebView。测试不发送短信、不填写或提交真实账号凭证。

```powershell
cd MCTier-Android
.\gradlew.bat :app:assembleDebug :app:assembleDebugAndroidTest :app:testDebugUnitTest
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell am instrument -w -e check quark-media top.pmh13.mctier.test/top.pmh13.mctier.PeerUiInstrumentation
adb shell am instrument -w -e check remote-frame top.pmh13.mctier.test/top.pmh13.mctier.PeerUiInstrumentation
```

`quark-media` 检查官方登录按钮实际绘制及二维码截图解码；`remote-frame` 两次进入/退出真实远控页面，发送绿色视频，检查截图中心像素，并覆盖视频到达后的自动横屏。截图写入应用外部 files/media-checks 目录。

完整 Windows → Android 测试：仓库根目录运行 `node scripts/check-remote-android.mjs`，执行 `adb reverse tcp:47839 tcp:47839`，启动 Rust ignored test `modules::quark_webview_test::remote_android_video`，同时启动 Android instrumentation `-e check remote-live`。Rust 测试在独立、隐藏的 WebView2 中加载生产 RemoteControlService/nativeCapture，实际采集 Windows 主屏幕；Android 使用生产 RemoteControlController 和远控 UI。只有信令在本机测试服务器转发，输入注入被替换为计数器，避免移动桌面鼠标。报告在 `.artifacts/remote-video-check`。

实际 MuMu 测试已通过：Windows 编码 16 帧，Android 解码 10 帧、收到 37167 字节视频，截图视频区域检测到 175 种量化颜色，输入通道收到 6 个事件。该结果验证了屏幕采集、WebRTC 编解码、视频显示与输入通道，不代表所有手机/GPU/网络组合，也不包含真实短信账号登录。

Windows 测试 EXE 如果因缺少 Common Controls v6 manifest 在启动前退出，可给单独复制的测试 EXE 嵌入此 manifest；不修改产品 manifest。结束后关闭测试桥并移除 `adb reverse tcp:47839`。
