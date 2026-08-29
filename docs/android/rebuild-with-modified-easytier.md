# 使用自行修改的 EasyTier 重新构建 MCTier Android 版

本文档说明如何获取 EasyTier 源码、应用（或替换）MCTier 所作的修改、编译 `.so`、
替换 APK 内的 EasyTier 动态库、重新打包、签名、安装，并验证修改确实生效。

本文档用于履行 LGPL-3.0 对“使用者可用自行修改的库版本重新构建并运行程序”的要求。
按本文档操作**不需要** MCTier 作者的额外许可。

---

## 0. 组件位置与许可证

| 库 | APK 内路径 | 源码目录 | 许可证 |
| --- | --- | --- | --- |
| `libeasytier_ffi.so` | `lib/arm64-v8a/libeasytier_ffi.so` | `easytier-contrib/easytier-ffi` | LGPL-3.0 |
| `libeasytier_android_jni.so` | `lib/arm64-v8a/libeasytier_android_jni.so` | `easytier-contrib/easytier-android-jni` | LGPL-3.0 |

仓库内源路径：`MCTier-Android/app/src/main/jniLibs/<abi>/`

`libeasytier_android_jni.so` 动态链接 `libeasytier_ffi.so`；Android 侧由
`MCTier-Android/app/src/main/java/com/easytier/jni/EasyTierJNI.kt` 通过 JNI 调用。

---

## 1. 环境准备

- Rust 工具链（rustup + cargo），版本需满足 EasyTier `rust-version` 要求
- Android NDK r26（如 `26.1.10909125`），并设置 `ANDROID_NDK_ROOT`
- LLVM（提供 `libclang.dll`），设置 `LIBCLANG_PATH`
- JDK 17 与 Android SDK（用于重新打包 APK）
- `protoc`（EasyTier 构建 proto 时需要）

```powershell
rustup target add aarch64-linux-android
```

---

## 2. 获取 EasyTier 源码

MCTier 当前 Android 版使用的基线为 **EasyTier v2.6.0**
（commit `79b562cdc9f1dc3f52195a47a02cf83542c225ab`）。

```powershell
git clone https://github.com/EasyTier/EasyTier.git EasyTier-main
cd EasyTier-main
git checkout 79b562cdc9f1dc3f52195a47a02cf83542c225ab
```

---

## 3. 应用 MCTier 的修改

MCTier 对 EasyTier 所作的完整修改以补丁形式提供：

```powershell
git apply --check ..\MCTier桌面应用\patches\easytier-2.6.0-mctier-android.patch
git apply         ..\MCTier桌面应用\patches\easytier-2.6.0-mctier-android.patch
```

校验补丁完整性（可选）：

```powershell
Get-FileHash ..\MCTier桌面应用\patches\easytier-2.6.0-mctier-android.patch -Algorithm SHA256
# 预期: A9563F1798C86EF7DC123F6037568C37771CD3B464F4100CDA8EE94D9F2E951A
```

补丁涉及 22 个文件（21 个修改 + 1 个新增 `easytier-contrib/easytier-android-jni/build.rs`），
逐项目的见 `THIRD_PARTY_NOTICES.md` §5。

**如果你想使用自己的修改**：跳过本节，或在应用补丁后继续按需修改源码。
LGPL-3.0 允许你自由修改 EasyTier 部分。

---

## 4. 编译 `.so`

推荐直接使用仓库提供的脚本（会自动配置 NDK 交叉编译环境变量）：

```powershell
cd MCTier桌面应用\MCTier-Android
.\scripts\build-easytier-jni.ps1 -EasyTierRoot <你的 EasyTier 源码目录> -Abis arm64-v8a
```

脚本会依次构建 `easytier-ffi` 与 `easytier-android-jni`，并把产物复制到
`app/src/main/jniLibs/<abi>/`。

手动构建等价命令：

```powershell
cd <EasyTier 源码目录>\easytier-contrib\easytier-ffi
cargo build --target aarch64-linux-android --release
cd ..\easytier-android-jni
cargo build --target aarch64-linux-android --release
```

