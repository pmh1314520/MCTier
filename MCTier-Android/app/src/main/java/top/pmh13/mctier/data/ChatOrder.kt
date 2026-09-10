package top.pmh13.mctier.data

private val messageTimePattern = Regex("^(\\d{13})(?:-|$)")

fun chatOrderTime(message: ChatMessage): Long {
    val prefix = "msg-${message.playerId}-"
    if (!message.id.startsWith(prefix)) return message.timestamp
    return messageTimePattern.find(message.id.removePrefix(prefix))?.groupValues?.get(1)?.toLongOrNull()
        ?: message.timestamp
}

fun orderedChatMessages(messages: List<ChatMessage>): List<ChatMessage> =
    messages.distinctBy { it.id }.sortedWith(compareBy<ChatMessage> { chatOrderTime(it) }.thenBy { it.id }).takeLast(500)
