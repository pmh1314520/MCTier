# 聊天菜单、表情栏与接收恢复修复（2026-09-17）

## 本次范围与根因

1. 桌面消息右键菜单原先按固定 428 px 高度避让，导致短菜单也远离点击位置；祖先元素变换还可能影响 fixed 坐标。现使用 body portal、真实菜单尺寸和视口边界计算，只在越界时调整。
2. 桌面表情底栏移除标题、发送说明、关闭按钮和底部说明行；分类、批量导入、新增/管理分类集中到一行。网格最小列宽由 66 px 调为 52 px，间距从 7 px 调为 4 px。保留分类横向滚轮和网格滚动，点击输入框/文件按钮收起以及表情按钮切换的行为。
3. 桌面聊天凭据变化调用 stopListening 后，原先仅恢复 SSE，没有恢复历史消息补偿。现恢复整个监听生命周期；45 秒未收到 SSE 数据或保活时主动换连接（每 10 秒检测）；历史补偿继续运行，每 30 秒补读有限历史，以处理不同设备时钟差异。请求按监听代次隔离，旧大厅请求不会进入新大厅。保留近期历史快照的 ID 去重，避免多人历史超过 1,000 条后重复弹消息。
4. 安卓图片/GIF 原先只有最大尺寸约束，小分辨率 GIF 仍按固有尺寸显示。现明确给出最长边 240 dp 的等比显示尺寸，受父容器可用宽度限制；图片、GIF 和视频缩略图不绘制两侧消息尾三角。大厅、私聊复用同一组件。
5. 双端原有下载并发是 8，本次统一为 10。桌面原先一个资源失败就提前终止整批；现在等待其它资源完成并保留缓存。双端持久化下载索引，只补缺失或无效 GIF；失败自动重试，间隔 2、4、8、16、32、60 秒，之后维持 60 秒，直到成功或程序结束。缓存完整时不请求远端。桌面复用单个后台任务，关闭表情栏只移除其进度订阅。

## 主要文件

- `src/components/ChatRoom/ChatRoom.tsx`
- `src/components/ChatRoom/MessageContextMenu.tsx`
- `src/utils/contextMenuPosition.ts`
- `src/components/EmojiPicker/EmojiPicker.tsx`
- `src/components/EmojiPicker/EmojiPicker.css`
- `src/services/chat/P2PChatService.ts`
- `src/services/emoji/emojiLibrary.ts`
- `src-tauri/src/modules/builtin_emoji.rs`
- `MCTier-Android/app/src/main/java/top/pmh13/mctier/MctierRepository.kt`
- `MCTier-Android/app/src/main/java/top/pmh13/mctier/network/BuiltinEmojiCache.kt`
- `MCTier-Android/app/src/main/java/top/pmh13/mctier/ui/MctierApp.kt`

工作区包含此前多轮未提交修改；上述是本次涉及文件，不代表整个 git diff 都由本次产生。

## 验证

- `npm test`：203 项通过。
- `npm run build`：通过（也在 Tauri 打包的 beforeBuildCommand 中运行）。
- `cargo test --lib --no-fail-fast`：213 项通过，1 项原有显式忽略的语音识别集成测试。
- `gradlew.bat :app:jvmSecurityHardeningTest :app:assembleDebug --console=plain`：45 项通过，Debug APK 构建成功。
- `npm run tauri -- build`：通过，Windows x64 EXE 和 NSIS 安装包生成成功。
- 对最终 EXE / APK 执行 `node scripts/verify-bundled-speech.mjs`：通过，双方压缩语音模型仍为 19,800,389 字节。
- 新增 Node 测试：`chat-receive-recovery.test.mjs`、`context-menu-position.test.mjs`、`emoji-download-recovery.test.mjs`。
- 原生下载测试验证 10 个任务同时运行、单项失败不取消其它任务；安卓同时覆盖失败资源恢复、完整缓存无需联网和无效图片拒收。

## 尚未验证的实际环境

聊天恢复测试使用受控传输模拟，证明上述客户端缺陷已修复，不代表已复现用户的全部单向丢消息情形。没有降低聊天签名、会话凭据或虚拟网段校验，也没有修改信令服务器。

本轮 ADB 设备列表为空，未做真机/模拟器长时间双端联机验证。Tabbit 稳定启动器 diagnose 返回 69（路由不可用），未完成真实界面截图验收。自动重试不会消除下载源本身的不可达或限流；这种情况下会显示自动重试状态并继续保留已下载资源。

## 本轮安装包

输出目录：`D:\文件盘扩展\MCTier-发布-v3.4.0-20260917-聊天表情修复`。

- `MCTier_3.4.0_x64-setup.exe`：桌面安装包。
- `MCTier-3.4.0-android-debug.apk`：安卓 Debug APK。
- `MCTier.exe`：桌面程序构建产物；建议使用安装包安装完整运行资源。

未修改版本号、未覆盖此前发布目录、未发布或推送远程。已安装的旧客户端不会自动包含本轮本地代码，需要安装本轮产物再测试。
