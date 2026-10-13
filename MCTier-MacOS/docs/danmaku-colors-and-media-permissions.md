# 弹幕颜色与桌面媒体授权 UI

桌面预设色球使用固定可见边框，选中时额外显示外圈和勾号，不依赖白色光晕；白色色球在亮色主题下也可辨认。自定义颜色使用应用 ConfigProvider 主题下的 Ant Design ColorPicker，支持色板、色相和 HEX 输入，不再调用浏览器原生 `input[type=color]`。Android 原有 Compose 取色器继续使用主题配色，预设色球同步增加勾选标记，并在窄屏换行。

随机预览与真实消息使用同一随机颜色函数。每次滚动循环后重新取色，每一轮内部保持一种颜色。旧动画从 HSL 0 度到 360 度实际上首尾相同，且亮色全局文字规则覆盖预览；现在显式设置预览颜色变量和 text-fill，删除无效的颜色动画。

Windows 麦克风已改为 Rust / WASAPI 原生采集，开麦、语音消息、试音和变声试听共用此入口。既不使用浏览器麦克风授权，也不再显示应用授权弹窗。旧 WebView2 允许或拒绝记录不会影响原生采集。Windows 系统隐私设置仍有效；拒绝或设备占用只影响本次打开，用户修复后可以再次尝试，无需重置软件。详见 [原生麦克风](native-microphone.md)。

## 屏幕选择器与共享提示条的后续替换

此前使用的 WebView2 稳定接口无法定制这些浏览器 UI。2026-09-30 已改为 Windows Graphics Capture 原生采集，接入应用选择器与原有 WebRTC。桌面源代码不再调用 `getDisplayMedia`，也不再触发浏览器选屏或共享提示条。共享期间不显示独立提示窗口，用户可在 MCTier 窗口中停止共享，离开大厅时自动停止。

实现、系统要求、性能边界及验证范围见 [Windows 原生屏幕采集](native-screen-capture.md)。用户仍需明确选择共享对象，并可随时停止；没有使用自动选屏或跳过授权的 Chromium 参数。Android 系统录屏授权和前台服务提示保留。当前仍仅传输屏幕视频，不额外采集系统音频。

官方接口：

- https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2permissionrequestedeventargs
- https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2screencapturestartingeventargs

自动化验证覆盖颜色选择、预览循环、原生麦克风桥接和资源释放。此前 WebView2 授权弹窗及其专用测试已随采集方案替换移除。实际界面和跨设备音频听感仍需真机验收。
