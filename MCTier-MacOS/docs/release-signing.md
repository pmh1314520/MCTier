# 一键打包签名

`一键更新MCTier版本.bat` 通过原位置的 `update_version.ps1` 入口调用仓库内的 `scripts/update-version.ps1`，Windows 构建通过 Tauri 的 `signCommand` 为应用程序、NSIS 卸载程序和安装程序签名；Android 使用 `assembleSignedRelease`。发布前必须完成签名校验，失败不会退回未签名或旧产物。

Tauri 打包结束后可能恢复 Cargo 目录中的未签名主程序；脚本会再次检查独立 EXE，必要时补签，再校验并导出，避免安装包已签名而独立 EXE 未签名。

Windows PowerShell 5.1 会把原生命令写入标准错误流的文字包装成错误记录；keytool 导出成功时也会写这种提示。签名工具调用单独捕获输出，以进程退出码和证书指纹判断成功，避免 `NativeCommandError` 误停，同时保持整个构建的严格错误策略。错误别名、错误密码、指纹不匹配及校验失败仍会中止发布。

## 本机免费方案

- Windows 使用当前用户证书库 `Cert:\CurrentUser\My` 中的持久化自签名代码签名证书，SHA-256 摘要和 RFC 3161 时间戳。证书有效期五年，脚本不自动轮换或把它加入受信任根。
- **自签名不等于公众信任，不保证消除 SmartScreen 蓝色警告或“未知发布者”。** 本地完整性校验只在明确的 SelfSigned 模式下接受“不受信任根”错误；被篡改、其他签名者或缺少时间戳都会失败。不能宣称本机生成的证书获得了 Microsoft 认证。
- Android 沿用旧 APK 的同一把私钥，实际产物通过 v1/v2/v3 签名校验（最低 Android 8）。原来发出的 APK 实际有 Android Debug v2 签名，缺少 v1/JAR 签名文件。为保留覆盖升级，本方案明确继续使用该身份，不偷偷换新密钥；部分商店或厂商仍可能限制调试证书、侧载或风险应用，不能保证所有手机放行。
- 新发行 APK 的 `debuggable=false`，不包含 debugImplementation；`signedRelease` 不混淆、不收缩，保持此前非混淆打包方式。原有启用 R8 的 `release` 配置仍保留，目前其 POI/AWT/OSGi 可选依赖问题未解决，不能声称该混淆构建通过。

本机配置为仓库根目录的 `signing.local.json`（已忽略），Android 私钥备份到 `%USERPROFILE%\.mctier-signing\android-upgrade.keystore`，Windows 公钥证书保存为同目录的 `MCTier-publisher.cer`。Windows 私钥仍在当前用户证书库；公钥 CER 不能用于签名。

完成本机初始化后，可双击工作区中的 BAT，输入版本并选择打包。需要分开构建时：

```powershell
.\一键更新MCTier版本.bat -Targets Android
.\一键更新MCTier版本.bat -Targets Windows
# 失败续跑，不再次增加同版本 Android versionCode：
.\一键更新MCTier版本.bat -KeepAndroidVersionCode
```

上述 BAT 位于开发工作区的仓库外层。仅克隆本仓库时，可直接在仓库根目录运行 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/update-version.ps1`，同样支持 `-Targets` 和 `-KeepAndroidVersionCode` 参数。

## 新机器首次配置

应优先迁移原 `signing.local.json`、Android 私钥和 Windows 带私钥的 PFX；不要重新生成 Android 密钥。更新 JSON 中的本机路径，导入 Windows PFX 到当前用户“个人”证书库。保管好 Android 私钥及 PFX 密码，丢失后无法用原身份签名。

首次从以前的 Debug 发布流程接入免费方案时，在桌面应用仓库运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-free-signing.ps1 -PreviousApk "D:\已发布的版本\MCTier-Android.apk"
```

脚本比对旧 APK 与原 `%USERPROFILE%\.android\debug.keystore` 的证书 SHA-256，匹配后备份 Android 密钥并创建 Windows 自签名证书。已有配置不会覆盖；旧私钥缺失或指纹不符则中止。证书不放进仓库，密码不写进命令行或构建日志。

若已有独立 Android 发布密钥，按 `scripts/signing.example.json` 配置路径、别名和既有 APK 指纹，将 `UseLegacyDebugKey` 设为 false，并在本机进程中提供配置指定的两个密码环境变量。Gradle 仅从环境读取密码，一键脚本结束时恢复调用前的变量值。

## 将来使用受信任 Windows 证书

导入或安装签名服务商提供的代码签名证书及私钥提供程序后，填写其 SHA-1 指纹，将 `Windows.Mode` 改为 `Trusted`，并设置 `StoreLocation` 和时间戳 URL。此时要求证书链验证通过；即便受信任证书，SmartScreen 仍会考虑文件信誉等因素。云签名方案若不暴露本机证书私钥接口，需要单独适配。

## 验证

```powershell
node --test tests/windows-release.test.mjs tests/release-signing.test.mjs
# 可选：在 Windows PowerShell 5.1 中验证真实 keytool 导出、错误别名和指纹拒绝；
# 实际签名临时 EXE，校验签名者、时间戳，并验证篡改会被拒绝：
$env:MCTIER_SIGNING_TEST_CONFIG = (Resolve-Path signing.local.json).Path
node --test tests/release-signing.test.mjs
```

测试临时文件会清理，既有发布目录和用户数据不会删除。APK 使用 `apksigner verify --verbose --print-certs` 校验签名，并由 aapt2 拒绝 debuggable 的发布包；固定指纹确保不会因重装 SDK 自动生成另一把调试密钥而破坏升级。

发布检查另用 `apksigner verify --min-sdk-version 23 --max-sdk-version 23 --verbose --print-certs` 强制验证 v1 及其签名者。默认校验会根据应用 minSdk 跳过不需要的签名方案，因此默认输出的 `v1: false` 不等于 APK 内一定没有 v1 签名。这个额外检查不会降低应用的最低系统要求。旧包缺少 v1 本身不代表它在 Android 8 及以上无法安装；定位手机上的“没有签名文件”仍需核对实际下载文件和系统安装日志。
