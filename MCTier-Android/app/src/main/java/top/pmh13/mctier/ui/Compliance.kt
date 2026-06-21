package top.pmh13.mctier.ui

import android.content.Context

/**
 * 合规相关：首次启动同意状态存储 + 隐私政策/用户协议/权限用途说明文案。
 * 说明：这些文本为产品内可见的合规告知内容，作为源码内置，便于在首启弹窗与设置中随时查看。
 * 本文档为模板性质，正式上线前请结合实际运营主体、联系方式与业务由法律专业人士最终审定。
 */
object ConsentStore {
    private const val PREF = "mctier_compliance"
    private const val KEY_AGREED = "agreed_v1"

    fun isAgreed(ctx: Context): Boolean =
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE).getBoolean(KEY_AGREED, false)

    fun setAgreed(ctx: Context, agreed: Boolean) {
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit().putBoolean(KEY_AGREED, agreed).apply()
    }
}

object ComplianceTexts {
    /** 隐私政策（摘要 + 主要条款） */
    fun privacyPolicy(): String = L(
        """MCTier 隐私政策

生效日期：2026年6月

MCTier（以下简称"本应用"）尊重并保护用户个人信息。本政策说明我们如何收集、使用、存储和保护你的信息。请在使用前仔细阅读，使用即表示你已理解并同意本政策。

一、我们收集的信息
1. 设备标识信息：为给你在虚拟局域网中分配稳定且唯一的虚拟 IP，本应用会在你同意后读取设备的 ANDROID_ID。若你不同意或读取失败，将改用本地随机生成、可通过卸载重置的标识，不影响核心功能。
2. 你主动提供的信息：玩家昵称、大厅名称与密码等，由你自行输入，用于建立和加入组网大厅。
3. 通信内容：聊天文字与图片、语音、共享文件、屏幕画面等，采用点对点（P2P）方式在成员设备之间直接传输，本应用与默认信令服务器不留存这些内容。
4. 必要的网络与运行信息：为建立连接所需的网络状态、连接节点地址、运行日志（仅存于你本机，用于排障）。

二、设备权限与用途
本应用仅在实现对应功能时申请并使用以下权限，且均可由你在系统设置中关闭：
- 麦克风：语音通话、变声试听；
- 相机：扫描大厅二维码；
- 屏幕录制（MediaProjection）：当你主动同意被远程控制或主动共享屏幕时，采集并发送你的屏幕画面；
- 无障碍服务：仅当你接受远程控制时，用于接收对方的点击/滑动指令并在本机执行；
- 悬浮窗：显示消息弹幕；
- 通知：前台服务与消息提醒；
- 安装未知应用、忽略电池优化：用于应用更新与后台保活，均需你手动授权。

三、信息的使用与共享
我们仅将上述信息用于实现你所使用的功能。除为完成组网/通信所必需的成员间直接传输外，我们不会向第三方出售或提供你的个人信息，法律法规另有规定或经你同意的除外。

四、信息的存储与安全
1. 通信内容采用成员间直连传输，建议在不可信网络下谨慎使用；我们采取合理的技术措施保护信息安全。
2. 本机日志、缓存仅存于你的设备，卸载应用即清除。

五、你的权利
你有权查阅、更正、删除你的个人信息，并可随时在系统设置中撤回权限授权或卸载本应用。卸载后本机存储的标识与数据将被清除。

六、未成年人保护
本应用包含社交与实时通信功能，若你是未成年人，请在监护人指导下使用。我们不会刻意向未成年人收集超出必要范围的信息。

七、政策变更与联系方式
本政策可能更新，重大变更将通过应用内提示告知。如对个人信息处理有疑问，可通过应用内或官网公布的联系方式与我们联系。""",
        """MCTier Privacy Policy

Effective: June 2026

MCTier ("the App") respects and protects your personal information. This policy explains what we collect, how we use, store and protect it. Please read it before use; using the App means you have understood and agreed to it.

1. Information we collect
1.1 Device identifier: To assign you a stable, unique virtual IP in the virtual LAN, the App reads the device ANDROID_ID after you consent. If you decline or it is unavailable, a locally generated random ID (resettable by reinstalling) is used instead, without affecting core features.
1.2 Information you provide: nickname, lobby name and password you enter, used to create/join lobbies.
1.3 Communication content: chat text and images, voice, shared files and screen frames are transmitted peer-to-peer (P2P) directly between members' devices; the App and the default signaling server do not retain such content.
1.4 Necessary network/runtime info: network state, node addresses and local logs (kept only on your device for troubleshooting).

2. Permissions and purposes
The App requests the following permissions only when the related feature is used, and all can be disabled in system settings:
- Microphone: voice chat and voice-changer audition;
- Camera: scanning lobby QR codes;
- Screen capture (MediaProjection): captures and sends your screen only when you agree to be remotely controlled or actively share your screen;
- Accessibility service: only when you accept remote control, to receive and execute the other party's tap/swipe input on your device;
- Overlay: to show message danmaku;
- Notifications: foreground service and message alerts;
- Install unknown apps / ignore battery optimization: for app updates and background keep-alive, both require your manual authorization.

3. Use and sharing
We use the above information solely to provide the features you use. Except for the direct member-to-member transmission required to complete networking/communication, we do not sell or provide your personal information to third parties, unless required by law or with your consent.

4. Storage and security
4.1 Communication content is transmitted directly between members; use with caution on untrusted networks. We take reasonable measures to protect information security.
4.2 Local logs and caches are stored only on your device and are removed when you uninstall the App.

5. Your rights
You may access, correct and delete your personal information, withdraw permission grants in system settings, or uninstall the App at any time. Locally stored identifiers and data are cleared upon uninstall.

6. Protection of minors
The App includes social and real-time communication features. If you are a minor, please use it under the guidance of a guardian. We do not deliberately collect information beyond what is necessary from minors.

7. Changes and contact
This policy may be updated; material changes will be notified via in-app prompts. For questions about personal information processing, contact us through the channels published in the App or on the official website.""",
    )