产物位于 `<EasyTier 源码目录>\target\aarch64-linux-android\release\`。

---

## 5. 替换 `.so` 的两种方式

### 方式 A：从源码重新构建 APK（推荐）

```powershell
# 1) 把新编译的 .so 覆盖到 jniLibs
Copy-Item -Force <target>\release\libeasytier_ffi.so         MCTier-Android\app\src\main\jniLibs\arm64-v8a\
Copy-Item -Force <target>\release\libeasytier_android_jni.so MCTier-Android\app\src\main\jniLibs\arm64-v8a\

# 2) 构建 APK
cd MCTier-Android
.\gradlew assembleRelease
```

产物：`app/build/outputs/apk/release/`

### 方式 B：直接替换已发布 APK 内的 `.so`

适用于只想替换库、不重建整个应用的场景。

```powershell
# 1) 解包
mkdir apk-work; cd apk-work
unzip ..\MCTier-Android.apk -d extracted

# 2) 替换库
Copy-Item -Force <你的>\libeasytier_ffi.so         extracted\lib\arm64-v8a\
Copy-Item -Force <你的>\libeasytier_android_jni.so extracted\lib\arm64-v8a\

# 3) 重新打包（注意：需删除原签名）
Remove-Item -Recurse -Force extracted\META-INF\*.RSA, extracted\META-INF\*.SF, extracted\META-INF\*.MF -ErrorAction SilentlyContinue
cd extracted; zip -r ..\MCTier-unsigned.apk .; cd ..

# 4) 对齐
zipalign -p -f 4 MCTier-unsigned.apk MCTier-aligned.apk
```

> `.so` 必须放在 `lib/<abi>/` 且保持文件名不变，否则 `System.loadLibrary` 无法加载。

---

## 6. 签名与安装

Android 要求 APK 必须签名。你可以使用自己的调试或自建密钥（无需 MCTier 官方密钥）：

```powershell
# 生成自用密钥（一次即可）
keytool -genkeypair -v -keystore my-release.jks -keyalg RSA -keysize 2048 `
  -validity 10000 -alias my-key

# 签名
apksigner sign --ks my-release.jks --ks-key-alias my-key `
  --out MCTier-resigned.apk MCTier-aligned.apk

# 校验签名
apksigner verify --verbose MCTier-resigned.apk

# 安装（自签名与官方签名不同，需先卸载官方版本）
adb uninstall top.pmh13.mctier
adb install MCTier-resigned.apk
```

> 说明：使用自签名 APK 会导致与官方签名版本无法直接覆盖安装，这是 Android 平台的
> 签名机制要求，并非 MCTier 施加的额外限制。应用内不含签名校验或完整性校验来
> 阻止加载自行编译的 EasyTier 库。

---

## 7. 验证修改后的 EasyTier 已实际生效

任选其一：

1. **日志验证**：EasyTier JNI 库通过 `android_logger` 输出日志。
   ```powershell
   adb logcat -s EasyTier easytier RustStdoutStderr
   ```
   在你的修改中加入一条独有日志（例如在 `easytier-contrib/easytier-ffi/src/lib.rs`
   的导出函数入口打印自定义标记），启动网络后确认该标记出现。

2. **版本号验证**：修改 `easytier/Cargo.toml` 的 `version`，重新编译后在应用内
   查看 EasyTier 版本相关输出是否随之变化。

3. **文件校验**：确认设备上加载的库与你编译的产物一致。
   ```powershell
   adb shell run-as top.pmh13.mctier ls -l /data/app/*/top.pmh13.mctier*/lib/arm64
   ```
   或对比本地编译产物与 APK 内 `lib/arm64-v8a/*.so` 的 SHA-256。

4. **行为验证**：在修改中改变某个可观察行为（如 `set_tun_fd` 的错误信息文案），
   触发对应路径后检查输出是否为你的版本。

---

## 8. 参考

- EasyTier 上游：https://github.com/EasyTier/EasyTier
- 组件版本 / commit / 修改状态：`../../THIRD_PARTY_NOTICES.md`
- LGPL-3.0 全文：`../../LICENSE-LGPL-3.0.txt`
- GPL-3.0 全文：`../../LICENSE-GPL-3.0.txt`