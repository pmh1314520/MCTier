# Windows 一键打包的本机路径配置

`一键更新MCTier版本.bat` 调用同级的 `update_version.ps1`。这两个入口位于桌面仓库上一级工作区，发布路径读取及产物校验复用本仓库 `scripts/windows-release.ps1`。

## 本次故障

用户日志在调用 Tauri/Rust 编译前就出现 `realpath ... src-tauri/target/release` 的 `ENOENT`，所以没有生成本轮 Windows 便携 EXE 和安装包。安卓是独立步骤，仍可成功。

本机原路径经过两次目录联接：项目的 `target/release` 指向 C 盘旧缓存位置，C 盘兼容联接再指向 D 盘实际缓存。检查时两种 Node 版本均能解析，不能据此断言它一直损坏，也不能确定当时不可用的底层原因。可以确认的是，脚本把这条旧路径链作为打包前置条件，而先前手动构建直接设置了 D 盘路径，没有验证同一条 BAT 执行路径。

## 修复

在 BAT 同级放置 `build-paths.local.json`，示例见 `scripts/build-paths.example.json`。支持以下绝对路径：

- `CargoTargetDirectory`：实际 Rust 缓存根目录（不是其中的 release 子目录）。在运行 `cargo metadata` 前设置，使元数据、构建和导出一致。
- `ReleaseRoot`：发布目录的父目录。已有发布目录保留，新一轮自动使用时间戳后缀。
- `TemporaryDirectory`：本次构建的 TEMP/TMP。
- `GradleUserHome`：可选的已有 Gradle 缓存目录。

显式传入的 `CARGO_TARGET_DIR` / `GRADLE_USER_HOME` 优先于本机配置；未配置时保留原有行为。读取配置不创建或删除目录，拒绝相对路径、文件路径和未知配置项。无效缓存仍中止桌面构建，绝不把旧产物当作成功结果。

本机已配置 Rust 缓存为 `D:\文件盘扩展\MCTierBuildCache-20260914`，发布输出与临时目录也位于 D 盘。保留原目录联接和已有文件，未删除缓存。`build-paths.local.json` 是本机配置，不应上传到源码仓库。

日志现在会保留解析前的 Cargo 缓存路径；失败信息给出需要检查的配置文件和配置项。

## 验证

- `npm test`：206 项通过。
- Windows PowerShell 5.1 回归覆盖可选配置、物理路径读取、相对路径拒绝，以及通过目录联接导出、错误版本、缺失和空产物拒绝。
- 本轮从真实 BAT 入口输入 `3.4.0` 和 `Y` 执行打包，不在调用环境中手动设置 Cargo 路径。完整结果以发布目录的 `windows-build.log`、`android-build.log` 为准。
