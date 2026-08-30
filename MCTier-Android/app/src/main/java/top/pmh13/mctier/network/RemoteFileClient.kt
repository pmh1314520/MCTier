package top.pmh13.mctier.network

import android.content.Context
import android.net.Uri
import android.os.Environment
import androidx.documentfile.provider.DocumentFile
import okhttp3.OkHttpClient
import okhttp3.Request
import top.pmh13.mctier.data.FileSharePort
import top.pmh13.mctier.data.FileShareWire
import top.pmh13.mctier.data.MctierJson
import top.pmh13.mctier.data.RemoteFileInfo
import top.pmh13.mctier.data.RemoteFileListResponse
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.coroutines.CancellationException
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.Inet4Address
import java.net.InetAddress
import java.net.URLEncoder
import java.nio.file.FileAlreadyExistsException
import java.nio.file.Files
import java.nio.file.StandardOpenOption
import java.util.UUID
import java.util.concurrent.TimeUnit

private const val MaxRemoteFileBytes = 2L * 1024 * 1024 * 1024
private const val MaxRemoteMetadataBytes = 4L * 1024 * 1024
private const val LobbyTokenHeader = "x-mctier-lobby-token"

/**
 * 远端文件共享客户端：浏览并下载其他玩家（含电脑端）共享的文件。
 * 接口与桌面端 14539 文件服务器完全一致。
 */
