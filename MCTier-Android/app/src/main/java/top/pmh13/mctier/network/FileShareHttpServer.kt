package top.pmh13.mctier.network

import android.content.Context
import android.net.Uri
import androidx.documentfile.provider.DocumentFile
import fi.iki.elonen.NanoHTTPD
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import top.pmh13.mctier.data.FileSharePort
import top.pmh13.mctier.data.MctierJson
import top.pmh13.mctier.data.SharedFolder
import java.net.URLDecoder

/**
 * 文件共享 HTTP 服务。
 *
 * [bindIp] 为 EasyTier 分配的虚拟网卡地址。只绑定该地址（而非 `0.0.0.0`），
 * 可避免服务同时暴露在 Wi-Fi / 蜂窝等物理网络接口上被同网段任意设备访问。
 * 若调用方暂时拿不到虚拟 IP，会退回 `0.0.0.0` 以保证功能可用（见 issue #17）。
 */
class FileShareHttpServer(
    private val context: Context,
    private val ownerId: String,
    bindIp: String = DEFAULT_BIND_IP,
) : NanoHTTPD(bindIp.ifBlank { DEFAULT_BIND_IP }, FileSharePort) {
    private val folders = linkedMapOf<String, SharedFolder>()

    /**
     * 允许访问共享的大厅成员虚拟 IP 集合。
     *
     * EasyTier 的网络名与密钥在大厅存续期间不变，被房主移出大厅的玩家仍可能留在
     * 虚拟网内。若不校验来源，其仍能继续浏览与下载本机共享内容。
     */
    @Volatile
    private var allowedPeers: Set<String> = emptySet()

    /** 更新可访问成员集合（含自己，便于本机自查） */
    fun setAllowedPeers(ips: Collection<String>) {
        allowedPeers = ips.filter { it.isNotBlank() }.toSet()
    }

    /** 清空可访问成员集合（退出大厅时调用） */
    fun clearAllowedPeers() {
        allowedPeers = emptySet()
    }

    /**
     * 判断调用方是否仍是本大厅成员。
     *
     * 与桌面端一致：名单为空时放行（尚未下发或对端为旧版本），
     * 名单非空则要求来源 IP 在册。
     */
    internal fun isLobbyMember(remoteIp: String?): Boolean {
        val allowed = allowedPeers
        if (allowed.isEmpty()) return true
        if (remoteIp.isNullOrBlank()) return true
        return allowed.contains(normalizeIp(remoteIp))
    }

    /** 归一化来源地址：去掉 IPv6 映射前缀，便于与名单里的 IPv4 文本比较。 */
    private fun normalizeIp(raw: String): String {
        val ip = raw.trim()
        return if (ip.startsWith("::ffff:")) ip.removePrefix("::ffff:") else ip
    }

    fun addFolder(folder: SharedFolder) {
        folders[folder.id] = folder
    }

    fun removeFolder(id: String) {
        folders.remove(id)
    }

    fun currentFolders(): List<SharedFolder> = folders.values.toList()

    override fun serve(session: IHTTPSession): Response {
        val origin = LanCors.originOf(session)
        if (session.method == Method.OPTIONS) {
            return withCors(newFixedLengthResponse(Response.Status.OK, "text/plain", ""), origin)
        }
        val path = session.uri.orEmpty()
        // 成员校验：非本大厅成员一律拒绝浏览与下载
        if (!isLobbyMember(session.remoteIpAddress)) {
            return withCors(forbidden(), origin)
        }
        val response = when {
            path == "/api/shares" -> json(ShareListResponse(folders.values.map { it.toDto() }))
            path.matches(Regex("/api/shares/[^/]+/files")) -> listFiles(path, session)
            path.contains("/download/") -> download(path, session)
            else -> newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "not found")
        }
        return withCors(response, origin)
    }

    /**
     * 为响应附加跨域头。
     *
     * 只对白名单内的来源回写 `Access-Control-Allow-Origin`（详见 [LanCors]），
     * 避免虚拟网内任意网页在浏览器里读取本机共享列表。
     */
    private fun withCors(response: Response, origin: String?): Response =
        LanCors.apply(response, origin)

    private fun listFiles(path: String, session: IHTTPSession): Response {
        val shareId = path.split("/").getOrNull(3) ?: return missing()
        val share = folders[shareId] ?: return missing()
        if (!checkPassword(share, session)) return unauthorized()
        val requestedPath = session.parameters["path"]?.firstOrNull().orEmpty()
        val root = DocumentFile.fromTreeUri(context, Uri.parse(share.uri)) ?: return missing()
        val folder = findDocument(root, requestedPath) ?: return missing()
        val files = folder.listFiles().map {
            SharedFileInfo(
                name = it.name.orEmpty(),
                path = listOf(requestedPath, it.name.orEmpty()).filter { part -> part.isNotBlank() }.joinToString("/"),
                size = it.length(),
                isDir = it.isDirectory,
                modified = it.lastModified(),
            )
        }.sortedWith(compareBy<SharedFileInfo> { !it.isDir }.thenBy { it.name.lowercase() })
        return json(FileList(files, requestedPath))
    }

    private fun download(path: String, session: IHTTPSession): Response {
        val shareId = path.split("/").getOrNull(3) ?: return missing()
        val rawFilePath = path.substringAfter("/api/shares/$shareId/download/", "")
        val share = folders[shareId] ?: return missing()
        if (!checkPassword(share, session)) return unauthorized()
        val root = DocumentFile.fromTreeUri(context, Uri.parse(share.uri)) ?: return missing()
        val target = findDocument(root, URLDecoder.decode(rawFilePath, "UTF-8")) ?: return missing()
        if (target.isDirectory) return newFixedLengthResponse(Response.Status.BAD_REQUEST, "text/plain", "directory")
        val fileLen = target.length()
        val rangeHeader = session.headers["range"]
        // 断点续传：解析 Range: bytes=start- 头，返回 206 PARTIAL_CONTENT
        if (!rangeHeader.isNullOrBlank() && rangeHeader.startsWith("bytes=") && fileLen > 0) {
            val spec = rangeHeader.removePrefix("bytes=").substringBefore(",")
            val start = spec.substringBefore("-").toLongOrNull() ?: 0L
            val end = spec.substringAfter("-", "").toLongOrNull() ?: (fileLen - 1)
            if (start in 0 until fileLen) {
                val realEnd = end.coerceIn(start, fileLen - 1)
                val len = realEnd - start + 1
                val input = context.contentResolver.openInputStream(target.uri) ?: return missing()
                var skipped = 0L
                while (skipped < start) {
                    val s = input.skip(start - skipped)
                    if (s <= 0) break
                    skipped += s
                }
                return newFixedLengthResponse(Response.Status.PARTIAL_CONTENT, "application/octet-stream", input, len).apply {
                    addHeader("Content-Disposition", "attachment; filename=\"${target.name.orEmpty()}\"")
                    addHeader("Accept-Ranges", "bytes")
                    addHeader("Content-Range", "bytes $start-$realEnd/$fileLen")
                }
            }
        }
        val input = context.contentResolver.openInputStream(target.uri) ?: return missing()
        return if (fileLen > 0) {
            newFixedLengthResponse(Response.Status.OK, "application/octet-stream", input, fileLen).apply {
                addHeader("Content-Disposition", "attachment; filename=\"${target.name.orEmpty()}\"")
                addHeader("Accept-Ranges", "bytes")
            }
        } else {
            newChunkedResponse(Response.Status.OK, "application/octet-stream", input).apply {
                addHeader("Content-Disposition", "attachment; filename=\"${target.name.orEmpty()}\"")
            }
        }
    }

    private fun checkPassword(share: SharedFolder, session: IHTTPSession): Boolean {
        val expected = share.password
        if (expected.isNullOrEmpty()) return true
        return constantTimeEquals(session.headers["x-share-password"].orEmpty(), expected)
    }

    /**
     * 常量时间字符串比较，避免通过响应耗时逐字节爆破共享密码。
     *
     * 与桌面端 `ct_eq` 保持一致：长度不同直接判否，长度相同则始终比较全部字节。
     */
    private fun constantTimeEquals(a: String, b: String): Boolean {
        val left = a.toByteArray(Charsets.UTF_8)
        val right = b.toByteArray(Charsets.UTF_8)
        if (left.size != right.size) return false
        var diff = 0
        for (i in left.indices) {
            diff = diff or (left[i].toInt() xor right[i].toInt())
        }
        return diff == 0
    }

    private fun findDocument(root: DocumentFile, relPath: String): DocumentFile? {
        if (relPath.isBlank()) return root
        if (relPath.contains("..")) return null
        return relPath.split("/").filter { it.isNotBlank() }.fold(root as DocumentFile?) { current, name ->
            current?.listFiles()?.firstOrNull { it.name == name }
        }
    }

    private inline fun <reified T> json(value: T): Response =
        newFixedLengthResponse(Response.Status.OK, "application/json", MctierJson.encodeToString(value))

    private fun missing(): Response = newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "not found")
    private fun forbidden(): Response = newFixedLengthResponse(Response.Status.FORBIDDEN, "text/plain", "forbidden")
    private fun unauthorized(): Response = newFixedLengthResponse(Response.Status.UNAUTHORIZED, "text/plain", "unauthorized")

    @Serializable
    private data class ShareListResponse(val shares: List<ShareDto>)

    /** 仅包含远程浏览所需的公开元数据，禁止泄漏 SAF URI 或共享密码。 */
    @Serializable
    private data class ShareDto(
        val id: String,
        val name: String,
        @kotlinx.serialization.SerialName("has_password") val hasPassword: Boolean,
        @kotlinx.serialization.SerialName("expire_time") val expireTime: Long? = null,
        @kotlinx.serialization.SerialName("compress_before_send") val compressBeforeSend: Boolean? = false,
        @kotlinx.serialization.SerialName("owner_id") val ownerId: String,
        @kotlinx.serialization.SerialName("created_at") val createdAt: Long,
    )

    private fun SharedFolder.toDto(): ShareDto = ShareDto(
        id = id,
        name = name,
        hasPassword = !password.isNullOrBlank(),
        expireTime = expireAt?.let { it / 1000 },
        compressBeforeSend = compressBeforeSend,
        ownerId = ownerId,
        createdAt = createdAt / 1000,
    )

    @Serializable
    private data class FileList(val files: List<SharedFileInfo>, val current_path: String)

    @Serializable
    private data class SharedFileInfo(
        val name: String,
        val path: String,
        val size: Long,
        @kotlinx.serialization.SerialName("is_dir") val isDir: Boolean,
        val modified: Long,
    )

    companion object {
        /** 兜底监听地址：仅在拿不到虚拟 IP 时使用。 */
        const val DEFAULT_BIND_IP = "0.0.0.0"
    }
}
