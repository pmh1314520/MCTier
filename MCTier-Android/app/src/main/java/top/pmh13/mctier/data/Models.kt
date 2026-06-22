package top.pmh13.mctier.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

const val DefaultEasyTierNode = "udp://us01.225284.xyz:11010"
const val DefaultSignalingServer = "wss://mctier.pmhs.top/signaling"
const val FileSharePort = 14539
const val ChatServerPort = 14540
const val AppClientVersion = "2.1.6"

enum class AppConnectionState { Idle, Connecting, InLobby, Error }

/** 版本提示：服务器要求的最低版本不满足时的强制更新信息 */
data class VersionAlert(
    val current: String,
    val minimum: String,
    val downloadUrl: String,
)

@Serializable
data class Lobby(
    val id: String,
    val name: String,
    val password: String,
    val createdAt: Long,
    val virtualIp: String,
    val creatorVirtualIp: String = "10.126.126.1",
    val virtualDomain: String? = null,
    val useDomain: Boolean = false,
    val signalingServer: String = DefaultSignalingServer,
)

@Serializable
data class Player(
    val id: String,
    val name: String,
    val virtualIp: String? = null,
    val virtualDomain: String? = null,
    val useDomain: Boolean = false,
    val micEnabled: Boolean = false,
    val muted: Boolean = false,
    val speaking: Boolean = false,
    val joinedAt: Long = System.currentTimeMillis(),
)

@Serializable
data class ChatMessage(
    val id: String,
    val playerId: String,
    val playerName: String,
    val content: String,
    val timestamp: Long,
    val mine: Boolean = false,
    val type: String = "text", // "text" | "image"
    val imageBase64: String? = null, // data:image/jpeg;base64,... 用于显示
)

@Serializable
data class SharedFolder(
    val id: String,
    val name: String,
    val uri: String,
    val password: String? = null,
    val expireAt: Long? = null,
    val compressBeforeSend: Boolean = false,
    val ownerId: String,
    val createdAt: Long = System.currentTimeMillis(),
)

@Serializable
data class ScreenShareInfo(
    val id: String,
    val playerId: String,
    val playerName: String,
    val requirePassword: Boolean,
    val viewerId: String? = null,
    val viewerName: String? = null,
    val startedAt: Long = System.currentTimeMillis(),
)

@Serializable
data class UserSettings(
    val playerName: String = "Android玩家",
    val preferredServer: String = DefaultEasyTierNode,
    val signalingServer: String = DefaultSignalingServer,
    val useDomain: Boolean = false,
    val virtualDomain: String = "",
    val autoLobbyEnabled: Boolean = false,
    val autoLobbyName: String = "",
    val autoLobbyPassword: String = "",
    val enableExitNode: Boolean = false,
    val enableAsExitNode: Boolean = false,
    val proxyCidrs: String = "",
    val exitNodes: String = "",
    val mtu: Int = 1420,
    val latencyFirst: Boolean = true,
    // —— 进阶 EasyTier flags（对齐桌面端高级配置，均映射到真实生效的 flags）——
    val multiThread: Boolean = true,
    val useSmoltcp: Boolean = false,
    val enableKcpProxy: Boolean = false,
    val enableQuicProxy: Boolean = false,
    val disableP2p: Boolean = false,
    val disableUdpHolePunching: Boolean = false,
    val relayAllPeerRpc: Boolean = false,
    val compressionZstd: Boolean = false,
    val privateMode: Boolean = false,
    val lobbyUseGlobalConfig: Boolean = true,
    // —— 提示音自定义（空字符串=使用内置默认音）——
    val customSoundMsg: String = "",      // 新消息提示音 URI
    val customSoundJoin: String = "",     // 玩家加入提示音 URI
    val customSoundLeave: String = "",    // 玩家离开提示音 URI
    val soundVolume: Float = 1.0f,        // 提示音音量 0.0~1.0
    val soundMuted: Boolean = false,      // 旧版全局禁音（保留用于迁移）
    val soundMutedMsg: Boolean = false,   // 新消息独立禁音
    val soundMutedJoin: Boolean = false,  // 玩家加入独立禁音
    val soundMutedLeave: Boolean = false, // 玩家离开独立禁音
    // —— 消息免打扰时段（开启后，时段内不播放任何提示音）——
    val dndEnabled: Boolean = false,
    val dndStartMinutes: Int = 22 * 60,   // 起始（自 00:00 起的分钟数），默认 22:00
    val dndEndMinutes: Int = 8 * 60,      // 结束，默认次日 08:00
    // —— 主题配色（"dark"|"light"，自定义主色十六进制如 "#3B82F6"，空=默认）——
    val themeMode: String = "dark",
    val themePrimary: String = "",
    // —— 界面语言（"zh"|"en"，空=跟随系统）——
    val language: String = "",
    // —— 消息弹幕 ——
    val danmakuEnabled: Boolean = true,
    val danmakuFontSize: Int = 20,   // sp
    val danmakuSpeed: Int = 130,     // dp/s
    val danmakuOpacity: Float = 0.9f,
    val danmakuTracks: Int = 4,
    val danmakuColor: String = "#FFFFFF", // 弹幕文字颜色
    // —— 游戏内 HUD 浮层 ——
    val hudOpacity: Float = 0.85f,
    // —— 变声器音色（none/uncle/male/female/loli/chipmunk/robot/telephone）——
    val voicePreset: String = "none",
)

