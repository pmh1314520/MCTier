# 图片操作与发送按钮主题修复

## 根因与修复

- 图片预览下载按钮只有深色定义；补齐亮色的白底、深色文字及浅绿悬停状态。
- 图片消息右下角下载按钮的亮色规则仍指定半透明深色背景；改为实心白底，避免与图片混色，悬停使用浅绿底与深绿图标。
- 全局 `.anticon` 亮色规则直接指定灰色，导致图标不继承图片操作按钮的前景色；图片查看器及消息图片按钮的图标现在明确继承所在按钮的颜色，关闭按钮悬停时的白色图标也一并修复。
- 全局 `.ant-btn-primary` 规则未排除聊天室发送按钮，会把禁用按钮染绿，与局部灰色图标冲突；全局实底覆盖排除发送按钮，由聊天室管理可用/禁用状态。可用态深绿底白图标，悬停仍是绿底白图标；空输入的禁用态为灰底灰图标。
- 安卓发送按钮同步使用白色图标，并将按钮主色调整至与白色至少 4.5:1 的对比度，保留自定义颜色的色相；不改变其他主色按钮和消息气泡。安卓全屏图片操作已使用动态 `PanelHigh` / `TextPrimary` 调色板，无需另加暗色硬编码。

这些组件供大厅和私聊复用，图片、GIF、图片文件继续共用查看器。

## 验证

- 前端 `npm test`：206 项通过。
- `npm run build`（由 Tauri 构建调用）：通过。
- `npm run tauri -- build`：通过，Windows 主程序、安装包和便携 ZIP 已生成。
- 安卓 `:app:jvmSecurityHardeningTest :app:assembleDebug --console=plain --offline`：47 项测试通过，Debug APK 构建成功。复用了 SHA-256 已验证的本地 sherpa AAR。
- 便携 ZIP 的全部 12 个文件逐项校验 SHA-256，内嵌离线模型验证通过；安装包和 APK 复制后校验 SHA-256。
- 未修改 Rust 逻辑，因此没有重复运行 Rust 单元测试。
- Tabbit `diagnose --task mctier-image-theme` 返回 69（路由不可用），未完成浏览器实景截图或鼠标悬停验收。代码检查和构建通过不代表已进行实际 UI 验收。
- `adb devices` 无设备，未进行安卓真机/模拟器验收。

本次增量修改：`src/App.css`、`src/components/ChatRoom/ChatRoom.css`、`MCTier-Android/app/src/main/java/top/pmh13/mctier/ui/MctierApp.kt`。保留工作区已有修改。

## 本轮产物

`D:\文件盘扩展\MCTier-发布-v3.4.0-20260917-图片按钮修复` 下包含 Windows 便携 ZIP、安装包和安卓 Debug APK。版本号仍为 3.4.0，请退出旧程序后使用此目录的新包，上一轮“聊天室主题修复”目录中的包未改写。
