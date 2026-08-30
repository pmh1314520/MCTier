package top.pmh13.mctier.network

import fi.iki.elonen.NanoHTTPD

/**
 * 局域网 HTTP 服务的 CORS 策略（文件共享 / P2P 聊天共用）
 *
 * 这两个服务监听在 EasyTier 虚拟网卡上，同一大厅内的任意节点都能访问。
 * 原先返回 `Access-Control-Allow-Origin: *`，等于允许任意网页（包括虚拟网内
 * 其他节点打开的恶意页面）在浏览器里读取本机的共享文件列表与聊天内容，
 * 因此这里收紧为显式的来源白名单，只放行 MCTier 桌面端自己的 WebView 来源。
 *
 * 说明：Android / 桌面端之间互访使用 OkHttp、reqwest 等原生 HTTP 客户端，
 * 不发送 Origin 头，不受 CORS 限制，所以收紧策略不会影响跨端互通。
 */
internal object LanCors {

    /**
     * MCTier WebView 的合法来源，与桌面端 `http_cors.rs` 中的 ALLOWED_ORIGINS 保持一致。
     *
     * - Windows / Android：`http(s)://tauri.localhost`
     * - macOS / Linux：`tauri://localhost`
     * - `http://localhost:1420`：仅桌面端 `npm run tauri dev` 的 Vite 开发服务器
     */
    private val ALLOWED_ORIGINS = setOf(
        "http://tauri.localhost",
        "https://tauri.localhost",
        "tauri://localhost",
        "http://localhost:1420",
    )

    /** 允许 WebView 显式读取的响应头（断点续传与下载文件名需要）。 */
    private const val EXPOSED_HEADERS =
        "Content-Length, Content-Disposition, Content-Range, Accept-Ranges"

    /** 判断来源是否在白名单内。 */
    fun isAllowedOrigin(origin: String?): Boolean =
        !origin.isNullOrBlank() && ALLOWED_ORIGINS.contains(origin)

    /**
     * 为响应附加跨域头。
     *
     * 只有当请求来源命中白名单时才回写 `Access-Control-Allow-Origin`；
     * 其他来源不返回该头，浏览器便会拦截跨源读取。原生客户端不受影响。
     */
    fun apply(response: NanoHTTPD.Response, origin: String?): NanoHTTPD.Response {
        if (isAllowedOrigin(origin)) {
            response.addHeader("Access-Control-Allow-Origin", origin)
            response.addHeader("Vary", "Origin")
            response.addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            response.addHeader("Access-Control-Allow-Headers", "Content-Type, Range, X-Share-Password, X-MCTier-Chat-Token")
            response.addHeader("Access-Control-Expose-Headers", EXPOSED_HEADERS)
            response.addHeader("Access-Control-Max-Age", "86400")
        }
        return response
    }

    /** 从 nanohttpd 请求头中取 Origin（header 名已被 nanohttpd 转为小写）。 */
    fun originOf(session: NanoHTTPD.IHTTPSession): String? = session.headers["origin"]
}
