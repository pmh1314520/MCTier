package top.pmh13.mctier.network

import java.net.URLDecoder
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

data class LobbyInviteData(
    val name: String,
    val password: String,
    val serverNode: String? = null,
    val signalingServer: String? = null,
)

object LobbyInviteCodec {
    fun formatText(invite: LobbyInviteData, english: Boolean): String {
        val link = buildLink(invite)
        return if (english) {
            listOf(
                "——————— Invitation to Join Lobby ———————",
                "Copy everything, then open MCTier - Join Lobby (auto-detected)",
                "Lobby Name: ${invite.name}",
                "Password: ${invite.password}",
                invite.serverNode?.takeIf { it.isNotBlank() }?.let { "Server Node: $it" },
                invite.signalingServer?.takeIf { it.isNotBlank() }?.let { "Signaling Server: $it" },
                "Invite Link: $link",
                "————— https://mctier.pmhs.top —————",
            ).filterNotNull().joinToString("\n")
        } else {
            listOf(
                "——————— 邀请您加入大厅 ———————",
                "完整复制后打开 MCTier-加入大厅 界面（自动识别）",
                "大厅名称：${invite.name}",
                "密码：${invite.password}",
                invite.serverNode?.takeIf { it.isNotBlank() }?.let { "服务器节点：$it" },
                invite.signalingServer?.takeIf { it.isNotBlank() }?.let { "信令服务器：$it" },
                "邀请链接：$link",
                "————— https://mctier.pmhs.top —————",
            ).filterNotNull().joinToString("\n")
        }
    }

    fun buildLink(invite: LobbyInviteData): String {
        val params = mutableListOf(
            "v=2",
            "name=${encode(invite.name)}",
            "pwd=${encode(invite.password)}",
        )
        invite.serverNode?.trim()?.takeIf { it.isNotEmpty() }?.let { params += "node=${encode(it)}" }
        invite.signalingServer?.trim()?.takeIf { it.isNotEmpty() }?.let { params += "signal=${encode(it)}" }
        return "mctier://join?${params.joinToString("&")}"
    }

    fun parse(text: String): LobbyInviteData? {
        val deepLink = Regex("(?i)mctier://join/?\\?[^\\s]+").find(text)?.value
        if (deepLink != null) parseLink(deepLink)?.let { return it }

        val name = extract(text, listOf("大厅名称", "Lobby Name")) ?: return parseLegacy(text)
        return LobbyInviteData(
            name = name,
            password = extract(text, listOf("密码", "Password"), allowEmpty = true).orEmpty(),
            serverNode = extract(text, listOf("服务器节点", "Server Node")),
            signalingServer = extract(text, listOf("信令服务器", "Signaling Server")),
        )
    }

    private fun parseLink(raw: String): LobbyInviteData? {
        val query = raw.substringAfter('?', "")
        if (query.isBlank()) return null
        val params = query.split('&').mapNotNull { part ->
            val index = part.indexOf('=')
            if (index <= 0) null else part.substring(0, index) to decode(part.substring(index + 1))
        }.toMap()
        val name = params["name"]?.trim().orEmpty()
        if (name.isBlank()) return null
        return LobbyInviteData(
            name = name,
            password = params["pwd"].orEmpty(),
            serverNode = params["node"].cleanOptional(),
            signalingServer = params["signal"].cleanOptional(),
        )
    }

    private fun parseLegacy(text: String): LobbyInviteData? {
        val parts = text.trim().split('|')
        if (parts.size != 2 || parts[0].trim().isEmpty()) return null
        return LobbyInviteData(parts[0].trim(), parts[1].trim())
    }

    private fun extract(text: String, labels: List<String>, allowEmpty: Boolean = false): String? {
        val labelPattern = labels.joinToString("|") { Regex.escape(it) }
        val valuePattern = if (allowEmpty) "([^\\r\\n]*)" else "([^\\r\\n]+)"
        return Regex("(?:$labelPattern)\\s*[:：]\\s*$valuePattern", RegexOption.IGNORE_CASE)
            .find(text)?.groupValues?.getOrNull(1)?.trim()?.cleanOptional()
    }

    private fun String?.cleanOptional(): String? = this?.trim()?.takeIf { it.isNotEmpty() }

    private fun encode(value: String): String = URLEncoder.encode(value, StandardCharsets.UTF_8.name())

    private fun decode(value: String): String = URLDecoder.decode(value, StandardCharsets.UTF_8.name())
}
