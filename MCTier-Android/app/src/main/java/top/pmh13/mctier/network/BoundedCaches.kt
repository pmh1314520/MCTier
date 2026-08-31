package top.pmh13.mctier.network

import java.util.ArrayDeque
import java.util.HashMap
import java.util.LinkedHashMap

/**
 * Small bounded FIFO cache for values that arrive before a WebRTC description.
 * Every dimension is bounded: total entries, total bytes, entries per peer and
 * age. The cache is synchronized because WebRTC callbacks are not single-threaded.
 */
internal class BoundedIceCache<K, V>(
    private val maxEntries: Int,
    private val maxBytes: Int,
    private val maxEntriesPerPeer: Int,
    private val ttlMillis: Long,
    private val peerOf: (K) -> String,
    private val bytesOf: (V) -> Int,
    private val clockMillis: () -> Long = { System.currentTimeMillis() },
) {
    private data class Entry<V>(val value: V, val bytes: Int, val addedAt: Long)

    private val lock = Any()
    private val buckets = LinkedHashMap<K, ArrayDeque<Entry<V>>>()
    private val peerCounts = HashMap<String, Int>()
    private var entryCount = 0
    private var byteCount = 0

    fun add(key: K, value: V): Boolean = synchronized(lock) {
        evictExpired(clockMillis())
        val bytes = bytesOf(value).coerceAtLeast(0)
        if (bytes > maxBytes || maxEntries <= 0 || maxEntriesPerPeer <= 0) return false

        val peer = peerOf(key)
        val bucket = buckets.getOrPut(key) { ArrayDeque() }
        while ((peerCounts[peer] ?: 0) >= maxEntriesPerPeer) {
            if (!removeOldest(peer)) return false
        }
        if (key !in buckets) buckets[key] = bucket
        while (entryCount >= maxEntries || byteCount + bytes > maxBytes) {
            if (!removeOldest()) return false
        }
        if (key !in buckets) buckets[key] = bucket
        bucket.addLast(Entry(value, bytes, clockMillis()))
        entryCount += 1
        byteCount += bytes
        peerCounts[peer] = (peerCounts[peer] ?: 0) + 1
        true
    }

    fun remove(key: K): List<V> = synchronized(lock) {
        evictExpired(clockMillis())
        val bucket = buckets.remove(key) ?: return emptyList()
        val values = bucket.map { it.value }
        bucket.forEach { entry ->
            entryCount -= 1
            byteCount -= entry.bytes
        }
        val peer = peerOf(key)
        val remaining = (peerCounts[peer] ?: 0) - bucket.size
        if (remaining > 0) peerCounts[peer] = remaining else peerCounts.remove(peer)
        values
    }

    fun clearPeer(peer: String) = synchronized(lock) {
        evictExpired(clockMillis())
        buckets.keys.filter { peerOf(it) == peer }.toList().forEach(::removeLocked)
    }

    fun removeWhere(predicate: (K) -> Boolean) = synchronized(lock) {
        evictExpired(clockMillis())
        buckets.keys.filter(predicate).toList().forEach(::removeLocked)
    }

    fun clear() = synchronized(lock) {
        buckets.clear()
        peerCounts.clear()
        entryCount = 0
        byteCount = 0
    }

    fun purgeExpired() = synchronized(lock) { evictExpired(clockMillis()) }

    fun size(): Int = synchronized(lock) {
        evictExpired(clockMillis())
        entryCount
    }

    fun byteSize(): Int = synchronized(lock) {
        evictExpired(clockMillis())
        byteCount
    }

    private fun removeFirst(key: K, bucket: ArrayDeque<Entry<V>>) {
        if (bucket.isEmpty()) return
        val removed = bucket.removeFirst()
        entryCount -= 1
        byteCount -= removed.bytes
        decrementPeerCount(peerOf(key))
        if (bucket.isEmpty()) buckets.remove(key)
    }

    private fun removeOldest(peer: String? = null): Boolean {
        var oldestKey: K? = null
        var oldestBucket: ArrayDeque<Entry<V>>? = null
        var oldestAt = Long.MAX_VALUE
        buckets.forEach { (key, bucket) ->
            if (peer != null && peerOf(key) != peer) return@forEach
            val entry = bucket.peekFirst() ?: return@forEach
            if (entry.addedAt < oldestAt) {
                oldestAt = entry.addedAt
                oldestKey = key
                oldestBucket = bucket
            }
        }
        val key = oldestKey ?: return false
        val bucket = oldestBucket ?: return false
        removeFirst(key, bucket)
        return true
    }

    private fun removeLocked(key: K) {
        val bucket = buckets.remove(key) ?: return
        bucket.forEach { entry ->
            entryCount -= 1
            byteCount -= entry.bytes
        }
        repeat(bucket.size) { decrementPeerCount(peerOf(key)) }
    }

    private fun evictExpired(now: Long) {
        val cutoff = now - ttlMillis.coerceAtLeast(0L)
        buckets.toList().forEach { (key, bucket) ->
            while (bucket.peekFirst()?.addedAt?.let { it <= cutoff } == true) {
                val removed = bucket.removeFirst()
                entryCount -= 1
                byteCount -= removed.bytes
                decrementPeerCount(peerOf(key))
            }
            if (bucket.isEmpty()) buckets.remove(key)
        }
    }

    private fun decrementPeerCount(peer: String) {
        val count = (peerCounts[peer] ?: 0) - 1
        if (count > 0) peerCounts[peer] = count else peerCounts.remove(peer)
    }
}

/** Per-(share, viewer) password gate with bounded exponential backoff. */
internal class ExponentialBackoffLimiter(
    private val maxEntries: Int = 1024,
    private val baseDelayMillis: Long = 1_000L,
    private val maxDelayMillis: Long = 60_000L,
    private val ttlMillis: Long = 15 * 60_000L,
    private val clockMillis: () -> Long = { System.currentTimeMillis() },
) {
    data class Decision(val allowed: Boolean, val retryAfterMillis: Long = 0L)

    private data class State(var failures: Int, var nextAllowedAt: Long, var lastFailureAt: Long)

    private val lock = Any()
    private val states = LinkedHashMap<String, State>()

    fun beforeAttempt(key: String): Decision = synchronized(lock) {
        val now = clockMillis()
        evictExpired(now)
        val state = states[key] ?: return Decision(true)
        if (state.nextAllowedAt > now) Decision(false, state.nextAllowedAt - now) else Decision(true)
    }

    fun recordFailure(key: String): Long = synchronized(lock) {
        val now = clockMillis()
        evictExpired(now)
        if (!states.containsKey(key) && states.size >= maxEntries.coerceAtLeast(1)) {
            states.entries.minByOrNull { it.value.lastFailureAt }?.key?.let(states::remove)
        }
        val state = states.getOrPut(key) { State(0, now, now) }
        state.failures = (state.failures + 1).coerceAtMost(31)
        val shift = (state.failures - 1).coerceAtMost(20)
        val delay = (baseDelayMillis.coerceAtLeast(0L) shl shift).coerceAtMost(maxDelayMillis.coerceAtLeast(0L))
        state.nextAllowedAt = now + delay
        state.lastFailureAt = now
        delay
    }

    fun recordSuccess(key: String): Unit = synchronized(lock) { states.remove(key) }

    fun clear() = synchronized(lock) { states.clear() }

    private fun evictExpired(now: Long) {
        val cutoff = now - ttlMillis.coerceAtLeast(0L)
        states.entries.removeIf { it.value.lastFailureAt <= cutoff }
    }
}
