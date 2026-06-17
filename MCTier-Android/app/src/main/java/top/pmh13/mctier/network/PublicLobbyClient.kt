package top.pmh13.mctier.network

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import top.pmh13.mctier.data.MctierJson
import top.pmh13.mctier.data.PublicLobbyWire
import top.pmh13.mctier.data.SignalingEnvelope
import java.util.concurrent.TimeUnit

/**
 * 公开广场客户端：建立一次性 WebSocket（无需注册大厅）拉取公开大厅列表。
 * 与桌面端 public-lobby-list-request/response 协议一致。
 */
class PublicLobbyClient {
    private val client = OkHttpClient.Builder()
        .connectTimeout(6, TimeUnit.SECONDS)
        .build()

    fun fetch(signalingUrl: String, onResult: (List<PublicLobbyWire>) -> Unit, onError: (String) -> Unit) {
        var done = false
        val ws = client.newWebSocket(
            Request.Builder().url(signalingUrl).build(),
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    webSocket.send("{\"type\":\"public-lobby-list-request\"}")
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    runCatching { MctierJson.decodeFromString(SignalingEnvelope.serializer(), text) }
                        .getOrNull()
                        ?.let { env ->
                            if (env.type == "public-lobby-list-response" && !done) {
                                done = true
                                onResult(env.lobbies.orEmpty())
                                webSocket.close(1000, "done")
                            }
                        }
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    if (!done) {
                        done = true
                        onError(t.message ?: "连接失败")
                    }
                }
            },
        )
        // 8 秒兜底超时
        client.dispatcher.executorService.execute {
            Thread.sleep(8000)
            if (!done) {
                done = true
                ws.cancel()
                onError("请求超时")
            }
        }
    }
}