@Serializable
data class SignalingEnvelope(
    val type: String,
    val from: String? = null,
    val to: String? = null,
    val clientId: String? = null,
    val playerId: String? = null,
    val playerName: String? = null,
    val virtualIp: String? = null,
    val virtualDomain: String? = null,
    val useDomain: Boolean? = null,
    val lobbyName: String? = null,
    val lobbyPassword: String? = null,
    val clientVersion: String? = null,
    val currentVersion: String? = null,
    val minimumVersion: String? = null,
    val downloadUrl: String? = null,
    val micEnabled: Boolean? = null,
    val content: String? = null,
    val timestamp: Long? = null,
    val hostId: String? = null,
    val maxPlayers: Int? = null,
    val isPublic: Boolean? = null,
    @SerialName("serverNode") val serverNode: String? = null,
    val mutedPlayers: List<String>? = null,
    val players: List<PlayerWire>? = null,
    val shares: List<FileShareWire>? = null,
    val lobbies: List<PublicLobbyWire>? = null,
    val description: String? = null,
    val target: String? = null,
    val muted: Boolean? = null,
    val shareId: String? = null,
    val hasPassword: Boolean? = null,
    val password: String? = null,
    val error: String? = null,
    val reason: String? = null,
    val offer: SdpPayload? = null,
    val answer: SdpPayload? = null,
    val candidate: IcePayload? = null,
    // 远程控制（电脑⇄手机）
    val sessionId: String? = null,
    val fromName: String? = null,
)

@Serializable
data class PlayerWire(
    val playerId: String,
    val playerName: String,
    val virtualIp: String? = null,
    val virtualDomain: String? = null,
    val useDomain: Boolean? = null,
)

@Serializable
data class SdpPayload(val type: String, val sdp: String)

@Serializable
data class IcePayload(
    val candidate: String,
    val sdpMLineIndex: Int? = null,
    val sdpMid: String? = null,
)

/** 内置 EasyTier 节点（与桌面端保持一致） */
data class BuiltinNode(val name: String, val address: String)

/** 收到的远程控制请求（电脑请求控制本机手机） */
data class RemoteControlRequest(val sessionId: String, val fromId: String, val fromName: String)

/** P2P 聊天 wire 消息（字段与桌面端 chat_service.rs 的 ChatMessage 完全一致，snake_case） */
@Serializable
data class ChatWireMessage(
    val id: String,
    @SerialName("player_id") val playerId: String,
    @SerialName("player_name") val playerName: String,
    val content: String,
    @SerialName("message_type") val messageType: String = "text", // "text" | "image"
    val timestamp: Long, // 秒
    @SerialName("image_data") val imageData: List<Int>? = null, // 图片字节(0~255)
)

/** P2P 聊天发送请求体（与桌面端 SendMessageRequest 对齐） */
@Serializable
data class ChatSendRequest(
    val id: String? = null,
    @SerialName("player_id") val playerId: String,
    @SerialName("player_name") val playerName: String,
    val content: String,
    @SerialName("message_type") val messageType: String = "text",
    @SerialName("image_data") val imageData: List<Int>? = null,
)

