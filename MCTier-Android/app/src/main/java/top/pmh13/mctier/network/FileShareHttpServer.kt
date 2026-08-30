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
import java.net.Inet4Address
import java.net.InetAddress
import java.net.URLDecoder
import java.util.ArrayDeque
import java.util.concurrent.ConcurrentHashMap

private const val MaxVerifyBodyBytes = 16 * 1024
private const val LobbyTokenHeader = "x-mctier-lobby-token"
private const val LobbyTokenHexLength = 64

private fun requireOverlayBindIp(bindIp: String): String {
    val candidate = bindIp.trim()
    require(candidate.isNotEmpty()) { "EasyTier virtual IP is required" }
    val numeric = candidate.all { it in '0'..'9' || it == '.' } && candidate.count { it == '.' } == 3
    require(numeric) { "EasyTier virtual IP must be a numeric address" }
    val address = runCatching { InetAddress.getByName(candidate) }
        .getOrNull()
        ?: error("EasyTier virtual IP is invalid")
    require(
        address is Inet4Address &&
            address.address.sliceArray(0..2).contentEquals(byteArrayOf(10, 126, 126)) &&
            (address.address[3].toInt() and 0xff) in 1..254
    ) {
        "EasyTier virtual IP must be a concrete overlay address"
    }
    return address.hostAddress ?: candidate
}

/**
 * 文件共享 HTTP 服务。
 *
 * [bindIp] 为 EasyTier 分配的虚拟网卡地址。只绑定该地址（而非 `0.0.0.0`），
 * 可避免服务同时暴露在 Wi-Fi / 蜂窝等物理网络接口上被同网段任意设备访问。
 */
