package top.pmh13.mctier.network

import org.junit.Assert.assertEquals
import org.junit.Test
import top.pmh13.mctier.data.ChatMessage
import top.pmh13.mctier.data.recordUnread
import top.pmh13.mctier.data.readConversation
import top.pmh13.mctier.data.unreadLabel

class ChatUnreadTest {
    private fun message(id: String, peer: String = "alice", recipient: String? = "me") =
        ChatMessage(id = id, playerId = peer, playerName = peer, content = "hello", timestamp = Long.MAX_VALUE, mine = peer == "me", recipientId = recipient)

    @Test fun visibleConversationStaysReadWhileOtherConversationsAccumulate() {
        var unread = recordUnread(emptyMap(), message("a"), "me", null)
        unread = recordUnread(unread, message("b", "bob"), "me", null)
        unread = recordUnread(unread, message("lobby", recipient = null), "me", null)
        unread = readConversation(unread, "private:alice")
        assertEquals(mapOf("b" to "private:bob", "lobby" to "lobby"), unread)
        assertEquals(unread, recordUnread(unread, message("new"), "me", "private:alice"))
        assertEquals(unread, readConversation(unread, null))
        unread = recordUnread(unread, message("after-close"), "me", null)
        assertEquals(mapOf("b" to "private:bob", "after-close" to "private:alice"), readConversation(unread, "lobby"))
    }

    @Test fun ignoredMessagesAndDuplicateIdsDoNotInflateUnread() {
        assertEquals(emptyMap<String, String>(), recordUnread(emptyMap(), message("self", "me"), "me", null))
        assertEquals(emptyMap<String, String>(), recordUnread(emptyMap(), message("recall").copy(recalled = true), "me", null))
        assertEquals(emptyMap<String, String>(), recordUnread(emptyMap(), message("other", recipient = "bob"), "me", null))
        val first = recordUnread(emptyMap(), message("a"), "me", null)
        assertEquals(first, recordUnread(first, message("a"), "me", null))
    }

    @Test fun badgeCapsAtNinetyNinePlus() {
        assertEquals(listOf("1", "9", "10", "99", "99+", "99+"), listOf(1, 9, 10, 99, 100, 101).map(::unreadLabel))
    }
}
