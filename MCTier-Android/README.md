# MCTier Android

Native Android client for MCTier, built with Gradle, Jetpack Compose, and Miuix.

## Build APK

```powershell
.\gradlew.bat :app:assembleDebug
```

Output:

```text
app\build\outputs\apk\debug\app-debug.apk
```

## Build EasyTier JNI libraries

The Android app already includes the EasyTier JNI bridge classes and will load:

- `libeasytier_ffi.so`
- `libeasytier_android_jni.so`

Prerequisites:

- Rust + rustup
- Android NDK, for example `C:\Android\sdk\ndk\26.1.10909125`
- LLVM for Windows. `LIBCLANG_PATH` must point to the directory containing `libclang.dll`.

Build and copy those native libraries from the bundled `EasyTier-main` source:

```powershell
.\scripts\build-easytier-jni.ps1
```

By default the script builds `arm64-v8a`. To build more ABIs:

```powershell
.\scripts\build-easytier-jni.ps1 -Abis arm64-v8a,armeabi-v7a,x86_64
```

The libraries are copied into:

```text
app\src\main\jniLibs\<abi>\
```