/** 文件共享列表项（信令 file-share-list-response 内，与桌面端字段一致） */
@Serializable
data class FileShareWire(
    @SerialName("shareId") val shareId: String,
    @SerialName("shareName") val shareName: String,
    @SerialName("playerName") val playerName: String,
    @SerialName("hasPassword") val hasPassword: Boolean = false,
)

/** 远端共享条目（UI 用，含所有者虚拟 IP） */
data class RemoteShareEntry(
    val shareId: String,
    val shareName: String,
    val ownerId: String,
    val ownerName: String,
    val ownerIp: String,
    val hasPassword: Boolean,
)

/** 远端文件信息（HTTP /files 返回，与桌面端 FileInfo 对齐） */
@Serializable
data class RemoteFileInfo(
    val name: String,
    val path: String,
    val size: Long = 0,
    @SerialName("is_dir") val isDir: Boolean = false,
    val modified: Long = 0,
)

@Serializable
data class RemoteFileListResponse(
    val files: List<RemoteFileInfo> = emptyList(),
)

/** 公开广场大厅项（与桌面端 PublicLobbyInfo 对齐） */
@Serializable
data class PublicLobbyWire(
    @SerialName("lobbyName") val lobbyName: String,
    @SerialName("playerCount") val playerCount: Int = 0,
    @SerialName("maxPlayers") val maxPlayers: Int? = null,
    @SerialName("hostName") val hostName: String = "",
    val description: String = "",
    val password: String = "",
    @SerialName("serverNode") val serverNode: String = "",
)

/** 收藏大厅（本地存储） */
@Serializable
data class FavoriteLobby(val name: String, val password: String, val note: String = "", val useCount: Int = 0, val lastUsedAt: Long = 0)

/** 用户自定义 EasyTier 节点（本地存储，可增删改） */
@Serializable
data class CustomNode(val name: String, val address: String)

/** 待办事项（房间工具，多人协同同步；字段名与桌面端一致） */
@Serializable
data class TodoItem(
    val id: String,
    val text: String,
    val done: Boolean = false,
    val assignee: String = "", // 被分配玩家名，空=未分配
    val creator: String = "",  // 创建者名
    val ts: Long = 0L,         // 时间戳(毫秒)
)

/** 邀请 deep link 解析结果（mctier://join?name=&pwd=），用于预填加入表单 */
data class DeepLinkJoin(val name: String, val pwd: String)

/** 最近进入的大厅（本地存储） */
@Serializable
data class RecentLobby(val name: String, val password: String, val lastJoined: Long)

/** 最近一起联机的玩家（本地存储） */
@Serializable
data class RecentPlayer(val name: String, val lastSeen: Long, val count: Int = 1)

/** 单场开黑记录（本地存储） */
@Serializable
data class SessionRecord(val start: Long, val durationMs: Long, val isHost: Boolean)

/** 本地数据统计（纯本地，不上报） */
data class LocalStats(
    val totalOnlineMs: Long = 0,
    val joinCount: Int = 0,
    val hostCount: Int = 0,
    val memberCount: Int = 0,
    val maxSessionMs: Long = 0,
    val avgSessionMs: Long = 0,
    val firstUseTs: Long = 0,
    val lastOnlineTs: Long = 0,
    val usedDays: Int = 0,
    val buckets: List<Int> = listOf(0, 0, 0, 0), // 凌晨/上午/下午/晚上
    val mostActiveBucket: Int = -1,
    val partners: List<RecentPlayer> = emptyList(), // 按 count 降序
    val uniquePartners: Int = 0,
    val hasData: Boolean = false,
)

val BuiltinNodes: List<BuiltinNode> = listOf(
    BuiltinNode("MCTier 官方服务器", "udp://us01.225284.xyz:11010"),
    BuiltinNode("海波节点", "tcp://225284.xyz:11010"),
    BuiltinNode("唯爱节点", "tcp://easytier.weiai.org.cn:11010"),
    BuiltinNode("明月清风节点", "wss://public.456469.xyz"),
)

@Serializable
data class ShareFileInfo(
    val name: String,
    val path: String,
    val size: Long,
    @SerialName("is_dir")
    val isDir: Boolean,
    val modified: Long,
)
