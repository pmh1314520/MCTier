package top.pmh13.mctier.network

import android.content.Context
import android.content.Intent
import android.net.VpnService
import android.util.Log
import com.easytier.jni.EasyTierJNI
import com.easytier.jni.EasyTierVpnService
import kotlinx.coroutines.delay
import top.pmh13.mctier.data.DefaultEasyTierNode
import top.pmh13.mctier.data.BuiltinNodes
import kotlin.math.absoluteValue

data class NetworkSession(
    val networkName: String,
    val networkKey: String,
    val node: String,
    val virtualIp: String,
)

class NetworkController(private val context: Context) {
    private var currentInstanceName: String? = null

    fun vpnPrepareIntent(): Intent? = VpnService.prepare(context)

    suspend fun startEasyTier(
        lobbyName: String,
        password: String,
        playerName: String,
        node: String = DefaultEasyTierNode,
        mtu: Int = 1420,
        latencyFirst: Boolean = true,
        proxyCidrs: List<String> = emptyList(),
        exitNodes: List<String> = emptyList(),
        asExitNode: Boolean = false,
        multiThread: Boolean = true,
        useSmoltcp: Boolean = false,
        enableKcpProxy: Boolean = false,
        enableQuicProxy: Boolean = false,
        disableP2p: Boolean = false,
        disableUdpHolePunching: Boolean = false,
        relayAllPeerRpc: Boolean = false,
        compressionZstd: Boolean = false,
        privateMode: Boolean = false,
        useDomain: Boolean = false,
    ): NetworkSession {
        val networkName = "MCTier-$lobbyName"
        val instanceName = "mctier_${lobbyName.hashCode().absoluteValue}_${playerName.hashCode().absoluteValue}"
        val normalizedNode = normalizeNode(node)
        // 【可靠性关键修复】与桌面端一致：使用内置公共节点时启用多节点冗余 peer，
        // 单个节点连不上时自动尝试其它内置节点，并保证与桌面端有共同可达中继以便互相发现。
        // 私有/自定义节点保持隔离，仅连接该节点。
        val peerList = buildPeerList(normalizedNode)
        val virtualIp = allocateVirtualIp(lobbyName, playerName)
        Log.i(TAG, "Starting EasyTier instance=$instanceName ip=$virtualIp peers=$peerList lobby=$lobbyName")
        if (!EasyTierJNI.available) {
            error("EasyTier native load failed: ${EasyTierJNI.loadErrorMessage ?: "unknown error"}")
        }

        val config = buildEasyTierConfig(
            instanceName = instanceName,
            networkName = networkName,
            networkSecret = password,
            hostname = playerName,
            peers = peerList,
            virtualIp = "$virtualIp/24",
            mtu = mtu,
            latencyFirst = latencyFirst,
            proxyCidrs = proxyCidrs.map { it.trim() }.filter { it.isNotBlank() },
            exitNodes = exitNodes.map { it.trim() }.filter { it.isNotBlank() },
            asExitNode = asExitNode,
            multiThread = multiThread,
            useSmoltcp = useSmoltcp,
            enableKcpProxy = enableKcpProxy,
            enableQuicProxy = enableQuicProxy,
            disableP2p = disableP2p,
            disableUdpHolePunching = disableUdpHolePunching,
            relayAllPeerRpc = relayAllPeerRpc,
            compressionZstd = compressionZstd,
            privateMode = privateMode,
            acceptDns = useDomain,
        )
        val parseResult = EasyTierJNI.parseConfig(config)
        if (parseResult != 0) {
            error(EasyTierJNI.getLastError() ?: "EasyTier config parse failed")
        }
        val runResult = EasyTierJNI.runNetworkInstance(config)
        if (runResult != 0) {
            error(EasyTierJNI.getLastError() ?: "EasyTier start failed")
        }
        currentInstanceName = instanceName
        Log.i(TAG, "EasyTier instance started; starting VPN route=${lobbyRoute(lobbyName)}")
        startVpnService(instanceName, "$virtualIp/24", lobbyRoute(lobbyName), useDomain)
        delay(900)

        val reportedIp = waitForVirtualIp(instanceName)
        if (reportedIp.isNullOrBlank()) {
            Log.w(TAG, "EasyTier did not report virtual IP yet; continuing with assigned IP $virtualIp")
        }
        return NetworkSession(networkName, password, normalizedNode, virtualIp)
    }

