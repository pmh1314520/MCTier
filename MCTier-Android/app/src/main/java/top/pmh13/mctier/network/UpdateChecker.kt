package top.pmh13.mctier.network

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import top.pmh13.mctier.data.AppClientVersion
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * 客户端内更新：从 Gitee 检测最新版本，下载 APK 并调起系统安装器。
 * 与桌面端一致使用 Gitee 仓库 peng-minghang/mctier。
 */
class UpdateChecker(private val context: Context) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .callTimeout(120, TimeUnit.SECONDS)
        .build()
    private val json = Json { ignoreUnknownKeys = true }
    private val tagsUrl = "https://gitee.com/api/v5/repos/peng-minghang/mctier/tags"
    private val latestReleaseUrl = "https://gitee.com/api/v5/repos/peng-minghang/mctier/releases/latest"

    /** 检测是否有新版本。回调在子线程触发，UI 层需切回主线程。 */
    fun check(onResult: (hasUpdate: Boolean, latest: String) -> Unit) {
        Thread {
            runCatching {
                client.newCall(Request.Builder().url(tagsUrl).build()).execute().use { resp ->
                    if (!resp.isSuccessful) { onResult(false, AppClientVersion); return@use }
                    val text = resp.body?.string().orEmpty()
                    val arr = json.parseToJsonElement(text).jsonArray
                    val latest = arr.lastOrNull()?.jsonObject?.get("name")?.jsonPrimitive?.content
                        ?.removePrefix("v") ?: AppClientVersion
                    onResult(compareVersions(latest, AppClientVersion) > 0, latest)
                }
            }.onFailure { onResult(false, AppClientVersion) }
        }.start()
    }

    /** 下载最新 APK 并调起安装器。回调在子线程触发。 */
    fun downloadAndInstall(onProgress: (Int) -> Unit, onError: (String) -> Unit) {
        Thread {
            runCatching {
                val relText = client.newCall(Request.Builder().url(latestReleaseUrl).build()).execute().use {
                    if (!it.isSuccessful) error("获取发行版失败 HTTP ${it.code}")
                    it.body?.string().orEmpty()
                }
                val assets = json.parseToJsonElement(relText).jsonObject["assets"]?.jsonArray
                    ?: error("发行版无附件")
                val apkUrl = assets.firstNotNullOfOrNull { el ->
                    val o = el.jsonObject
                    val name = o["name"]?.jsonPrimitive?.content.orEmpty()
                    if (name.endsWith(".apk", true)) o["browser_download_url"]?.jsonPrimitive?.content else null
                } ?: error("未找到 APK 安装包")

                val apk = File(context.getExternalFilesDir(null), "mctier-update.apk")
                client.newCall(Request.Builder().url(apkUrl).build()).execute().use { resp ->
                    if (!resp.isSuccessful) error("下载失败 HTTP ${resp.code}")
                    val body = resp.body ?: error("空响应")
                    val total = body.contentLength()
                    var downloaded = 0L
                    body.byteStream().use { input ->
                        apk.outputStream().use { out ->
                            val buf = ByteArray(8192)
                            var r: Int
                            while (input.read(buf).also { r = it } != -1) {
                                out.write(buf, 0, r)
                                downloaded += r
                                if (total > 0) onProgress((downloaded * 100 / total).toInt())
                            }
                        }
                    }
                }
                install(apk)
            }.onFailure { onError(it.message ?: "更新失败") }
        }.start()
    }

    private fun install(apk: File) {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", apk)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
    }

    private fun compareVersions(v1: String, v2: String): Int {
        val a = v1.removePrefix("v").split(".").map { it.toIntOrNull() ?: 0 }
        val b = v2.removePrefix("v").split(".").map { it.toIntOrNull() ?: 0 }
        for (i in 0 until maxOf(a.size, b.size)) {
            val x = a.getOrElse(i) { 0 }
            val y = b.getOrElse(i) { 0 }
            if (x != y) return x.compareTo(y)
        }
        return 0
    }
}
