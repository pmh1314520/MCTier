package top.pmh13.mctier.data

fun incomingConversation(message: ChatMessage, localId: String): String? {
    if (message.mine || message.playerId == localId || message.recalled) return null
    if (message.recipientId == null) return "lobby"
    return if (message.recipientId == localId) "private:${message.playerId}" else null
}

fun recordUnread(unread: Map<String, String>, message: ChatMessage, localId: String, active: String?): Map<String, String> {
    val conversation = incomingConversation(message, localId) ?: return unread
    return if (conversation == active) unread else unread + (message.id to conversation)
}

fun readConversation(unread: Map<String, String>, conversation: String?): Map<String, String> =
    if (conversation == null) unread else unread.filterValues { it != conversation }

fun unreadLabel(count: Int): String = if (count > 99) "99+" else count.toString()
