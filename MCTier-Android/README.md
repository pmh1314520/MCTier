# MCTier Android 版

MCTier 的原生 Android 客户端，使用 Kotlin、Jetpack Compose 和 Miuix 构建。通过 Android VPN 服务接入虚拟局域网，并提供大厅、聊天、文件共享等功能。

## 安装与使用

- 系统要求：Android 8.0（API 26）及以上。
- 当前 APK 配置面向 `arm64-v8a`（64 位 ARM）设备；其他架构需补齐原生依赖并调整构建配置。
- 如项目发布页提供 Android APK，可下载后按提示安装，并允许相应来源安装应用。

首次创建或加入大厅，需要同意系统 VPN 连接请求。MCTier 使用 VPN 接口创建虚拟网络，不需要 root；它可能与其他 VPN 应用互斥。

语音需要麦克风权限；屏幕共享或录屏需要系统屏幕捕获授权。通知权限有助于显示前台服务状态。请按实际使用的功能授予权限。

## 构建环境

- JDK 17。
- Android SDK，包含 API 36 平台及构建所需工具。
- Android Studio（可选，推荐用于安装 SDK 和调试）。
- 使用项目自带的 Gradle Wrapper，无需单独安装 Gradle。

在 Android Studio 中打开本目录，或通过 `ANDROID_HOME` / 本目录的 `local.properties` 配置 SDK 路径。个人环境配置文件不要提交到仓库。

## 构建 APK

以下命令在 `MCTier-Android/` 目录执行。

Windows PowerShell：

```powershell
.\gradlew.bat :app:assembleDebug
```

Linux / macOS：

```bash
bash ./gradlew :app:assembleDebug
```

调试 APK 位于 `app/build/outputs/apk/debug/app-debug.apk`。调试签名只用于开发测试，不应作为正式发布签名。连接已开启 USB 调试的设备后，也可直接安装：

```powershell
.\gradlew.bat :app:installDebug
```

## EasyTier 原生库

应用通过 JNI 调用 EasyTier，需要 `libeasytier_ffi.so` 和 `libeasytier_android_jni.so`，存放在 `app/src/main/jniLibs/<abi>/`。仓库已提供所需架构的库时，普通 APK 构建不必重新编译。

### 在 Windows 上重新构建 JNI 库

准备 Rust / rustup、Android NDK 和 LLVM。通过 `ANDROID_NDK_ROOT` 或 `ANDROID_NDK_HOME` 指定 NDK；`LIBCLANG_PATH` 应指向含有 `libclang.dll` 的目录。

EasyTier 源码必须包含本项目使用的 `easytier-ffi`、`easytier-android-jni` 两个 crate 和匹配的锁文件，不要用未经确认的上游最新版替换。通过参数指定源码目录：

```powershell
.\scripts\build-easytier-jni.ps1 -EasyTierRoot "<EasyTier源码目录>"
```

默认构建 `arm64-v8a`，也可选择其他 ABI：

```powershell
.\scripts\build-easytier-jni.ps1 -EasyTierRoot "<EasyTier源码目录>" -Abis arm64-v8a,armeabi-v7a,x86_64
```

脚本复制产物到对应的 `jniLibs` 目录，并输出源码提交和 SHA-256。构建更多 EasyTier ABI **不等于** APK 已支持这些架构：还需调整 `app/build.gradle.kts` 的 `abiFilters`，补齐 LocalVQE 等其他原生依赖。

该脚本使用 Windows NDK 工具链，不是 Linux / macOS 原生库构建脚本。APK 的 Gradle 构建本身可在这些系统上执行。

## 正式发布与签名

通过环境变量配置正式签名：

| 环境变量 | 含义 |
| --- | --- |
| `MCTIER_ANDROID_STORE_FILE` | 密钥库文件路径 |
| `MCTIER_ANDROID_STORE_PASSWORD` | 密钥库密码 |
| `MCTIER_ANDROID_KEY_ALIAS` | 签名密钥别名 |
| `MCTIER_ANDROID_KEY_PASSWORD` | 签名密钥密码 |

在安全环境中配置后，使用现有的分发构建类型：

```powershell
.\gradlew.bat :app:assembleSignedRelease
```

产物位于 `app/build/outputs/apk/signedRelease/`。`signedRelease` 与开启 R8 的 `release` 配置不同，不应未经测试随意替换发布流程。未配置密钥库时，不要把未签名产物当作可直接安装的正式 APK。

密钥库、密码和个人 SDK 路径均不要提交到仓库。

## 常见问题

- **安装失败**：检查 Android 版本、CPU 架构和安装来源权限；遇到签名不一致时，先备份已有数据再处理。
- **无法创建或加入大厅**：确认 VPN 授权未取消、没有其他 VPN 占用，同时检查网络和服务状态。
- **后台断线**：检查前台服务通知和省电策略，必要时允许后台运行；设置因手机厂商而异。
- **语音无声或录屏失败**：检查麦克风 / 屏幕捕获权限，以及是否被其他应用占用。
- **找不到 SDK、NDK 或 libclang**：检查对应环境变量；只构建 APK 时通常不需要重新构建 JNI。

反馈时请附手机型号、Android 版本、应用版本和脱敏日志，不要公开大厅密码、令牌或签名密钥。

## 源码与许可

- `app/src/main/`：应用源码与资源。
- `app/src/main/jniLibs/`：按 ABI 分类的原生库。
- `scripts/`：构建辅助脚本。

项目许可和第三方组件说明见仓库根目录的 `LICENSE` 与 `THIRD_PARTY_NOTICES.md`。
