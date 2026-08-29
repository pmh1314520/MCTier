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
import java.io.File
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

/**
 * 远端文件共享客户端：浏览并下载其他玩家（含电脑端）共享的文件。
 * 接口与桌面端 14539 文件服务器完全一致。
 */
class RemoteFileClient(private val context: Context) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(2, TimeUnit.SECONDS)
        .callTimeout(60, TimeUnit.SECONDS)
        .build()

    /** 浏览某个共享下的文件列表 */
    fun listShares(ownerIp: String): List<FileShareWire> {
        val url = "http://$ownerIp:$FileSharePort/api/shares"
        val req = Request.Builder().url(url).build()
        val quickClient = client.newBuilder().callTimeout(2, TimeUnit.SECONDS).build()
        quickClient.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) error("HTTP ${resp.code}")
            val text = resp.body?.string().orEmpty()
            val shares = MctierJson.decodeFromString(RemoteShareListResponse.serializer(), text).shares
            return shares.map {
                FileShareWire(
                    shareId = it.id,
                    shareName = it.name,
                    playerName = "",
                    hasPassword = it.hasPassword || !it.legacyPassword.isNullOrBlank(),
                )
            }
        }
    }

    fun listFiles(ownerIp: String, shareId: String, path: String, password: String?): List<RemoteFileInfo> {
        val url = buildString {
            append("http://$ownerIp:$FileSharePort/api/shares/$shareId/files")
            if (path.isNotBlank()) append("?path=").append(URLEncoder.encode(path, "UTF-8"))
        }
        val reqBuilder = Request.Builder().url(url)
        if (!password.isNullOrBlank()) reqBuilder.addHeader("x-share-password", password)
        client.newCall(reqBuilder.build()).execute().use { resp ->
            if (resp.code == 401) error("密码错误，请重试")
            if (!resp.isSuccessful) error("HTTP ${resp.code}")
            val text = resp.body?.string().orEmpty()
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
        downloadTreeUri: String = "",
        onProgress: ((downloaded: Long, total: Long) -> Unit)? = null,
        isCanceled: () -> Boolean = { false },
        onCall: ((okhttp3.Call) -> Unit)? = null,
    ): String {
        if (isCanceled()) throw CancellationException("下载已取消")
        val encodedPath = filePath.split("/").joinToString("/") { URLEncoder.encode(it, "UTF-8").replace("+", "%20") }
        val url = "http://$ownerIp:$FileSharePort/api/shares/$shareId/download/$encodedPath"
        val safeFileName = fileName.substringAfterLast('/').substringAfterLast('\\').trim()
        if (safeFileName.isBlank() || safeFileName == "." || safeFileName == "..") error("文件名无效")
        val customTree = downloadTreeUri.trim().takeIf { it.isNotEmpty() }?.let { uriText ->
            val tree = DocumentFile.fromTreeUri(context, Uri.parse(uriText))
                ?: error("自定义下载目录不可用，请重新选择文件夹")
            if (!tree.canWrite()) error("自定义下载目录没有写入权限，请重新选择文件夹")
            tree
        }
        val dir = if (customTree == null) File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "MCTier") else null
        if (dir != null && !dir.exists() && !dir.mkdirs()) error("无法创建默认下载目录")
        val outFile = dir?.let { File(it, safeFileName) }
        val partFile = dir?.let { File(it, "$safeFileName.part") }
        val customPart = customTree?.findFile("$safeFileName.part")
            ?: customTree?.createFile("application/octet-stream", "$safeFileName.part")
            ?: customTree?.let { error("无法创建临时下载文件") }
        // 断点续传：若存在 .part 文件，从已下载字节处继续
        val existing = customPart?.length() ?: partFile?.takeIf { it.exists() }?.length() ?: 0L

        val reqBuilder = Request.Builder().url(url)
        if (!password.isNullOrBlank()) reqBuilder.addHeader("x-share-password", password)
        if (existing > 0) reqBuilder.addHeader("Range", "bytes=$existing-")

        // 大文件下载使用更长（无限）超时
        val dlClient = client.newBuilder().callTimeout(0, TimeUnit.SECONDS).readTimeout(0, TimeUnit.SECONDS).build()
        val call = dlClient.newCall(reqBuilder.build())
        onCall?.invoke(call)
        call.execute().use { resp ->
            if (isCanceled()) throw CancellationException("下载已取消")
            if (resp.code == 401) error("密码错误，请重试")
            if (!resp.isSuccessful) error("HTTP ${resp.code}")
            val isResume = resp.code == 206
            val body = resp.body ?: error("空响应")
            val contentLen = body.contentLength().takeIf { it > 0 } ?: -1L
            val total = if (isResume && contentLen > 0) existing + contentLen else contentLen
            val startAt = if (isResume) existing else 0L
            // 206 续传则追加，否则从头写
            val append = isResume && existing > 0
            body.byteStream().use { input ->
                val output = if (customPart != null) {
                    context.contentResolver.openOutputStream(customPart.uri, if (append) "wa" else "w")
                } else {
                    java.io.FileOutputStream(partFile!!, append)
                } ?: error("无法写入下载文件")
                output.use { outputStream ->
                    val buf = ByteArray(64 * 1024)
                    var downloaded = startAt
                    while (true) {
                        if (isCanceled()) throw CancellationException("下载已取消")
                        val n = input.read(buf)
                        if (n < 0) break
                        if (isCanceled()) throw CancellationException("Download canceled")
                        outputStream.write(buf, 0, n)
                        downloaded += n
                        onProgress?.invoke(downloaded, total)
                    }
                }
            }
        }
        // 下载完成：去掉 .part 后缀
        if (customTree != null && customPart != null) {
            customTree.findFile(safeFileName)?.delete()
            if (!customPart.renameTo(safeFileName)) {
                val finalFile = customTree.createFile("application/octet-stream", safeFileName)
                    ?: error("无法创建最终下载文件")
                val input = context.contentResolver.openInputStream(customPart.uri)
                    ?: error("无法读取临时下载文件")
                val output = context.contentResolver.openOutputStream(finalFile.uri)
                    ?: error("无法写入最终下载文件")
                input.use { source -> output.use { target -> source.copyTo(target) } }
                customPart.delete()
            }
            return customTree.findFile(safeFileName)?.uri?.toString()
                ?: error("下载文件保存后无法访问")
        }
        if (outFile!!.exists()) outFile.delete()
        if (!partFile!!.renameTo(outFile)) {
            partFile.copyTo(outFile, overwrite = true); partFile.delete()
        }
        return outFile!!.absolutePath
    }

    @Serializable
    private data class RemoteShareListResponse(val shares: List<RemoteShareDto>)

    @Serializable
    private data class RemoteShareDto(
        val id: String,
        val name: String,
        @SerialName("has_password") val hasPassword: Boolean = false,
        // 仅用于兼容尚未升级的旧节点；不会继续暴露给 UI 或其他接口。
        @SerialName("password") val legacyPassword: String? = null,
        @SerialName("owner_id") val ownerId: String? = null,
    )
}
