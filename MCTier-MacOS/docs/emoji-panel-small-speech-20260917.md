# 底部表情栏、安卓缓存恢复与小型 ASR 评估（2026-09-17）

## 本次修改

- 桌面 `ChatRoom` / `EmojiPicker`：移除固定全屏遮罩，面板参与聊天纵向布局，高度不超过聊天区域的 42% / 320 px；消息区可收缩，输入区不被挤压。尺寸变化时跟随最新消息，浏览历史时保留阅读位置。
- 双端：点击输入框或发送文件收起表情栏；切换会话收起；发送表情后保持面板展开，便于连续发送。安卓打开表情时收起键盘，并给面板设置相对高度上限。
- 安卓 `BuiltinEmojiCache`：独立保存经过校验的下载索引；对暂时性网络错误重试三次；一个 GIF 失败不会取消其他任务；展示成功缓存；重启/重试仅补全缺失项，完整缓存无需联网。保留 HTTPS、URL 固定来源、数量/体积/GIF 文件头验证。
- 安卓仓库和 UI：启动时继续未完成下载，下载失败仍展示已完成项，给出具体失败原因和继续下载入口，进度从已有缓存数量开始。
- 增加实际缓存行为回归测试，覆盖部分失败、进程重建后的恢复、完整缓存完全离线复用及 HTML 伪装 GIF 的拒绝。

## 网络调查及边界

在当前 Windows 网络上，目录请求 HTTP 200，解析到 567 个唯一 GIF。并发 HEAD 检查有 566 个成功、1 个超时；成功响应中最大文件为 375,196 字节，未发现超出旧安卓 2 MiB 限制的资源。旧安卓使用 `awaitAll` 且不捕获单任务错误，任何一个错误都会中止整体同步；只有写入完整标记后才显示任何内置表情。这是可复现的容错缺陷，但尚无用户手机上的网络日志，不能断言这就是该设备的唯一失败原因，也不能据此声称手机必须/不必使用特定网络。

## 模型核实

查询 FunASR 官方 README、sherpa-onnx 文档及 Hugging Face 模型树，未找到用户描述的官方 `Paraformer-tiny` 48M、Q4 40–45 MB 发布物。

- sherpa 文档：https://k2-fsa.github.io/sherpa/onnx/pretrained_models/offline-paraformer/paraformer-models.html
- 实际可用小型中英模型：https://huggingface.co/csukuangfj/sherpa-onnx-paraformer-zh-small-2024-03-09
- 其 `model.int8.onnx` 为 81,828,675 字节，约 78.04 MiB，另有词表。公开示例输出没有标点，不能把可选标点恢复模型的能力当作 ASR 自带能力。
- 现有 SenseVoice INT8 为 239,233,841 字节。其量化参数已经是 INT8；尚无证据支持用无损压缩将它缩到 20 MB。

另实际下载并评估了中文小模型：

https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-small-ctc-zh-int8-2025-04-01

固定 revision：`a5f60fe00dcfbaf68fcc1c6b5cf53061e144d6da`。

| 内容 | 实测字节数 |
| --- | ---: |
| 原始 ONNX | 26,342,340 |
| tokens.txt | 13,366 |
| 7z 最大压缩模型 | 19,558,410 |
| gzip 最大压缩模型 | 19,678,731 |
| gzip 模型 + 未压缩词表 | 19,692,097 |

这里使用严格的十进制 20 MB（20,000,000 字节）比较。只说明**打包的模型资源**可以低于 20 MB；解压后的模型、推理引擎和运行内存均不包含在这个指标中。gzip 归档完整性检查通过。

SHA-256：

- ONNX：`68c9c943840f7d9cf3e8a4970ba50f404feb5277f611fa82b7e72267786fa84a`
- tokens：`6fed8c6c248516f38e7faa19404b57413e8ce259f1cbc1fa4aebc86eac32fdfd`
- 实测 gzip：`9a03d99ef66958878df35b4d6f77bf73358edd602366ecdf89f50b3d17c66e84`

使用 Python sherpa-onnx 1.13.3、CPU 两线程执行 `scripts/evaluate-small-speech-model.py`，未修改客户端现有 1.13.8 引擎。上游三段普通话 WAV：

| 样本 | 音频时长 | 本机推理耗时 | 输出 |
| --- | ---: | ---: | --- |
| 0.wav | 5.61 秒 | 0.175 秒 | 对我做了介绍那么我想说的是呢大家如果对我的研究感兴趣呢 |
| 1.wav | 5.15 秒 | 0.155 秒 | 重点呢想谈三个问题首先呢就是这一轮全球金融动荡的表现 |
| 8k.wav | 4.52 秒 | 0.133 秒 | 深入的分析这一次全球金融动荡背后的根源 |

这只是中文样本冒烟测试，不是准确率基准，也不代表手机速度、游戏噪声或口音效果。该候选主打中文，不能承诺现有 SenseVoice 的五语能力。模型替换尚待用户确认语言能力取舍，**双端当前仍使用 SenseVoice**。下载、压缩与评估运行库均位于 `D:\文件盘扩展\MCTierBuildCache-20260914\speech-small-evaluation`。

## 验证

- `npm test`：193 项通过。
- `npm run build`：通过，有现有分包体积及混合导入警告。
- `gradlew.bat :app:jvmSecurityHardeningTest :app:assembleDebug --console=plain`：43 项通过，Debug APK 构建成功。
- 没有修改 Rust 后端，未为此轮重复运行 Rust 测试或完整 Windows 安装包打包。
- Tabbit 稳定启动器的 `diagnose` / `tabs` 均退出 1，无可用浏览器验证会话；`adb devices` 无设备。尚未完成双端视觉/触屏实测及手机真实网络验证，不将构建成功等同于这些测试通过。