    /** 用户协议 */
    fun userAgreement(): String = L(
        """MCTier 用户协议

欢迎使用 MCTier。本协议是你与本应用之间就使用相关服务达成的约定，请在使用前阅读。使用即表示你已同意本协议。

一、服务说明
MCTier 是一款虚拟局域网组网与协作工具，提供组网、语音、聊天、文件夹共享、屏幕共享、远程控制、消息弹幕、变声器等功能，供个人在合法合规前提下用于局域网联机、协作与跨网络访问自有/获授权的服务。

二、用户行为规范（禁止性条款）
你承诺不利用本应用从事任何违反法律法规或损害他人合法权益的行为，包括但不限于：
1. 制作、复制、发布、传播违法违规、淫秽色情、暴恐、谣言、侵权或其他不良信息；
2. 未经授权访问、控制、监控他人设备、系统或数据；远程控制/屏幕共享功能仅可用于你本人设备或已获明确授权的设备；
3. 利用语音、变声等功能实施电信网络诈骗、冒充他人身份或其他欺骗、骚扰行为；
4. 将本服务用于跨境非法联网或从事须经主管部门许可而未取得许可的经营活动；
5. 干扰、破坏本服务或他人正常使用，传播恶意程序。

三、远程控制与屏幕共享特别说明
远程控制、屏幕录制需双方明确授权后方可进行，被控方可随时终止。你须确保已取得对方真实、自愿的同意，并对你发起或接受的控制行为负责。严禁用于偷窥、窃取信息、非法控制等用途，否则可能承担行政或刑事责任。

四、免责声明
1. 本应用按"现状"提供，因网络环境、第三方节点等导致的连接不稳定不承担责任；
2. 你应对自身使用行为及传输内容负责，因违规使用造成的一切后果由你自行承担；
3. 在法律允许的最大范围内，本应用不对间接损失承担责任。

五、知识产权与协议变更
本应用相关知识产权依法受保护。本协议可能更新，重大变更将在应用内提示，继续使用视为接受变更。""",
        """MCTier User Agreement

Welcome to MCTier. This agreement governs your use of the service. Please read it before use; using the App means you agree to it.

1. Service
MCTier is a virtual-LAN networking and collaboration tool offering networking, voice, chat, folder/screen sharing, remote control, danmaku and a voice changer, for lawful personal use such as LAN play, collaboration and accessing your own/authorized services across networks.

2. Code of conduct (prohibitions)
You agree not to use the App for anything illegal or harmful to others' rights, including but not limited to:
2.1 Creating or spreading illegal, pornographic, violent/terrorist, defamatory, infringing or other harmful content;
2.2 Accessing, controlling or monitoring others' devices, systems or data without authorization; remote control / screen sharing may only be used on your own devices or devices you are explicitly authorized to control;
2.3 Using voice/voice-changer features for telecom fraud, impersonation, deception or harassment;
2.4 Using the service for unlawful cross-border networking or for business activities that require but lack regulatory approval;
2.5 Interfering with or damaging the service or others' normal use, or spreading malware.

3. Remote control & screen sharing
Remote control and screen capture require explicit authorization from both parties; the controlled party may stop at any time. You must ensure genuine, voluntary consent and are responsible for control sessions you initiate or accept. Spying, data theft and unauthorized control are strictly prohibited and may incur administrative or criminal liability.

4. Disclaimer
4.1 The App is provided "as is"; we are not liable for instability caused by network environments or third-party nodes;
4.2 You are responsible for your use and transmitted content; you bear all consequences of non-compliant use;
4.3 To the maximum extent permitted by law, the App is not liable for indirect damages.

5. IP and changes
Related intellectual property is protected by law. This agreement may be updated; material changes will be prompted in-app, and continued use constitutes acceptance.""",
    )

    /** 权限用途说明 */
    fun permissionUsage(): String = L(
        """权限用途说明

本应用遵循最小必要原则申请权限，均可在系统设置中关闭（关闭后相应功能不可用）：

· 麦克风（录音）：语音通话、变声试听；
· 相机：扫描大厅二维码加入；
· 屏幕录制：被远程控制或主动共享屏幕时采集屏幕画面；
· 无障碍服务：接受远程控制时执行对方的点击/滑动操作（仅在会话期间生效）；
· 悬浮窗：在其他应用之上显示消息弹幕；
· 通知：前台服务保活与消息提醒；
· 安装未知应用：应用内更新安装新版本；
· 忽略电池优化：减少挂后台时被系统杀死；
· 网络与网络状态：建立与维持虚拟局域网连接。""",
        """Permission Usage

The App follows the principle of minimal necessity; all permissions can be disabled in system settings (the related feature becomes unavailable):

- Microphone: voice chat and voice-changer audition;
- Camera: scanning lobby QR codes;
- Screen capture: capturing screen frames when being remotely controlled or actively sharing;
- Accessibility service: executing the other party's tap/swipe input when you accept remote control (active only during a session);
- Overlay: showing message danmaku over other apps;
- Notifications: foreground-service keep-alive and message alerts;
- Install unknown apps: installing new versions via in-app update;
- Ignore battery optimization: reducing the chance of being killed in the background;
- Network / network state: establishing and maintaining the virtual LAN connection.""",
    )
}