class RemoteFileClient(private val context: Context) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(2, TimeUnit.SECONDS)
        .callTimeout(60, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .build()

    private fun overlayHost(raw: String): String {
        val value = raw.trim()
        require(value.matches(Regex("[0-9.]+"))) { "目标不是有效的 EasyTier 虚拟 IPv4" }
        val address = runCatching { InetAddress.getByName(value) }.getOrNull()
            ?: error("目标不是有效的 EasyTier 虚拟 IPv4")
        require(
            address is Inet4Address &&
                address.address.sliceArray(0..2).contentEquals(byteArrayOf(10, 126, 126)) &&
                !address.isAnyLocalAddress &&
                !address.isLoopbackAddress &&
                !address.isLinkLocalAddress &&
                !address.isMulticastAddress &&
                address.hostAddress != "255.255.255.255"
        ) { "目标 IP 不在允许的虚拟网络范围内" }
        return address.hostAddress ?: error("目标 IP 无效")
    }

    private fun pathSegment(value: String): String =
        URLEncoder.encode(value, "UTF-8").replace("+", "%20")

    private fun Request.Builder.authorizeLobby(token: String): Request.Builder {
        require(token.length == 64 && token.all { it.isDigit() || it.lowercaseChar() in 'a'..'f' }) {
            "大厅文件认证凭据无效"
        }
        return addHeader(LobbyTokenHeader, token)
    }

    private fun readBodyLimited(body: okhttp3.ResponseBody?): String {
        val responseBody = body ?: return ""
        val advertisedLength = responseBody.contentLength()
        if (advertisedLength > MaxRemoteMetadataBytes) {
            error("远程响应超过元数据大小限制")
        }
        responseBody.byteStream().use { input ->
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(16 * 1024)
            var total = 0L
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                val nextTotal = total + count.toLong()
                if (nextTotal < total || nextTotal > MaxRemoteMetadataBytes) {
                    error("远程响应超过元数据大小限制")
                }
                output.write(buffer, 0, count)
                total = nextTotal
            }
            return String(output.toByteArray(), Charsets.UTF_8)
        }
    }

    /** 浏览某个共享下的文件列表 */
    fun listShares(ownerIp: String, lobbyToken: String): List<FileShareWire> {
        val host = overlayHost(ownerIp)
        val url = "http://$host:$FileSharePort/api/shares"
        val req = Request.Builder().url(url).authorizeLobby(lobbyToken).build()
        val quickClient = client.newBuilder().callTimeout(2, TimeUnit.SECONDS).build()
        quickClient.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) error("HTTP ${resp.code}")
            val text = readBodyLimited(resp.body)
            val shares = MctierJson.decodeFromString(RemoteShareListResponse.serializer(), text).shares
            return shares.map {
                FileShareWire(
                    shareId = it.id,
                    shareName = it.name,
                    playerName = "",
                    hasPassword = it.hasPassword,
                )
            }
        }
    }

    fun listFiles(ownerIp: String, shareId: String, path: String, password: String?, lobbyToken: String): List<RemoteFileInfo> {
        val host = overlayHost(ownerIp)
        val url = buildString {
            append("http://$host:$FileSharePort/api/shares/${pathSegment(shareId)}/files")
            if (path.isNotBlank()) append("?path=").append(URLEncoder.encode(path, "UTF-8"))
        }
        val reqBuilder = Request.Builder().url(url).authorizeLobby(lobbyToken)
        if (!password.isNullOrBlank()) reqBuilder.addHeader("x-share-password", password)
        client.newCall(reqBuilder.build()).execute().use { resp ->
            if (resp.code == 401) error("密码错误，请重试")
            if (resp.code == 410) error("共享已过期")
            if (!resp.isSuccessful) error("HTTP ${resp.code}")
            val text = readBodyLimited(resp.body)
            return MctierJson.decodeFromString(RemoteFileListResponse.serializer(), text).files
        }
    }

    /** 下载单个文件到“下载”目录，支持断点续传与进度回调，返回保存的绝对路径 */
    fun download(
        ownerIp: String,
        shareId: String,
        filePath: String,
        fileName: String,
        password: String?,
        lobbyToken: String,
        downloadTreeUri: String = "",
        expectedSize: Long? = null,
        onProgress: ((downloaded: Long, total: Long) -> Unit)? = null,
        isCanceled: () -> Boolean = { false },
        onCall: ((okhttp3.Call) -> Unit)? = null,
    ): String {
        if (isCanceled()) throw CancellationException("下载已取消")
        require(expectedSize == null || expectedSize in 0L..MaxRemoteFileBytes) {
            "文件超过远程下载大小限制"
        }
        val host = overlayHost(ownerIp)
        val encodedPath = filePath.split("/").joinToString("/") { URLEncoder.encode(it, "UTF-8").replace("+", "%20") }
        val url = "http://$host:$FileSharePort/api/shares/${pathSegment(shareId)}/download/$encodedPath"
        val safeFileName = validateRemoteFileName(fileName)
        val customTree = downloadTreeUri.trim().takeIf { it.isNotEmpty() }?.let { uriText ->
            val tree = DocumentFile.fromTreeUri(context, Uri.parse(uriText))
                ?: error("自定义下载目录不可用，请重新选择文件夹")
            if (!tree.canWrite()) error("自定义下载目录没有写入权限，请重新选择文件夹")
            tree
        }
        val externalDir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
            ?: error("默认下载目录不可用")
        val dir = if (customTree == null) File(externalDir, "MCTier") else null
        if (dir != null && !dir.exists() && !dir.mkdirs()) error("无法创建默认下载目录")
        if (dir != null && Files.isSymbolicLink(dir.toPath())) {
            error("下载目录不能是符号链接")
        }
        val canonicalDir = dir?.canonicalFile
        if (canonicalDir != null) {
            require(canonicalDir.isDirectory) { "下载目录不可用" }
        }
        val outFile = canonicalDir?.let { File(it, safeFileName) }
        val tempName = ".$safeFileName.${UUID.randomUUID()}.part"
        val partFile = canonicalDir?.let { File(it, tempName) }
        if (outFile?.exists() == true || customTree?.findFile(safeFileName) != null) {
            error("目标文件已存在")
        }
        val customPart = customTree?.createFile("application/octet-stream", tempName)
            ?: customTree?.let { error("无法创建临时下载文件") }
        if (customPart != null && customPart.name != tempName) {
            customPart.delete()
            error("临时下载文件名不匹配")
        }

        val reqBuilder = Request.Builder().url(url).authorizeLobby(lobbyToken)
        if (!password.isNullOrBlank() && password.isNotBlank()) reqBuilder.addHeader("x-share-password", password)

        // 大文件下载使用更长（无限）超时
        val dlClient = client.newBuilder().callTimeout(0, TimeUnit.SECONDS).readTimeout(0, TimeUnit.SECONDS).build()
        val call = dlClient.newCall(reqBuilder.build())
        onCall?.invoke(call)
        var committed = false
        try {
            var downloaded = 0L
            var contentLen = -1L
            call.execute().use { resp ->
                if (isCanceled()) throw CancellationException("下载已取消")
                if (resp.code == 401) error("密码错误，请重试")
                if (resp.code == 410) error("共享已过期")
                if (resp.code == 206) error("服务器返回了意外的部分响应")
                if (!resp.isSuccessful) error("HTTP ${resp.code}")
                val body = resp.body ?: error("空响应")
                contentLen = body.contentLength()
                if (contentLen > MaxRemoteFileBytes) {
                    error("响应超过远程下载大小限制")
                }
                if (expectedSize != null && contentLen >= 0 && expectedSize != contentLen) {
                    error("响应长度与预期不匹配")
                }
                body.byteStream().use { input ->
                    val output = if (customPart != null) {
                        context.contentResolver.openOutputStream(customPart.uri, "w")
                    } else {
                        Files.newOutputStream(
                            partFile!!.toPath(),
                            StandardOpenOption.CREATE_NEW,
                            StandardOpenOption.WRITE,
                        )
                    } ?: error("无法写入下载文件")
                    output.use { outputStream ->
                        val buf = ByteArray(64 * 1024)
                        while (true) {
                            if (isCanceled()) throw CancellationException("下载已取消")
                            val n = input.read(buf)
                            if (n < 0) break
                            if (isCanceled()) throw CancellationException("下载已取消")
                            val nextDownloaded = downloaded + n.toLong()
                            if (nextDownloaded < downloaded || nextDownloaded > MaxRemoteFileBytes) {
                                error("响应超过远程下载大小限制")
                            }
                            val expectedLength = expectedSize ?: contentLen.takeIf { it >= 0 }
                            if (expectedLength != null && nextDownloaded > expectedLength) {
                                error("响应内容超过预期长度")
                            }
                            outputStream.write(buf, 0, n)
                            downloaded = nextDownloaded
                            onProgress?.invoke(downloaded, expectedSize ?: contentLen)
                        }
                    }
                }
                val expectedLength = expectedSize ?: contentLen.takeIf { it >= 0 }
                if (expectedLength != null && downloaded != expectedLength) error("下载长度不匹配")
            }

            if (customTree != null && customPart != null) {
                if (customTree.findFile(safeFileName) != null) error("目标文件已存在")
                val finalFile = customTree.createFile("application/octet-stream", safeFileName)
                    ?: error("无法创建最终下载文件")
                if (finalFile.name != safeFileName) {
                    finalFile.delete()
                    error("目标文件名不匹配")
                }
                val sameName = customTree.findFile(safeFileName)
                if (sameName == null || sameName.uri != finalFile.uri) {
                    finalFile.delete()
                    error("目标文件已存在")
                }
                try {
                    val input = context.contentResolver.openInputStream(customPart.uri)
                        ?: error("无法读取临时下载文件")
                    val output = context.contentResolver.openOutputStream(finalFile.uri, "w")
                        ?: error("无法写入最终下载文件")
                    input.use { source -> output.use { target -> source.copyTo(target) } }
                    val expectedLength = expectedSize ?: contentLen.takeIf { it >= 0 }
                    if (expectedLength != null && finalFile.length() != expectedLength) {
                        error("最终文件长度不匹配")
                    }
                } catch (error: Throwable) {
                    finalFile.delete()
                    throw error
                }
                customPart.delete()
                committed = true
                return finalFile.uri.toString()
            }

            require(partFile != null && outFile != null) { "下载路径不可用" }
            val expectedLength = expectedSize ?: contentLen.takeIf { it >= 0 }
            if (expectedLength != null && partFile.length() != expectedLength) {
                error("临时文件长度不匹配")
            }
            try {
                Files.move(partFile.toPath(), outFile.toPath())
            } catch (_: FileAlreadyExistsException) {
                error("目标文件已存在")
            }
            committed = true
            return outFile.absolutePath
        } finally {
            if (!committed) {
                runCatching { partFile?.let { Files.deleteIfExists(it.toPath()) } }
                runCatching { customPart?.delete() }
            }
        }
    }

    @Serializable
    private data class RemoteShareListResponse(val shares: List<RemoteShareDto>)

    @Serializable
    private data class RemoteShareDto(
        val id: String,
        val name: String,
        @SerialName("has_password") val hasPassword: Boolean,
        @SerialName("owner_id") val ownerId: String? = null,
    )
}

internal fun validateRemoteFileName(fileName: String): String {
    require(fileName.isNotBlank() && fileName != "." && fileName != "..") { "文件名无效" }
    require(fileName.none { it == '/' || it == '\\' || it == '\u0000' || it.isISOControl() }) {
        "远端文件名必须是单个文件名"
    }
    return fileName
}
