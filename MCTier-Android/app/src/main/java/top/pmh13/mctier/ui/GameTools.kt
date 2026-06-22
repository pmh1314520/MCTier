package top.pmh13.mctier.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import top.pmh13.mctier.MctierUiState

private data class GamePreset(val zh: String, val en: String, val port: Int)

private val GAME_PRESETS = listOf(
    GamePreset("Minecraft Java", "Minecraft Java", 25565),
    GamePreset("我的世界 基岩版", "Minecraft Bedrock", 19132),
    GamePreset("泰拉瑞亚", "Terraria", 7777),
    GamePreset("饥荒联机版", "Don't Starve Together", 10999),
    GamePreset("Valheim 英灵神殿", "Valheim", 2456),
    GamePreset("CS/起源引擎", "CS / Source", 27015),
    GamePreset("异星工厂", "Factorio", 34197),
)

/** 游戏快连：常见游戏端口预设 + 列出每位成员可直连地址（一键复制） */
@Composable
fun GameQuickConnectDialog(state: MctierUiState, onDismiss: () -> Unit) {
    val ctx = LocalContext.current
    var selected by remember { mutableStateOf(0) }
    val port = GAME_PRESETS.getOrNull(selected)?.port ?: 25565
    val selfIp = state.lobby?.virtualIp ?: state.players.firstOrNull { it.id == state.playerId }?.virtualIp ?: ""
    val others = state.players.filter { it.id != state.playerId && !it.virtualIp.isNullOrBlank() }

    fun copy(text: String) {
        runCatching {
            val cm = ctx.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
            cm.setPrimaryClip(android.content.ClipData.newPlainText("MCTier", text))
            android.widget.Toast.makeText(ctx, L("已复制：", "Copied: ") + text, android.widget.Toast.LENGTH_SHORT).show()
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = { TextButton(onClick = onDismiss) { Text(L("关闭", "Close"), color = GrassGreen) } },
        title = { Text(L("游戏快连", "Game Quick-Connect"), color = TextPrimary, fontWeight = FontWeight.Bold) },
        containerColor = Panel,
        text = {
            Column {
                Text(
                    L("选择游戏后，把地址粘贴进游戏的「直接连接 / 输入IP」即可与好友联机。", "Pick a game, then paste the address into the game's Direct Connect / Enter IP."),
                    fontSize = 12.sp, color = TextPrimary.copy(alpha = 0.6f),
                )
                Spacer(Modifier.height(10.dp))
                // 游戏预设（横向滚动选择）
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
                    GAME_PRESETS.forEachIndexed { idx, g ->
                        val sel = idx == selected
                        Box(
                            Modifier.padding(end = 8.dp).clip(RoundedCornerShape(16.dp))
                                .background(if (sel) GrassGreen else PanelHigh)
                                .clickable { selected = idx }
                                .padding(horizontal = 12.dp, vertical = 6.dp),
                        ) { Text(L(g.zh, g.en), color = if (sel) Color.White else TextPrimary.copy(alpha = 0.85f), fontSize = 12.sp, fontWeight = if (sel) FontWeight.Bold else FontWeight.Normal) }
                    }
                }
                Spacer(Modifier.height(6.dp))
                Text(L("端口", "Port") + " $port", fontSize = 11.sp, color = GrassGreen)
                Spacer(Modifier.height(12.dp))

                Text(L("作为房主分享给好友", "Share as host"), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = TextPrimary)
                Spacer(Modifier.height(6.dp))
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(GrassGreen.copy(alpha = 0.12f)).padding(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(if (selfIp.isBlank()) L("未分配虚拟IP", "No virtual IP") else "$selfIp:$port", color = TextPrimary, modifier = Modifier.weight(1f), maxLines = 1)
                    if (selfIp.isNotBlank()) TextButton(onClick = { copy("$selfIp:$port") }) { Text(L("复制", "Copy"), color = GrassGreen) }
                }
                Spacer(Modifier.height(12.dp))
                Text(L("加入其他玩家", "Join others"), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = TextPrimary)
                Spacer(Modifier.height(6.dp))
                if (others.isEmpty()) {
                    Text(L("暂无其他玩家", "No other players"), fontSize = 12.sp, color = TextPrimary.copy(alpha = 0.5f))
                } else {
                    Box(Modifier.heightIn(max = 220.dp)) {
                        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            items(others, key = { it.id }) { p ->
                                val addr = "${p.virtualIp}:$port"
                                Row(
                                    Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(PanelHigh).padding(10.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Column(Modifier.weight(1f)) {
                                        Text(p.name, color = TextPrimary, fontWeight = FontWeight.SemiBold, maxLines = 1)
                                        Text(addr, color = TextPrimary.copy(alpha = 0.6f), fontSize = 12.sp, maxLines = 1)
                                    }
                                    TextButton(onClick = { copy(addr) }) { Text(L("复制", "Copy"), color = GrassGreen) }
                                }
                            }
                        }
                    }
                }
            }
        },
    )
}

private data class DiagRow(val name: String, val latency: Long?, val loss: Int)