    suspend fun stopEasyTier() {
        // 【修复 VPN 残留】先停止 EasyTier 网络实例（释放 TUN 文件描述符），
        // 再停止 VpnService，确保系统 VPN 连接被真正关闭、状态栏 VPN 图标消失。
        if (EasyTierJNI.available) {
            runCatching { EasyTierJNI.stopAllInstances() }
        }
        currentInstanceName = null
        // 先发显式 STOP 动作关闭 TUN 与前台服务，再 stopService 兜底，确保 VPN 图标立即消失
        runCatching {
            context.startService(
                Intent(context, EasyTierVpnService::class.java).setAction(EasyTierVpnService.ACTION_STOP),
            )
        }
        runCatching { context.stopService(Intent(context, EasyTierVpnService::class.java)) }
        delay(200)
    }

    private fun buildEasyTierConfig(
        instanceName: String,
        networkName: String,
        networkSecret: String,
        hostname: String,
        peers: List<String>,
        virtualIp: String,
        mtu: Int = 1420,
        latencyFirst: Boolean = true,
        proxyCidrs: List<String> = emptyList(),
        exitNodes: List<String> = emptyList(),
        asExitNode: Boolean = false,
        multiThread: Boolean = true,
        useSmoltcp: Boolean = false,
        enableKcpProxy: Boolean = false,
        enableQuicProxy: Boolean = false,
        disableP2p: Boolean = false,
        disableUdpHolePunching: Boolean = false,
        relayAllPeerRpc: Boolean = false,
        compressionZstd: Boolean = false,
        privateMode: Boolean = false,
        acceptDns: Boolean = false,
    ): String {
        // 【总根源修复】此前使用了错误的 TOML 字段名（inst_name / network / network_secret 顶层 /
        // peers=[字符串]），EasyTier(TomlConfigLoader) 会静默忽略这些未知字段，导致手机端
        // 网络标识为空、且没有任何 peer —— EasyTier 实际从未加入正确网络、也没连任何中继，
        // 因此与电脑端完全不通（语音/聊天/屏幕全废）。
        // 这里严格按 EasyTier Config 结构体的字段名生成：instance_name、[network_identity]、
        // [[peer]] uri、[flags] 等，确保手机端真正加入 "MCTier-xxx" 网络并连接全部冗余中继。
        fun esc(s: String): String = s.replace("\\", "\\\\").replace("\"", "\\\"")

        val sb = StringBuilder()
        // —— 顶层标量字段（必须位于所有 [table] 之前，否则会被解析成上一个表的字段）——
        sb.append("instance_name = \"").append(esc(instanceName)).append("\"\n")
        sb.append("hostname = \"").append(esc(hostname)).append("\"\n")
        sb.append("ipv4 = \"").append(virtualIp).append("\"\n")
        sb.append("dhcp = false\n")
        if (exitNodes.isNotEmpty()) {
            sb.append("exit_nodes = [")
            sb.append(exitNodes.joinToString(", ") { "\"$it\"" })
            sb.append("]\n")
        }
        // —— 网络标识（决定加入哪个网络，必须与桌面端完全一致）——
        sb.append("\n[network_identity]\n")
        sb.append("network_name = \"").append(esc(networkName)).append("\"\n")
        sb.append("network_secret = \"").append(esc(networkSecret)).append("\"\n")
        // —— 对端中继节点（多节点冗余，任意一个可达即可与桌面端在同一中继上相遇）——
        peers.forEach { p ->
            sb.append("\n[[peer]]\nuri = \"").append(p).append("\"\n")
        }
        // —— 代理网段（可选）——
        if (proxyCidrs.isNotEmpty()) {
            proxyCidrs.forEach { cidr ->
                sb.append("\n[[proxy_network]]\ncidr = \"").append(cidr).append("\"\n")
            }
        }
        // —— flags：性能与出口节点开关 ——
        sb.append("\n[flags]\n")
        sb.append("latency_first = ").append(latencyFirst).append("\n")
        sb.append("mtu = ").append(mtu).append("\n")
        sb.append("multi_thread = ").append(multiThread).append("\n")
        sb.append("enable_kcp_proxy = ").append(enableKcpProxy).append("\n")
        sb.append("enable_quic_proxy = ").append(enableQuicProxy).append("\n")
        sb.append("disable_p2p = ").append(disableP2p).append("\n")
        sb.append("disable_udp_hole_punching = ").append(disableUdpHolePunching).append("\n")
        sb.append("relay_all_peer_rpc = ").append(relayAllPeerRpc).append("\n")
        sb.append("private_mode = ").append(privateMode).append("\n")
        if (useSmoltcp) sb.append("use_smoltcp = true\n")
        if (acceptDns) {
            // 启用 EasyTier Magic DNS，并把域设为 mct.net.（与桌面端虚拟域名 <玩家名>.mct.net 一致）
            sb.append("accept_dns = true\n")
            sb.append("tld_dns_zone = \"mct.net.\"\n")
        }
        if (asExitNode) {
            sb.append("enable_exit_node = true\n")
        }
        return sb.toString()
    }

