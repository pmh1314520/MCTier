# 双端内置小型中文语音模型（2026-09-17）

用户确认接受中文能力取舍后，双端已从 SenseVoice 切换到 sherpa-onnx Zipformer-CTC 中文 INT8 模型。

## 模型与体积

- 来源：https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-small-ctc-zh-int8-2025-04-01
- 固定 revision：`a5f60fe00dcfbaf68fcc1c6b5cf53061e144d6da`。
- `shared/speech-model.json` 固定原始模型及词表的大小、SHA-256，并设定 `maxBundledBytes: 20100000`。
- 当前 Node 构建生成的 gzip 模型约为 19,998,221 字节；词表 13,366 字节；合计约 **20.01 MB**，构建上限为 20,100,000 字节。gzip 实现不同会导致压缩结果略有不同，构建始终验证解压后的固定 SHA-256 和实际压缩体积上限。
- 解压后的模型和词表共 26,355,706 字节（26.36 MB）；20 MB 指随软件分发的模型资源，不是整个程序、解压后磁盘空间或推理内存。
- 不再承诺原 SenseVoice 的五语能力，也不增加标点恢复等额外模型。

## 实现

- `scripts/prepare-speech-model.mjs`：构建时下载/复用已验证的固定模型，gzip level 9 压缩，流式有界解压复验、20 MB 硬上限检查；只移除被替代的生成模型文件，不删除用户聊天数据或旧发布备份。
- 采用 `.gzip` 资产后缀而非 `.gz`。实际打包发现 Android 资产合并器会自动展开 `.gz` 并移除后缀，导致运行时找不到压缩资源；`.gzip` 在 APK 内保留原始压缩字节。
- Windows 仍通过 RCDATA 内置压缩模型；非 Windows 使用压缩数据 `include_bytes!`。Android 将同一压缩模型及词表写入 assets。
- 两端首次转写时从安装包**本地解压**，校验大小/SHA-256 后提交缓存，后续复用。未在每次启动重复解压，也不在运行时下载模型或上传语音。校验不通过时从内置资源修复；损坏/截断/解压超限不提交缓存。
- 两端由 SenseVoice `OfflineRecognizer` 切换至 Zipformer-CTC `OnlineRecognizer`；禁用自动端点重置，按一秒音频块解码，末尾补 0.66 秒静音并调用 input-finished，保留整段文本并处理最后一个窗口。此处 Online 指流式推理接口，不是在线网络服务。
- 结果仍展示在原语音消息下方，没有改回弹窗。

主要文件：`shared/speech-model.json`、`scripts/prepare-speech-model.mjs`、`scripts/verify-bundled-speech.mjs`、`src-tauri/build.rs`、`src-tauri/Cargo.toml`/`Cargo.lock`、`src-tauri/src/modules/speech_transcription.rs`、Android `ui/SpeechModel.kt` / `ui/VoiceMessageTranscriber.kt`、双端相关测试及 `THIRD_PARTY_NOTICES.md`。

## 验证结果

- `npm test`：195 项通过。
- `npm run build`（由 Tauri beforeBuildCommand 执行）：通过。
- `cargo test --lib --no-fail-fast`：212 项通过，1 项真实语音测试默认忽略。
- 单独运行 `cargo test --lib recognizes_real_chinese_offline -- --ignored --nocapture`：通过。从内置压缩模型本地解压，使用实际 Rust/sherpa-onnx 1.13.8 引擎识别上游 `0.wav`、`1.wav`，分别验证结果包含“研究”“金融”；完整输出为：
  - 对我做了介绍那么我想说的是呢大家如果对我的研究感兴趣呢
  - 重点呢想谈三个问题首先呢就是这一轮全球金融动荡的表现
- Android `gradlew.bat clean :app:jvmSecurityHardeningTest :app:assembleDebug --console=plain`：44 项通过，Debug APK 构建成功。
- `npm run tauri -- build`：Windows release EXE 和 NSIS 安装包构建成功。
- `scripts/verify-bundled-speech.mjs` 分别检查实际 EXE 和 APK：压缩模型/词表均通过；APK 模型目录恰好只有预期两项，无旧 ONNX；资源合计 19,800,389 字节。
- 新增回归覆盖：压缩资产离线构建与损坏修复、原始副本清理、硬体积上限、运行时截断 gzip 拒绝、解压超限拒绝、已解压缓存复用与修复。
- 构建仍存在原有 unused/deprecated API 和前端 chunk 体积警告，未为此次模型替换改动无关代码。
- `adb devices` 未发现设备，未执行 Android JNI 真机识别、性能和实际大厅录音联调。Android JVM 测试验证解压/缓存与安全逻辑，不等同于真机推理测试。Linux/macOS 未构建。

## 发布文件

保存于 `D:\文件盘扩展\MCTier-发布-v3.4.0-20260917-小型中文语音模型`，未自动安装、上传或提交 Git。

| 文件 | 字节数 | MiB |
| --- | ---: | ---: |
| MCTier.exe | 93,326,848 | 89.00 |
| MCTier_3.4.0_x64-setup.exe | 259,760,471 | 247.73 |
| MCTier-Android.apk | 121,628,626 | 115.99 |

Windows NSIS 安装包仍内置 WebView2 离线运行时，不能把它的总大小与单纯模型大小混为一谈。版本保持 3.4.0；安卓仍为 versionCode 73、Debug 签名。
