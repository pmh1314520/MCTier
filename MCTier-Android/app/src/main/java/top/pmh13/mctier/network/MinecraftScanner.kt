package top.pmh13.mctier.network

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.io.DataInputStream
import java.io.DataOutputStream
import java.net.InetSocketAddress
import java.net.Socket

/** 扫描发现的 Minecraft 世界 */
data class DiscoveredWorld(
    val ip: String,
    val port: Int,
    val ownerName: String,
    val motd: String,
    val version: String,
    val onlinePlayers: Int,
    val maxPlayers: Int,
    val latencyMs: Int,
)

/**
 * 局域网（虚拟网络）Minecraft 世界扫描：对大厅内各玩家虚拟 IP 的指定端口做
 * Minecraft Server List Ping（SLP），获取 MOTD/版本/在线人数。端口连通但 SLP
 * 失败时仍作为“疑似世界”返回（信息未知）。
 */
object MinecraftScanner {

    /** ipToName: 虚拟IP -> 玩家名 */
    suspend fun scan(ipToName: Map<String, String>, port: Int): List<DiscoveredWorld> = coroutineScope {
        ipToName.entries.map { (ip, name) ->
            async(Dispatchers.IO) { pingOne(ip, name, port) }
        }.awaitAll().filterNotNull().sortedBy { it.latencyMs }
    }

    private suspend fun pingOne(ip: String, owner: String, port: Int): DiscoveredWorld? = withTimeoutOrNull(2500) {
        val start = System.currentTimeMillis()
        runCatching {
            Socket().use { sock ->
                sock.connect(InetSocketAddress(ip, port), 2000)
                val latency = (System.currentTimeMillis() - start).toInt()
                val out = DataOutputStream(sock.getOutputStream())
                val inp = DataInputStream(sock.getInputStream())

                // —— Handshake 包：协议版本 + 地址 + 端口 + next state(1=status) ——
                val handshake = by {
                    writeVarInt(0x00)
                    writeVarInt(-1) // 协议版本（-1 表示询问）
                    writeString(ip)
                    writeShort(port)
                    writeVarInt(1)
                }
                writePacket(out, handshake)
                // —— Status request 包（空）——
                writePacket(out, by { writeVarInt(0x00) })

                // —— 读取响应 ——
                readVarInt(inp)          // 包长度
                val packetId = readVarInt(inp)
                if (packetId != 0x00) return@runCatching tcpOnly(ip, owner, port, latency)
                val json = readString(inp)
                parseStatus(ip, owner, port, latency, json)
            }
        }.getOrElse {
            // 连接成功但 SLP 解析失败时已在内部处理；这里属于连接失败
            null
        }
    }

    private fun tcpOnly(ip: String, owner: String, port: Int, latency: Int) =
        DiscoveredWorld(ip, port, owner, "", "未知", 0, 0, latency)

    private fun parseStatus(ip: String, owner: String, port: Int, latency: Int, json: String): DiscoveredWorld {
        return runCatching {
            val obj = JSONObject(json)
            val version = obj.optJSONObject("version")?.optString("name") ?: "未知"
            val players = obj.optJSONObject("players")
            val online = players?.optInt("online") ?: 0
            val max = players?.optInt("max") ?: 0
            val desc = obj.opt("description")
            val motd = when (desc) {
                is JSONObject -> extractText(desc)
                is String -> desc
                else -> ""
            }
            DiscoveredWorld(ip, port, owner, motd.trim(), version, online, max, latency)
        }.getOrElse { tcpOnly(ip, owner, port, latency) }
    }

    /** 递归提取 description 中的纯文本（兼容 Chat 组件格式） */
    private fun extractText(obj: JSONObject): String {
        val sb = StringBuilder()
        sb.append(obj.optString("text", ""))
        val extra = obj.optJSONArray("extra")
        if (extra != null) for (i in 0 until extra.length()) {
            when (val e = extra.get(i)) {
                is JSONObject -> sb.append(extractText(e))
                is String -> sb.append(e)
            }
        }
        return sb.toString()
    }

    // ==================== Minecraft 协议编码辅助 ====================
    private class Buf {
        val bytes = ArrayList<Byte>()
        fun writeByte(b: Int) { bytes.add(b.toByte()) }
        fun writeVarInt(value: Int) {
            var v = value
            while (true) {
                if ((v and 0x7F.inv()) == 0) { writeByte(v); return }
                writeByte((v and 0x7F) or 0x80)
                v = v ushr 7
            }
        }
        fun writeShort(s: Int) { writeByte((s ushr 8) and 0xFF); writeByte(s and 0xFF) }
        fun writeString(s: String) {
            val data = s.toByteArray(Charsets.UTF_8)
            writeVarInt(data.size)
            data.forEach { bytes.add(it) }
        }
        fun toByteArray(): ByteArray = ByteArray(bytes.size) { bytes[it] }
    }

    private fun by(block: Buf.() -> Unit): ByteArray = Buf().apply(block).toByteArray()

    private fun writePacket(out: DataOutputStream, payload: ByteArray) {
        val len = Buf().apply { writeVarInt(payload.size) }.toByteArray()
        out.write(len)
        out.write(payload)
        out.flush()
    }

    private fun readVarInt(inp: DataInputStream): Int {
        var numRead = 0
        var result = 0
        while (true) {
            val read = inp.readByte().toInt()
            result = result or ((read and 0x7F) shl (7 * numRead))
            numRead++
            if (numRead > 5) throw RuntimeException("VarInt too big")
            if ((read and 0x80) == 0) break
        }
        return result
    }

    private fun readString(inp: DataInputStream): String {
        val len = readVarInt(inp)
        val buf = ByteArray(len)
        inp.readFully(buf)
        return String(buf, Charsets.UTF_8)
    }
}