    private suspend fun waitForVirtualIp(instanceName: String): String? {
        repeat(30) {
            val json = runCatching { EasyTierJNI.collectNetworkInfos(20) }.getOrNull()
            val ip = json?.let { extractVirtualIpv4(it, instanceName) }
            if (!ip.isNullOrBlank()) return ip
            delay(500)
        }
        return null
    }

    private fun startVpnService(instanceName: String, virtualIp: String, route: String, magicDns: Boolean) {
        val intent = Intent(context, EasyTierVpnService::class.java).apply {
            putExtra(EasyTierVpnService.EXTRA_INSTANCE, instanceName)
            putExtra(EasyTierVpnService.EXTRA_IPV4, if (virtualIp.contains("/")) virtualIp else "$virtualIp/24")
            putStringArrayListExtra(EasyTierVpnService.EXTRA_ROUTES, arrayListOf(route))
            putExtra(EasyTierVpnService.EXTRA_MAGIC_DNS, magicDns)
        }
        context.startService(intent)
    }

    // 【互通关键修复】固定使用 EasyTier 默认 DHCP 网段 10.126.126.0/24。
    // 桌面端使用 DHCP，创建者会拿到 10.126.126.1，其余桌面节点依次 .2/.3...
    // 安卓端的 TUN 地址必须由 VpnService 在建立前写死，无法走 DHCP，
    // 因此这里固定落到同一网段，确保手机与电脑虚拟 IP 互相可达（语音/聊天/屏幕共享/文件均依赖此点）。
    // 不同大厅由 EasyTier 的 network-name/secret 隔离，复用同一网段不会串台。
    private val FIXED_SUBNET_OCTET = 126

    /**
     * 每台设备稳定且唯一的标识：用户同意隐私政策后优先用 ANDROID_ID（不同手机不同值，重连后稳定），
     * 未同意或取不到时回退到一次性持久化的随机 UUID（可通过卸载重置）。
     * 用它派生虚拟 IP 主机位，避免"相同玩家名 → 相同虚拟 IP"导致手机↔手机互相不可达。
     * 合规：ANDROID_ID 属设备标识符（个人信息），仅在用户已同意隐私政策后才采集。
     */
    private fun deviceKey(): String {
        if (top.pmh13.mctier.ui.ConsentStore.isAgreed(context)) {
            runCatching {
                @Suppress("HardwareIds")
                val aid = android.provider.Settings.Secure.getString(context.contentResolver, android.provider.Settings.Secure.ANDROID_ID)
                if (!aid.isNullOrBlank() && aid != "9774d56d682e549c") return aid
            }
        }
        val prefs = context.getSharedPreferences("mctier_device", Context.MODE_PRIVATE)
        prefs.getString("device_key", null)?.let { return it }
        val gen = java.util.UUID.randomUUID().toString()
        prefs.edit().putString("device_key", gen).apply()
        return gen
    }

    // 主机位：用每台设备唯一的 deviceKey 派生，取范围 [10, 249]（共 240 个），
    // 避开桌面 DHCP 创建者占用的 .1 与低位顺序分配区，最大程度降低冲突概率。
    private fun hostOctet(key: String): Int =
        10 + (key.hashCode().absoluteValue % 240)

