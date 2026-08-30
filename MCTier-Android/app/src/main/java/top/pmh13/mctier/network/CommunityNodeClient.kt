package top.pmh13.mctier.network

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import top.pmh13.mctier.data.CommunityNodeListWire
import top.pmh13.mctier.data.CommunityNodeSubmitResultWire
import top.pmh13.mctier.data.CommunityNodeSubmitWire
import top.pmh13.mctier.data.CommunityNodeWire
import top.pmh13.mctier.data.MctierJson
import top.pmh13.mctier.data.MctierWireJson
import top.pmh13.mctier.ui.L
import java.util.concurrent.TimeUnit

/**
 * 用户共享节点客户端：建立一次性 WebSocket（无需注册大厅）查询/投稿共享节点。
 * 与桌面端 community-node-list-request / community-node-submit 协议一致。
 *
 * 节点存活判定与「失效超过 1 天自动移除」都在信令服务器侧完成，这里不做本地判活。
 */
class CommunityNodeClient {
    private val client = OkHttpClient.Builder()
        .connectTimeout(6, TimeUnit.SECONDS)
        .build()

    /** 查询共享节点列表 */
    fun fetch(
        signalingUrl: String,
        onResult: (List<CommunityNodeWire>) -> Unit,
        onError: (String) -> Unit,
    ) {
        exchange(
            signalingUrl = signalingUrl,
            payload = "{\"type\":\"community-node-list-request\"}",
            expectType = "community-node-list-response",
            timeoutMs = 8000,
            parse = { text ->
                MctierJson.decodeFromString(CommunityNodeListWire.serializer(), text).nodes
            },
            onResult = onResult,
            onError = onError,
        )
    }

    /**
     * 投稿共享节点。
     *
     * 服务器会先探测地址可达性再决定是否入库，所以超时给得比查询更宽。
     */
    fun submit(
        signalingUrl: String,
        name: String,
        address: String,
        submitter: String?,
        onResult: (CommunityNodeSubmitResultWire) -> Unit,
        onError: (String) -> Unit,
    ) {
        val body = MctierWireJson.encodeToString(
            CommunityNodeSubmitWire.serializer(),
            CommunityNodeSubmitWire(
                name = name.trim(),
                address = address.trim(),
                submitter = submitter?.trim()?.takeIf { it.isNotBlank() },
            ),
        )
        exchange(
            signalingUrl = signalingUrl,
            payload = body,
            expectType = "community-node-submit-result",
            timeoutMs = 15000,
            parse = { text ->
                MctierJson.decodeFromString(CommunityNodeSubmitResultWire.serializer(), text)
            },
            onResult = onResult,
            onError = onError,
        )
    }

    /**
     * 发一条消息并等待指定 type 的响应，然后关闭连接。
     *
     * 查询与投稿的连接生命周期完全一致，抽出来复用；任何路径都保证 socket 被关闭，
     * 且 onResult/onError 只会触发一次。
     */
    private fun <T> exchange(
        signalingUrl: String,
        payload: String,
        expectType: String,
        timeoutMs: Long,
        parse: (String) -> T,
        onResult: (T) -> Unit,
        onError: (String) -> Unit,
    ) {
        // 用 AtomicBoolean 而不是普通局部变量：回调来自 OkHttp 的读线程，
        // 兜底超时来自 dispatcher 线程池，二者会并发竞争这个"只完成一次"的开关。
        val done = java.util.concurrent.atomic.AtomicBoolean(false)
        fun finishOnce(block: () -> Unit) {
            if (done.compareAndSet(false, true)) block()
        }

        val ws = client.newWebSocket(
            Request.Builder().url(signalingUrl).build(),
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    webSocket.send(payload)
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    // 只认目标 type，其它消息（如 pong）忽略
                    val type = runCatching {
                        MctierJson.decodeFromString(CommunityNodeListWire.serializer(), text).type
                    }.getOrNull()
                    if (type != expectType) return
                    val parsed = runCatching { parse(text) }.getOrNull() ?: return
                    finishOnce {
                        onResult(parsed)
                        webSocket.close(1000, "done")
                    }
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    finishOnce { onError(t.message ?: L("连接失败", "Connection failed")) }
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    // 服务器先关连接时不要让调用方一直挂着
                    finishOnce { onError(L("信令服务器已关闭连接", "Signaling server closed the connection")) }
                }
            },
        )

        // 兜底超时
        client.dispatcher.executorService.execute {
            Thread.sleep(timeoutMs)
            finishOnce {
                ws.cancel()
                onError(L("请求超时", "Request timed out"))
            }
        }
    }
}