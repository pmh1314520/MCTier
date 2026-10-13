# 聊天布局、弹幕与内置语音模型修复

## 根因和行为

- 桌面 `Avatar.css` 的 `.mct-avatar { position: relative }` 与聊天头像规则同优先级，后加载后把头像放回普通布局，占用一行。`ChatRoom.css` 改用 `.chat-message > .message-avatar` 维持绝对定位；昵称正常占 16px 行高，与气泡间距 4px。
- 新版图片可以按 `file` 附件发送。桌面 `MiniWindow.tsx` 丢失附件字段，弹幕旧逻辑只识别 `image`，导致直接显示 `content` 中的 JSON。现保留附件、撤回状态，并由消息预览适配器解释消息类型。安卓采用对应适配器。
- 图片附件通过现有认证附件接口获取，生成有大小限制的预览。GIF 小图保留原始动画数据；较大图片缩略化。视频显示缩略帧和视频标记；语音显示类型、波形装饰及秒数；音频和其它文件显示类型、名称及大小。弹幕不会自动播放声音或视频，也不是文档全文查看器。
- 附件获取或系统解码失败时显示可读的附件卡片，不回退为协议 JSON。真实文本消息中的 JSON 仍保留，避免误伤用户手动发送的内容。
- 桌面媒体下载结束后重新检查大厅、消息撤回和免打扰状态；安卓在下载后检查会话、消息和免打扰状态，并避免把解码结果添加到已关闭或替换的悬浮窗。
- 安卓“语音转文字”菜单项去掉麦克风图标。

## 语音模型交付

`shared/speech-model.json` 固定 SenseVoice INT8 模型版本、长度及 SHA-256。模型和词表共 239,549,735 字节（约 228 MiB）。

- `scripts/prepare-speech-model.mjs` 只在构建阶段准备模型，可用 `MCTIER_SPEECH_MODEL_SOURCE` 指向已有模型目录；先验证本地文件，不合格才由构建机下载固定版本。
- Rust `build.rs` 在编译前验证文件，将大模型以 Windows RCDATA 资源链接进 EXE，词表用 `include_bytes!` 嵌入。便携 EXE 与安装版均携带模型。使用原生资源避免把 228 MiB 数组交给 LLVM 优化导致发布构建内存不足。
- Gradle 在合并 assets 前准备相同模型，打入 `assets/speech-model/`。模型清单同时打包。
- 客户端首次识别只从程序/安装包提取模型，校验后使用。桌面保存到应用缓存目录，安卓保存到 `noBackupFilesDir`。已有文件损坏时从内置副本恢复；无运行时下载兜底。
- 初始化提示改为“正在初始化内置语音模型”。识别继续在本机完成，结果显示在原语音气泡下方。

## 验证

- `npm test`：190 项通过。新增消息类型、GIF 保真、附件获取失败、迟到通知抑制和构建模型缓存修复测试。
- `npm run build`：通过（现有 chunk 大小和动态导入警告）。
- `cargo test --lib --no-fail-fast`：211 项通过，1 项显式忽略。新增内置模型离线提取和损坏缓存恢复测试。
- 单独运行被忽略的 `recognizes_real_chinese_and_english_offline`：通过，中英文音频均输出文本。该测试仅下载测试 WAV，模型使用程序内置副本。
- `gradlew.bat :app:jvmSecurityHardeningTest :app:assembleDebug --console=plain`：41 项通过，APK 构建通过。新增模型 assets 提取、复用、损坏恢复和校验失败测试。
- 直接读取新 APK 的两个模型 assets，长度和 SHA-256 均与清单一致。
- Windows release 优化编译通过；`node scripts/verify-bundled-speech.mjs src-tauri/target/release/mctier.exe` 验证最终 EXE 内模型及词表的完整字节与 SHA-256。原生资源提取路径也重新通过了 Rust 全套测试及中英文推理测试。
- `npm run tauri build -- --bundles nsis --ci`：最终成功生成 NSIS 安装包。

本轮双端产物单独保存于 `D:\文件盘扩展\MCTier-发布-v3.4.0-20260917-内置语音模型`：`MCTier.exe`、`MCTier_3.4.0_x64-setup.exe`、`MCTier_3.4.0_android.apk`（Debug APK）。复制后再次核对 SHA-256。旧发布目录未覆盖。

## 验证边界

本轮 Tabbit 启动失败，ADB 未列出设备，未进行双机大厅收发、系统级弹幕视觉检查或安卓真实录音转写测试。JVM 测试验证的是模型提取和消息转换逻辑，不能代替安卓解码器、JNI 推理与悬浮窗权限的实机验证。预览能力仍受操作系统媒体解码支持限制；Android 8 的旧图片解码路径显示 GIF 首帧，Android 9 及以上使用动画 Drawable。