/** 探测到某虚拟IP的延迟（连 14540 聊天端口估算 RTT），返回毫秒；null=不可达 */
internal suspend fun probeLatency(ip: String): Long? = withContext(Dispatchers.IO) {
    var ok = 0L
    var got = false
    runCatching {
        val start = System.currentTimeMillis()
        java.net.Socket().use { s ->
            s.connect(java.net.InetSocketAddress(ip, 14540), 800)
        }
        ok = System.currentTimeMillis() - start
        got = true
    }.onFailure {
        // 连接被拒绝也说明主机可达
        if (it is java.net.ConnectException && (it.message?.contains("refused", true) == true)) {
            got = true; ok = 1
        }
    }
    if (got) ok else null
}

/** 连接诊断：探测每位成员延迟/可达性，给出评分与优化建议 */
@Composable
fun ConnectionDiagnosticDialog(state: MctierUiState, onDismiss: () -> Unit) {
    var rows by remember { mutableStateOf<List<DiagRow>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    val others = state.players.filter { it.id != state.playerId && !it.virtualIp.isNullOrBlank() }

    LaunchedEffect(Unit) {
        loading = true
        val result = others.map { p ->
            val ip = p.virtualIp!!
            // 探测两次取可达样本均值
            val samples = listOf(probeLatency(ip), probeLatency(ip)).filterNotNull()
            val lat = if (samples.isEmpty()) null else samples.sum() / samples.size
            val loss = ((2 - samples.size) * 100) / 2
            DiagRow(p.name, lat, loss)
        }
        rows = result
        loading = false
    }

    val reachable = rows.filter { it.latency != null }
    val offline = rows.size - reachable.size
    val avg = if (reachable.isEmpty()) null else reachable.sumOf { it.latency ?: 0 } / reachable.size
    val maxLoss = rows.maxOfOrNull { it.loss } ?: 0
    var score = 100
    if (avg != null) { if (avg > 200) score -= 30 else if (avg > 100) score -= 15 }
    score -= offline * 25
    score -= minOf(30, maxLoss)
    score = score.coerceIn(0, 100)

    val suggestions = buildList {
        if (rows.isNotEmpty()) {
            if (avg != null && avg > 150) add(L("平均延迟偏高，可尝试更换更近的节点或开启「延迟优先」。", "High average latency. Try a closer node or enable Latency First."))
            if (maxLoss >= 50) add(L("存在明显丢包，建议检查 WiFi 信号或改用更稳定的网络。", "Noticeable packet loss. Check Wi-Fi or use a more stable network."))
            if (offline > 0) add(L("$offline 位成员暂时不可达，可能对方未就绪或网络受限。", "$offline member(s) unreachable; they may not be ready or restricted."))
            if (isEmpty()) add(L("连接质量良好，无需调整。", "Connection quality is good."))
        }
    }
    val scoreColor = if (score >= 80) GrassGreen else if (score >= 50) Color(0xFFF59E0B) else DangerRed

    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = { TextButton(onClick = onDismiss) { Text(L("关闭", "Close"), color = GrassGreen) } },
        title = { Text(L("连接诊断", "Connection Diagnostics"), color = TextPrimary, fontWeight = FontWeight.Bold) },
        containerColor = Panel,
        text = {
            Column {
                if (loading) {
                    Text(L("正在诊断连接质量…", "Diagnosing..."), color = TextPrimary.copy(alpha = 0.7f))
                } else if (rows.isEmpty()) {
                    Text(L("暂无其他成员可诊断", "No other members to diagnose"), color = TextPrimary.copy(alpha = 0.6f))
                } else {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("$score", color = scoreColor, fontSize = 34.sp, fontWeight = FontWeight.Bold)
                        Spacer(Modifier.width(12.dp))
                        Column {
                            Text(L("连接评分", "Score"), color = TextPrimary.copy(alpha = 0.6f), fontSize = 12.sp)
                            Text(L("平均延迟 ", "Avg ") + (avg?.let { "${it}ms" } ?: "—") + L("　不可达 ", "  offline ") + offline, color = TextPrimary.copy(alpha = 0.8f), fontSize = 12.sp)
                        }
                    }
                    Spacer(Modifier.height(10.dp))
                    Box(Modifier.heightIn(max = 200.dp)) {
                        LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            items(rows, key = { it.name }) { r ->
                                Row(
                                    Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(PanelHigh).padding(horizontal = 10.dp, vertical = 8.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Text(r.name, color = TextPrimary, modifier = Modifier.weight(1f), maxLines = 1)
                                    val c = if (r.latency == null) DangerRed else if (r.latency < 80) GrassGreen else if (r.latency < 200) Color(0xFFF59E0B) else Color(0xFFFF8A3D)
                                    Text(if (r.latency == null) L("不可达", "Offline") else "${r.latency}ms", color = c, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                                }
                            }
                        }
                    }
                    if (suggestions.isNotEmpty()) {
                        Spacer(Modifier.height(10.dp))
                        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(GrassGreen.copy(alpha = 0.10f)).padding(10.dp)) {
                            Text(L("优化建议", "Suggestions"), color = GrassGreen, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                            suggestions.forEach { s ->
                                Text("· $s", color = TextPrimary.copy(alpha = 0.8f), fontSize = 12.sp)
                            }
                        }
                    }
                }
            }
        },
    )
}