    private fun allocateVirtualIp(lobbyName: String, playerName: String): String =
        "10.126.$FIXED_SUBNET_OCTET.${hostOctet(deviceKey() + "|" + lobbyName)}"

    private fun lobbyRoute(lobbyName: String): String =
        "10.126.$FIXED_SUBNET_OCTET.0/24"

    private fun extractVirtualIpv4(json: String, instanceName: String): String? {
        val instanceIndex = json.indexOf(instanceName)
        if (instanceIndex < 0) return null
        val afterInstance = json.substring(instanceIndex)
        val ipRegex = Regex("""(?:"virtual_ipv4"|"virtualIpv4")[\s\S]{0,160}?"addr"\s*:\s*(-?\d+)[\s\S]{0,80}?(?:"network_length"|"networkLength")\s*:\s*(\d+)""")
        val match = ipRegex.find(afterInstance) ?: return null
        val addr = match.groupValues[1].toLong()
        val prefix = match.groupValues[2].toInt()
        val unsigned = addr and 0xFFFF_FFFFL
        val ip = listOf(
            (unsigned shr 24) and 0xFF,
            (unsigned shr 16) and 0xFF,
            (unsigned shr 8) and 0xFF,
            unsigned and 0xFF,
        ).joinToString(".")
        return "$ip/$prefix"
    }

    private fun normalizeNode(node: String): String {
        val trimmed = node.trim()
        return when (trimmed) {
            "tcp://mctiers.pmhs.top:11010",
            "udp://mctiers.pmhs.top:11010",
            "ws://mctiers.pmhs.top:11011",
            "wss://mctiers.pmhs.top",
            "tcp://mctier.pmhs.top:11010",
            "udp://mctier.pmhs.top:11010",
            "ws://mctier.pmhs.top/signaling",
            "wss://mctier.pmhs.top/signaling",
            -> DefaultEasyTierNode
            else -> trimmed.ifBlank { DefaultEasyTierNode }
        }
    }

    /**
     * 构建冗余 peer 列表（与桌面端策略一致）。
     * 当主节点属于内置公共节点时，追加其余内置节点作为备用，
     * 任意一个可达即可成功组网，并保证与桌面端有共同可达中继；
     * 私有/自定义节点则保持隔离，仅返回该节点。
     */
    private fun buildPeerList(primary: String): List<String> {
        val builtinAddrs = BuiltinNodes.map { it.address }
        fun norm(s: String) = s.trim().trimEnd('/').lowercase()
        val isBuiltin = builtinAddrs.any { norm(it) == norm(primary) }
        if (!isBuiltin) return listOf(primary)
        val result = mutableListOf(primary)
        for (addr in builtinAddrs) {
            if (result.none { norm(it) == norm(addr) }) result.add(addr)
        }
        return result
    }

    /**
     * 解析 EasyTier 路由信息，返回 虚拟IP -> 连接类型 映射。
     * EasyTier 路由 cost 字段：1 表示直接相连(P2P 直连)，>1 表示经中继转发。
     * 解析失败时返回空表（UI 显示“未知”）。
     */
    fun peerConnectionTypes(): Map<String, String> {
        if (!EasyTierJNI.available) return emptyMap()
        val json = runCatching { EasyTierJNI.collectNetworkInfos(20) }.getOrNull() ?: return emptyMap()
        val result = HashMap<String, String>()
        // 在 routes 数组里匹配 每条路由的 ipv4 addr 与其后的 cost
        val regex = Regex(""""addr"\s*:\s*(-?\d+)[\s\S]{0,260}?"cost"\s*:\s*(\d+)""")
        regex.findAll(json).forEach { m ->
            val addr = m.groupValues[1].toLongOrNull() ?: return@forEach
            val cost = m.groupValues[2].toIntOrNull() ?: return@forEach
            val unsigned = addr and 0xFFFF_FFFFL
            val ip = listOf(
                (unsigned shr 24) and 0xFF, (unsigned shr 16) and 0xFF,
                (unsigned shr 8) and 0xFF, unsigned and 0xFF,
            ).joinToString(".")
            // 仅记录大厅网段内的对端
            if (ip.startsWith("10.126.")) {
                result[ip] = if (cost <= 1) "p2p" else "relay"
            }
        }
        return result
    }

    private companion object {
        private const val TAG = "NetworkController"
    }
}
