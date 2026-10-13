# AMD / NVIDIA 语音降噪适配

桌面设置提供自动、NVIDIA、AMD、系统降噪四种选择，覆盖实时语音和按住录制的语音消息。沿用旧偏好键，升级不清除原有设置。自动模式优先使用用户已选中的受支持虚拟麦克风；找不到指定厂商设备时回退普通麦克风。

AMD 官方产品为 **AMD Noise Suppression**。在 AMD Software: Adrenalin Edition 的“音频和视频”中开启 Noise Suppression，选择输入麦克风及可用的 CPU/GPU 处理方式；MCTier 识别其 **AMD Streaming Audio Device** 音频输入。NVIDIA 识别 Broadcast / RTX Voice。Windows 通过 WASAPI 直接枚举和打开这些虚拟设备；虚拟输入不请求额外的通信音效，普通输入使用通信类别以便驱动应用支持的音效。原生桥接不再具有浏览器采集自带的回声消除；是否降噪、消回声取决于厂商软件和驱动，不能保证所有普通麦克风与之前听感一致。

这是对厂商虚拟音频设备的适配，不是把 AMD 或 NVIDIA SDK 内嵌到 MCTier。AMD 官方页面列出 Ryzen 6000 系列集成显卡及更新产品、Radeon RX 6000 系列桌面显卡及更新产品，以及 Windows 10/11、Adrenalin 22.7.1 起等要求，具体支持取决于硬件和驱动。未安装驱动功能、未启用或设备不支持时，选择 AMD 不会凭空启用硬件降噪。Android 继续使用平台麦克风处理，不提供桌面驱动选项。

来源（2026-09-30 核对）：https://www.amd.com/en/products/software/adrenalin/amd-noise-suppression.html

自动化测试覆盖设备识别、输出设备排除、显式厂商选择、自动优先级、旧设置、设备消失回退、权限拒绝、授权后设备标签出现与旧音轨释放。实际 AMD/NVIDIA 硬件的降噪听感需要对应驱动设备验证。
