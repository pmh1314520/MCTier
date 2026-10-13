# 大厅创建与加入校验

手动创建与手动加入使用不同的 `register-v3.entryMode`：

- `create`：名称已占用时直接拒绝，无论输入密码是否与现有大厅相同。
- `join`：先检查大厅存在，再校验密码；不存在时不能创建大厅。
- `auto`：保留已有的开机自动大厅、已接受会话重连及重载行为。

信令服务器在同一把大厅写锁中完成名称检查与创建，避免并发创建同时成功。未携带字段的旧客户端仍沿用原协议行为。

桌面端保存本地组网结果时保持连接表单，等待服务器接受注册和本地会话初始化完成后才切换到大厅。失败时清理连接并显示完整错误。Android 将表单的创建/加入模式传给信令客户端，并在按钮下方显示可换行的错误文本。

## 发布顺序

必须先部署配套的 `MCTier信令服务器` 更新，再发布客户端。新服务端在 `server-challenge` 中声明 `lobbyEntryModes: true`。新客户端连接未升级的服务端时，会提示“信令服务器尚未支持创建/加入校验，请联系服务器管理员升级”，不会悄悄退回混合创建/加入行为。私有信令服务器也需要升级。

配套云端 Docker 服务已于 2026-10-04 部署，最低客户端版本保持 3.8.0，原有配置和数据卷保留，容器健康检查通过。EasyTier 本地组网启动仍早于信令注册；本次保证的是注册成功前不进入大厅页面，拒绝后拆除该连接。

## 回归验证

- 桌面：`npm test`、`npm run build`。覆盖真实 Zustand 状态转换、等待注册、错误回传、重试、取消、旧服务器能力检查和断线恢复。
- 服务端：`cargo test --locked -- --test-threads=1`。新增不存在大厅加入、重复创建、密码校验及同时创建同名大厅的测试。
- Android：`gradlew.bat :app:assembleDebug :app:assembleDebugAndroidTest :app:testDebugUnitTest --console=plain`。项目的单元测试由该任务依赖的 `jvmSecurityHardeningTest` 执行。
- MuMu：启动测试服务器监听 `127.0.0.1:18445`，执行 `adb reverse tcp:18445 tcp:18445`，安装 Debug 与 AndroidTest APK 后执行 `adb shell am instrument -w -e check lobby-entry top.pmh13.mctier.test/top.pmh13.mctier.PeerUiInstrumentation`。

MuMu 专项使用实际 Android 信令客户端与本地服务器，验证六种注册结果，并检查实际错误提示组件在 260dp 宽度下完整可见。回环传输仅存在于测试代码，生产客户端仍要求 WSS。此测试不覆盖完整 VPN/游戏联机，也不代表已验证线上服务器。

部署后另行使用 `adb shell am instrument -w -e check lobby-entry -e server wss://mctier.pmhs.top/signaling top.pmh13.mctier.test/top.pmh13.mctier.PeerUiInstrumentation` 通过相同的六种注册场景，走真实 TLS/WSS，不再使用回环替代传输。独立正式 WSS 测试还验证了旧版 3.8.0 客户端格式（无 entryMode 字段）的创建与加入兼容性。

2026-10-04 本地结果：桌面 314 项测试、服务端 70 项测试、Android JVM 88 项测试均通过；前端构建、Android Debug/AndroidTest 构建及 MuMu 专项通过。Tabbit 自动化启动器返回退出码 69，未能执行桌面浏览器点击验证。MuMu 已通过覆盖安装保留最新 Debug APK，测试服务器与 adb 端口转发已关闭。

桌面 Release 构建也已通过。可用 `npm run tauri -- build --no-bundle --ci` 构建独立程序；当次临时配置仅跳过了已经通过的前端构建步骤，复制测试程序后已校验 SHA-256 一致，未制作新的安装程序。
