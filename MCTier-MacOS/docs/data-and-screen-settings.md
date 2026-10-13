# 用户数据与屏幕分享设置

Windows 的用户数据统一保存在 `%LOCALAPPDATA%\com.mctier.app`：

- `mctier_config.json`：应用配置。
- `mctier.log`：运行日志；设置中的查看、打开、导出日志均使用这里。
- `EBWebView`：WebView 权限、网页本地存储和浏览缓存。
- `chat-attachments`、`speech-models`、表情和头像缓存等也在此目录下。

升级后首次启动会合并原来的 `%APPDATA%\MCTier`、`%LOCALAPPDATA%\MCTier`，以及旧的应用配置目录。新目录已有的同名文件优先保留，旧版本归档至 `legacy-migration`，不会覆盖现有配置。文件复制完成并落盘后才清理旧文件；旧目录仅在变空后删除。迁移失败时保留未迁移的数据，显示错误，并写入 `migration-error.log`。

CMD 查看实时日志：

```cmd
powershell -NoProfile -Command "Get-Content -LiteralPath \"$env:LOCALAPPDATA\com.mctier.app\mctier.log\" -Encoding UTF8 -Tail 100 -Wait"
```

安装组件仍由安装程序管理；用户主动下载或导出的文件保存到所选位置。Android 的配置和缓存由系统管理，位于应用自身的沙盒目录，不使用 Windows 的 Local/Roaming 路径。

## 两端屏幕分享

开始分享前可选择以下上限，并记住上一次成功使用的选择：

| 项目 | 档位 |
| --- | --- |
| 分辨率 | 720p、1080p、2K（1440p）、4K（2160p） |
| 帧率 | 30、60、120 FPS |
| 码率 | 自动推荐，或 4、8、16、32、64 Mbps |

默认 1080p / 30 FPS / 自动推荐（4 Mbps）。自动码率以 30 FPS 的 720p / 1080p / 2K / 4K 分别对应 2 / 4 / 8 / 16 Mbps，再按帧率倍数调整，最高 64 Mbps。低配设备、较慢上行网络建议 720p / 30 FPS。

按原画面比例缩小，不放大较小的源画面；横竖屏均按长短边约束。Android 调整屏幕方向或采集窗口大小时保留帧率设置。转发端不会使用自己的分享偏好限制别人的视频。实际分辨率、帧率和码率由采集设备、编码器、网络与 WebRTC 自适应共同决定，高档位不是性能保证。

## 权限重置

设置分类现为「重置软件」，使用重置箭头图标。此功能用于界面数据恢复，原生麦克风不依赖它。「一键重置并重启」清理 `EBWebView`，包括网页本地存储、浏览缓存及权限记录。应用配置文件保留，因此不是完整的恢复出厂设置。Android 使用系统麦克风授权流程，不执行桌面端的 WebView2 重置。
