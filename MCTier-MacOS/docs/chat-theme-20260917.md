# 聊天主题与安卓表情尺寸修复

## 根因

- 桌面标签栏、搜索栏使用了没有亮色定义的 `--panel-bg`，回退为深色；录音提示硬编码深色。
- 表情栏的亮色覆盖只改变部分按钮背景，主操作仍保留白字。旧规则的优先级、亮度滤镜和多处覆盖令普通、悬停、选中状态不一致。
- 安卓主色实底按钮、文件/语音/文本气泡曾混用 `TextPrimary`、固定白色和固定深绿字色；它们只依赖页面明暗，未依据用户自定义填充色选择文字颜色。Material 选中容器、弹层面也未全部指定应用调色板。
- 两端嵌入式 PPT/压缩包预览只在加载时读取主题，已打开的预览不能同步切换。
- 安卓此前放大图片/GIF 到最长边 240 dp，过于占用聊天视口。

## 修改

- 桌面：补齐标签栏、搜索、私聊列表、录音提示、浅色自己消息气泡、语音识别结果、播放按钮、文件预览工具按钮、文件加载状态、工作表标题和禁用发送按钮。
- 表情栏：将多套互相覆盖的 CSS 整理为统一的深浅色变量；分别配套背景、正文、次要文字、选中、悬停、危险操作和焦点色。保留紧凑底栏、分类滚动和表情管理功能。
- 安卓：加入纯 Kotlin 对比度计算，填充按钮和自己的消息气泡根据主色选择黑/白文字；浅色面上的强调文字自动调整亮度以保持 4.5:1 对比度。Material 弹层与选中容器使用随主题更新的 Panel/PanelHigh。选中分类、表情按钮、发送、搜索、滚动到底部及语音/音频/文件/文本共用对应文字色。链接用可读正文色与下划线辨识。
- 安卓图片、GIF、图片文件继续共用 `ChatImageBubble`，最长边从 240 dp 改为 180 dp，保留原始比例和无三角样式；点击全屏查看不变。
- 两端文件预览追加独立主题更新消息，不重载文档、不重置滚动位置，延迟加载的旧主题不能覆盖较新的设置。

文档纸张、幻灯片原图、视频与图片灯箱仍保留其内容本身的颜色；界面控件使用主题配色。

## 本次涉及文件

- `src/components/ChatRoom/ChatRoom.css`
- `src/components/EmojiPicker/EmojiPicker.css`
- `src/components/ChatRoom/LocalFilePreview.tsx`
- `shared/file-preview/viewer.js`（双端生成的预览资源同步更新）
- `MCTier-Android/app/src/main/java/top/pmh13/mctier/ui/MctierApp.kt`
- `MCTier-Android/app/src/main/java/top/pmh13/mctier/ui/ThemeContrast.kt`
- `MCTier-Android/app/src/main/java/top/pmh13/mctier/ui/VoiceMessagePlayer.kt`
- `MCTier-Android/app/src/main/java/top/pmh13/mctier/ui/LocalFilePreview.kt`
- `MCTier-Android/app/build.gradle.kts`
- `tests/chat-theme-contrast.test.mjs`
- `MCTier-Android/app/src/test/java/top/pmh13/mctier/ui/ThemeContrastTest.kt`

## 验证边界

- `npm test`：206 项通过。
- `npm run build`：通过；`npm run tauri -- build`：通过，Windows x64 安装包生成成功。
- 安卓 `:app:jvmSecurityHardeningTest :app:assembleDebug --console=plain`：47 项通过、APK 构建成功。
- 配色测试直接读取表情栏 CSS 色值验证常态、悬停、选中、危险操作下的文字对比度；安卓覆盖默认绿、黑、白、红、蓝、黄、灰等自定义颜色和深→浅切换。
- 文件预览消息测试验证已经打开的预览可连续切换明暗、拒绝非父窗口的主题消息、忽略延迟的过时初始主题。
- 未进行实际 UI 截图或鼠标悬停验收：Tabbit `diagnose` 返回 69（路由不可用），ADB 设备列表为空。单元测试和构建不能替代真实界面验收，因此不声称所有设备和状态均已肉眼验证。

工作区包含此前尚未提交的修改；未撤销它们，未更改版本号、发布远程或推送源码。本轮产物需重新安装后才会生效。

## 安装包

目录：`D:\文件盘扩展\MCTier-发布-v3.4.0-20260917-聊天室主题修复`。

- `MCTier_3.4.0_x64-setup.exe`：Windows 安装包。
- `MCTier-3.4.0-android-debug.apk`：安卓 Debug APK。
