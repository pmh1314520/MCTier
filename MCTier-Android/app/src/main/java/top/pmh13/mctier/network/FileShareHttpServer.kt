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

class FileShareHttpServer(
    private val context: Context,
    private val ownerId: String,
) : NanoHTTPD("0.0.0.0", FileSharePort) {
    private val folders = linkedMapOf<String, SharedFolder>()

    fun addFolder(folder: SharedFolder) {
        folders[folder.id] = folder
    }

    fun removeFolder(id: String) {
        folders.remove(id)
    }

    fun currentFolders(): List<SharedFolder> = folders.values.toList()

    override fun serve(session: IHTTPSession): Response {
        if (session.method == Method.OPTIONS) {
            return withCors(newFixedLengthResponse(Response.Status.OK, "text/plain", ""))
        }
        val path = session.uri.orEmpty()
        val response = when {
            path == "/api/shares" -> json(ShareListResponse(folders.values.map { it.toDto() }))
            path.matches(Regex("/api/shares/[^/]+/files")) -> listFiles(path, session)
            path.contains("/download/") -> download(path, session)
            else -> newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "not found")
        }
        return withCors(response)
    }

    /** 为响应附加跨域头，确保桌面端 webview 能直接读取（对齐桌面端 permissive CORS） */
    private fun withCors(response: Response): Response {
        response.addHeader("Access-Control-Allow-Origin", "*")
        response.addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        response.addHeader("Access-Control-Allow-Headers", "*")
        response.addHeader("Access-Control-Max-Age", "86400")
        return response
    }

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
        val expected = share.password ?: return true
        return session.headers["x-share-password"].orEmpty() == expected
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
    private fun unauthorized(): Response = newFixedLengthResponse(Response.Status.UNAUTHORIZED, "text/plain", "unauthorized")

    @Serializable
    private data class ShareListResponse(val shares: List<ShareDto>)

    /** 与桌面端 Rust SharedFolder 结构体字段严格一致(snake_case + path)，否则桌面端解析报 missing field */
    @Serializable
    private data class ShareDto(
        val id: String,
        val name: String,
        val path: String,
        val password: String? = null,
        @kotlinx.serialization.SerialName("expire_time") val expireTime: Long? = null,
        @kotlinx.serialization.SerialName("compress_before_send") val compressBeforeSend: Boolean? = false,
        @kotlinx.serialization.SerialName("owner_id") val ownerId: String,
        @kotlinx.serialization.SerialName("created_at") val createdAt: Long,
    )

    private fun SharedFolder.toDto(): ShareDto = ShareDto(
        id = id,
        name = name,
        path = name, // 桌面端仅展示 name、用 id 调 API，path 仅占位
        password = password,
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
}