class FileShareHttpServer(
    private val context: Context,
    private val ownerId: String,
    bindIp: String,
) : NanoHTTPD(requireOverlayBindIp(bindIp), FileSharePort) {
    private val folders = ConcurrentHashMap<String, SharedFolder>()
    private val passwordFailureLock = Any()
    private val passwordFailures = HashMap<String, ArrayDeque<Long>>()
    private val lobbyTokenLock = Any()
    private var lobbyToken: String? = null
    private var lobbyTokenEpoch: Long = 0L

    fun configureLobbyToken(token: String, epoch: Long): Boolean {
        if (token.length != LobbyTokenHexLength || token.any { !it.isDigit() && it.lowercaseChar() !in 'a'..'f' } || epoch <= 0L) {
            return false
        }
        synchronized(lobbyTokenLock) {
            if (epoch < lobbyTokenEpoch) return false
            if (epoch == lobbyTokenEpoch && lobbyToken != null && lobbyToken != token) return false
            lobbyToken = token
            lobbyTokenEpoch = epoch
        }
        return true
    }

    fun clearLobbyToken() = synchronized(lobbyTokenLock) {
        lobbyToken = null
        lobbyTokenEpoch = 0L
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
        if (!authenticateLobby(session)) {
            return withCors(unauthorized(), origin)
        }
        val path = session.uri.orEmpty()
        val response = when {
            path == "/api/shares" -> json(
                ShareListResponse(folders.values.filterNot { it.isExpired() }.map { it.toDto() })
            )
            path.matches(Regex("^/api/shares/[^/]+/files$")) && session.method == Method.GET -> listFiles(path, session)
            path.matches(Regex("^/api/shares/[^/]+/verify$")) && session.method == Method.POST -> verify(path, session)
            path.startsWith("/api/shares/") && path.contains("/download/") && session.method == Method.GET -> download(path, session)
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

    private fun authenticateLobby(session: IHTTPSession): Boolean {
        val expected = synchronized(lobbyTokenLock) { lobbyToken } ?: return false
        val supplied = session.headers.entries
            .filter { it.key.equals(LobbyTokenHeader, ignoreCase = true) }
            .singleOrNull()
            ?.value
            ?: return false
        return constantTimeEquals(supplied, expected)
    }

    private fun listFiles(path: String, session: IHTTPSession): Response {
        val shareId = path.split("/").getOrNull(3) ?: return missing()
        val share = folders[shareId] ?: return missing()
        if (share.isExpired()) return expired()
        if (!checkPassword(share, session)) return unauthorized()
        val requestedPath = session.parameters["path"]?.firstOrNull().orEmpty()
        val root = DocumentFile.fromTreeUri(context, Uri.parse(share.uri)) ?: return missing()
        val folder = findDocument(root, requestedPath) ?: return missing()
        val files = folder.listFiles().mapNotNull { document ->
            val name = document.name?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
            if (!document.isDirectory && !document.isFile) return@mapNotNull null
            SharedFileInfo(
                name = name,
                path = listOf(requestedPath, name).filter { part -> part.isNotBlank() }.joinToString("/"),
                size = document.length(),
                isDir = document.isDirectory,
                modified = document.lastModified(),
            )
        }.sortedWith(compareBy<SharedFileInfo> { !it.isDir }.thenBy { it.name.lowercase() })
        return json(FileList(files, requestedPath))
    }

    private fun download(path: String, session: IHTTPSession): Response {
        val shareId = path.split("/").getOrNull(3) ?: return missing()
        val rawFilePath = path.substringAfter("/api/shares/$shareId/download/", "")
        val share = folders[shareId] ?: return missing()
        if (share.isExpired()) return expired()
        if (!checkPassword(share, session)) return unauthorized()
        val root = DocumentFile.fromTreeUri(context, Uri.parse(share.uri)) ?: return missing()
        val decodedPath = runCatching { URLDecoder.decode(rawFilePath, "UTF-8") }.getOrNull()
            ?: return badRequest()
        val target = findDocument(root, decodedPath) ?: return missing()
        if (target.isDirectory) return newFixedLengthResponse(Response.Status.BAD_REQUEST, "text/plain", "directory")
        val fileLen = target.length()
        val rangeHeader = session.headers["range"]
        // 断点续传：解析 Range: bytes=start- 头，返回 206 PARTIAL_CONTENT
        if (!rangeHeader.isNullOrBlank()) {
            if (fileLen <= 0) return rangeNotSatisfiable(fileLen)
            val match = Regex("^bytes=(?:(\\d+)-(\\d*)|-(\\d+))$", RegexOption.IGNORE_CASE)
                .matchEntire(rangeHeader.trim())
                ?: return rangeNotSatisfiable(fileLen)
            val suffixText = match.groupValues[3]
            val (start, realEnd) = if (suffixText.isNotEmpty()) {
                val suffixLength = suffixText.toLongOrNull()
                    ?.takeIf { it > 0 }
                    ?: return rangeNotSatisfiable(fileLen)
                fileLen - suffixLength.coerceAtMost(fileLen) to fileLen - 1
            } else {
                val rangeStart = match.groupValues[1].toLongOrNull()
                    ?: return rangeNotSatisfiable(fileLen)
                val endText = match.groupValues[2]
                val rangeEnd = if (endText.isEmpty()) {
                    fileLen - 1
                } else {
                    endText.toLongOrNull()?.coerceAtMost(fileLen - 1)
                        ?: return rangeNotSatisfiable(fileLen)
                }
                if (rangeStart !in 0 until fileLen || rangeEnd < rangeStart) {
                    return rangeNotSatisfiable(fileLen)
                }
                rangeStart to rangeEnd
            }
            val len = realEnd - start + 1
            val input = context.contentResolver.openInputStream(target.uri) ?: return missing()
            var skipped = 0L
            while (skipped < start) {
                val amount = input.skip(start - skipped)
                if (amount <= 0) {
                    if (input.read() < 0) {
                        runCatching { input.close() }
                        return rangeNotSatisfiable(fileLen)
                    }
                    skipped += 1
                } else {
                    skipped += amount
                }
            }
            return newFixedLengthResponse(Response.Status.PARTIAL_CONTENT, "application/octet-stream", input, len).apply {
                addHeader("Content-Disposition", contentDisposition(target.name))
                addHeader("Accept-Ranges", "bytes")
                addHeader("Content-Range", "bytes $start-$realEnd/$fileLen")
            }
        }
        val input = context.contentResolver.openInputStream(target.uri) ?: return missing()
        return if (fileLen > 0) {
            newFixedLengthResponse(Response.Status.OK, "application/octet-stream", input, fileLen).apply {
                addHeader("Content-Disposition", contentDisposition(target.name))
                addHeader("Accept-Ranges", "bytes")
            }
        } else {
            // Some SAF providers report 0 when the length is unknown. A
            // chunked response preserves the content and is also valid for a
            // genuinely empty file.
            newChunkedResponse(Response.Status.OK, "application/octet-stream", input).apply {
                addHeader("Content-Disposition", contentDisposition(target.name))
                addHeader("Accept-Ranges", "bytes")
            }
        }
    }

    private fun verify(path: String, session: IHTTPSession): Response {
        val shareId = path.split("/").getOrNull(3) ?: return missing()
        val share = folders[shareId] ?: return missing()
        if (share.isExpired()) return expired()
        val body = readRequestBody(session) ?: return badRequest()
        val request = runCatching {
            MctierJson.decodeFromString(VerifyPasswordRequest.serializer(), body)
        }.getOrNull() ?: return badRequest()
        val expected = share.password?.takeIf { it.isNotBlank() }
        val success = expected == null || checkPassword(share, session, request.password)
        return json(VerifyPasswordResponse(success, if (success) "验证成功" else "密码错误"))
    }

    private fun readRequestBody(session: IHTTPSession): String? {
        if (session.headers.keys.any { it.equals("transfer-encoding", ignoreCase = true) }) return null
        val mediaType = session.headers.entries
            .firstOrNull { it.key.equals("content-type", ignoreCase = true) }
            ?.value
            ?.substringBefore(';')
            ?.trim()
        if (!mediaType.equals("application/json", ignoreCase = true)) return null
        val length = session.headers["content-length"]?.toLongOrNull() ?: return null
        if (length <= 0 || length > MaxVerifyBodyBytes) return null
        val bytes = ByteArray(length.toInt())
        var offset = 0
        while (offset < bytes.size) {
            val read = session.inputStream.read(bytes, offset, bytes.size - offset)
            if (read <= 0) return null
            offset += read
        }
        return String(bytes, Charsets.UTF_8)
    }

    private fun checkPassword(share: SharedFolder, session: IHTTPSession): Boolean {
        val expected = share.password?.takeIf { it.isNotBlank() } ?: return true
        return checkPassword(share, session, session.headers["x-share-password"].orEmpty(), expected)
    }

    private fun checkPassword(share: SharedFolder, session: IHTTPSession, supplied: String): Boolean {
        val expected = share.password?.takeIf { it.isNotBlank() } ?: return true
        return checkPassword(share, session, supplied, expected)
    }

    private fun checkPassword(
        share: SharedFolder,
        session: IHTTPSession,
        supplied: String,
        expected: String,
    ): Boolean {
        val key = "${session.remoteIpAddress}|${share.id}"
        val now = System.currentTimeMillis()
        synchronized(passwordFailureLock) {
            val iterator = passwordFailures.iterator()
            while (iterator.hasNext()) {
                val entry = iterator.next()
                while (entry.value.peekFirst()?.let { now - it > PasswordFailureWindowMs } == true) {
                    entry.value.removeFirst()
                }
                if (entry.value.isEmpty()) iterator.remove()
            }
            if (!passwordFailures.containsKey(key) && passwordFailures.size >= MaxPasswordFailureKeys) {
                return false
            }
            val failures = passwordFailures.getOrPut(key) { ArrayDeque() }
            if (failures.size >= MaxPasswordFailures) return false
        }

        val valid = constantTimeEquals(supplied, expected)
        synchronized(passwordFailureLock) {
            if (valid) {
                passwordFailures.remove(key)
            } else {
                passwordFailures.getOrPut(key) { ArrayDeque() }.addLast(now)
            }
        }
        return valid
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
        val parts = relPath.split('/')
        if (parts.any { it.isBlank() || it == "." || it == ".." || it.contains('\\') || it.contains('\u0000') }) {
            return null
        }
        return parts.fold(root as DocumentFile?) { current, name ->
            current?.listFiles()?.firstOrNull { it.name == name }
        }
    }

    private fun contentDisposition(name: String?): String {
        val safeName = name.orEmpty().map { ch ->
            if (ch == '"' || ch == '\\' || ch.isISOControl()) '_' else ch
        }.joinToString("").ifBlank { "download" }
        return "attachment; filename=\"$safeName\""
    }

    private fun SharedFolder.isExpired(nowMillis: Long = System.currentTimeMillis()): Boolean =
        expireAt?.let { it <= nowMillis } == true

    private inline fun <reified T> json(value: T): Response =
        newFixedLengthResponse(Response.Status.OK, "application/json", MctierJson.encodeToString(value))

    private fun missing(): Response = newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "not found")
    private fun badRequest(): Response = newFixedLengthResponse(Response.Status.BAD_REQUEST, "text/plain", "invalid request")
    private fun expired(): Response = newFixedLengthResponse(Response.Status.GONE, "text/plain", "share expired")
    private fun unauthorized(): Response = newFixedLengthResponse(Response.Status.UNAUTHORIZED, "text/plain", "unauthorized")
    private fun rangeNotSatisfiable(fileLen: Long): Response =
        newFixedLengthResponse(Response.Status.RANGE_NOT_SATISFIABLE, "text/plain", "range not satisfiable").apply {
            addHeader("Content-Range", "bytes */$fileLen")
            addHeader("Accept-Ranges", "bytes")
        }

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
        hasPassword = !password.isNullOrBlank() && password.isNotBlank(),
        expireTime = expireAt?.let { it / 1000 },
        compressBeforeSend = compressBeforeSend,
        ownerId = ownerId,
        createdAt = createdAt / 1000,
    )

    @Serializable
    private data class VerifyPasswordRequest(val password: String)

    @Serializable
    private data class VerifyPasswordResponse(val success: Boolean, val message: String)

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

    private companion object {
        const val MaxPasswordFailures = 10
        const val MaxPasswordFailureKeys = 4096
        const val PasswordFailureWindowMs = 30_000L
    }
}
