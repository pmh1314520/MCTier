# 大厅内的下载目录与 Android 全选

软件设置及大厅动态设置共用下载目录控件。Windows 仍通过 `set_file_share_download_dir` 写入原有全局配置；Android 仍持久化 `fileShareDownloadTreeUri` 并取得 SAF 目录授权。修改或恢复默认后自动保存，后续文件共享下载使用新路径，无需退出大厅或重新组网。

Android 大厅网络设置保存时只合并编辑过的网络字段，避免旧的表单工作副本覆盖刚修改的下载目录、音色及弹幕配置。文件浏览器新增全选/取消全选，范围为当前目录的普通文件，保留单文件选择、清空和批量下载；不递归选择子目录。

验证命令：

```text
npm test
npm run build
npm run tauri -- build --no-bundle --ci
gradlew.bat :app:assembleDebug :app:assembleDebugAndroidTest :app:testDebugUnitTest --console=plain
adb shell am instrument -w -e check shared-file-settings top.pmh13.mctier.test/top.pmh13.mctier.PeerUiInstrumentation
```

桌面测试覆盖目录读取、取消选择、不成功的保存、保存后重新打开、恢复默认，以及不调用网络重启命令。MuMu 专项使用真实 Compose 控件验证 260dp 宽度下的全选、取消、清空、批量下载参数（排除目录），并验证目录显示和恢复默认写入已有偏好存储。该专项不代表实际远程文件传输或系统目录选择器的完整实测。

2026-10-04 验证结果：桌面 315 项测试、前端构建和 Windows Release 编译通过；Android 88 项 JVM 测试、Debug/AndroidTest 构建及 MuMu 专项通过。MuMu 已覆盖安装本次 Debug APK。

云端 Docker 信令服务已升级，容器状态 healthy，原有环境变量、端口、重启策略、网络及数据卷已逐项比较确认保持一致，最低客户端版本仍为 3.8.0。保留了旧镜像及源码、配置和数据备份。正式 WSS 上的创建/加入、密码校验、旧版 3.8.0 不携带 entryMode 的创建/加入，以及 MuMu 实际 Android 信令客户端专项均通过。

桌面实际 `WebRTCClient` 也通过正式 WSS 的六种注册场景，使用真实签名和线上握手；测试替换了本地原生聊天/媒体初始化，未启动完整 VPN。部署前已保留旧镜像、源码、配置及数据备份。

桌面浏览器自动化启动器仍返回退出码 69，无法执行桌面完整点击流程；完整 VPN/游戏联机、语音媒体及远程文件实际传输未在本轮实测。
