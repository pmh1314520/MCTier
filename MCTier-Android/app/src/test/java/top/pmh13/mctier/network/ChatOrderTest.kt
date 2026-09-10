package top.pmh13.mctier.network

import org.junit.Assert.assertEquals
import org.junit.Test
import top.pmh13.mctier.data.ChatMessage
import top.pmh13.mctier.data.orderedChatMessages

class ChatOrderTest {
    @Test
    fun rapidDesktopAndAndroidMessagesKeepSenderOrderAfterReversedDelivery() {
        val messages = (0..79).map { index ->
            ChatMessage("msg-player-${1800000000000L + index}${if (index % 2 == 0) "-uuid" else ""}", "player", "Player", "$index", 1800000000000L)
        }
        assertEquals(messages, orderedChatMessages(messages.reversed() + messages.first()))
    }
}
