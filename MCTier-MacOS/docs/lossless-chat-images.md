# 双端图片发送无损优化

Windows 和 Android 共用 `shared/image-optimizer` 的 Rust 代码，在发送前后台优化本地副本，原文件不修改。默认只接受体积更小的结果，不缩放、不降低清晰度、不丢弃透明度或动画。内置表情继续只发 ID。

| 格式 | 处理方式 |
| --- | --- |
| JPEG | libjpeg-turbo 在 DCT 系数层单次优化基线 Huffman 编码；不重新量化，保留 EXIF 方向与 ICC 标记 |
| PNG/APNG | oxipng 无损重编码，保留附加块、16 位精度和动画；无颜色配置/元数据的普通 8 位 PNG 也尝试精确无损 WebP，择小使用 |
| GIF | 逐帧重新压缩 LZW 索引，保留调色板、透明索引、帧位置、延时、清除方式、循环次数和扩展块 |
| WebP | 精确无损模式重新编码像素，保留透明像素下的 RGB；动画逐帧处理，保留时间、位置、混合/清除控制、循环次数与元数据 |

“无损”不等于每张图都能显著变小，也不代表数学意义上的最小文件。已经高度压缩的图片会原样发送，不使用有损编码冒充无损。

覆盖桌面粘贴、拖拽、图片文件附件、自定义表情，以及 Android 选图/文件附件、自定义表情和直接图片发送路径。压缩后大小仍超过 2 MiB 的图片通过现有图片附件通道发送；来源上限为 64 MiB。实际格式改变时更新附件名称、MIME 和大小，收发双方显示同一内容。

最多两个独立编码工作线程，繁忙时直接返回原图，不排队。调用方最多等待编码结果 250 ms（另有线程调度、内存复制与文件 IO 开销）；超时直接发送原图，后台编码线程结束前仍占用名额，不会因连发无限增加线程。PNG 使用快速预设，内部搜索预算 150 ms；GIF/WebP 在帧间检查预算，单次编解码不可强行中断。

超过 8 MiB 的来源不重编码；JPEG 最多 1600 万像素、PNG 最多 400 万像素、精确 WebP 编码最多 100 万像素，动画累计最多 400 万像素/128 帧。超限、超时、格式不支持或压缩失败时保留原图。此策略优先发送延迟与无损，不能承诺每张图片均变小或达到全局最小体积。

## 构建与验证

桌面构建增加 CMake 要求（需加入 PATH）；Rust 会编译内置 libjpeg-turbo/libwebp。Android 打包的 `prepareImageOptimizer` 任务从源码编译并自动将 JNI 库放入 APK，要求 Rust、`aarch64-linux-android` target、`cargo-ndk`、NDK 和 CMake。也可从仓库根目录运行 `node scripts/build-image-optimizer.mjs`。当前 APK 的 ABI 为 arm64-v8a。

核心测试：在 `shared/image-optimizer` 执行 `cargo test --release`。测试逐像素比较静态图片，检查 16 位 PNG、APNG、GIF/WebP 动画帧、透明度、播放时序和 JPEG 元数据，并检查损坏文件与尺寸上限的回退。

性能复测：`cargo run --release --example benchmark` 使用明确标注的合成图片，分别统计五次运行的中位数和最大耗时；命令末尾也可传入实际图片路径。合成图片结果不能代表所有照片或 Android 设备。

前端集成测试覆盖优化后的实际发送字节、发送方预览、2 MiB 以上附件回退、私聊接收人、准备失败及内置 ID 表情回归。Android 常规 JVM 测试不能执行 Android ELF/JNI；JNI 的实机运行仍需 Android 设备验证。
