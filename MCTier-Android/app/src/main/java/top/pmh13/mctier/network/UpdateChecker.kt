package top.pmh13.mctier.network

import android.content.Context
import android.content.Intent
import android.net.Uri
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import top.pmh13.mctier.data.AppClientVersion
import top.pmh13.mctier.data.AvailableUpdate
import top.pmh13.mctier.ui.L
import java.util.concurrent.TimeUnit

/**
 * 从 Gitee 检测最新版本和更新日志，安装包由官网引导用户手动下载。
 */
class UpdateChecker(private val context: Context) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .callTimeout(120, TimeUnit.SECONDS)
        .build()
    private val json = Json { ignoreUnknownKeys = true }
    private val tagsUrl = "https://gitee.com/api/v5/repos/peng-minghang/mctier/tags"
    private val downloadWebsite = "https://mctier.pmhs.top"

    /** 检测是否有新版本。回调在子线程触发，UI 层需切回主线程。 */
    fun check(onResult: (AvailableUpdate?) -> Unit) {
        Thread {
            runCatching {
                client.newCall(Request.Builder().url(tagsUrl).build()).execute().use { resp ->
                    if (!resp.isSuccessful) { onResult(null); return@use }
                    val text = resp.body?.string().orEmpty()
                    val arr = json.parseToJsonElement(text).jsonArray
                    val latestTag = arr.maxWithOrNull { left, right ->
                        val leftVersion = left.jsonObject["name"]?.jsonPrimitive?.content.orEmpty().removePrefix("v")
                        val rightVersion = right.jsonObject["name"]?.jsonPrimitive?.content.orEmpty().removePrefix("v")
                        compareVersions(leftVersion, rightVersion)
                    }
                    val latest = latestTag?.jsonObject?.get("name")?.jsonPrimitive?.content.orEmpty().removePrefix("v")
                    if (latest.isBlank() || compareVersions(latest, AppClientVersion) <= 0) {
                        onResult(null)
                        return@use
                    }
                    val releaseNotes = latestTag?.jsonObject?.get("message")?.jsonPrimitive?.content
                        .orEmpty()
                        .lineSequence()
                        .map { it.trim().removePrefix("- ").trim() }
                        .filter { it.isNotBlank() }
                        .toList()
                    onResult(AvailableUpdate(latest, releaseNotes))
                }
            }.onFailure { onResult(null) }
        }.start()
    }

    /** 版本仍从 Gitee 检测，安装包统一由官网引导用户手动下载。 */
    fun openDownloadWebsite(onError: (String) -> Unit = {}) {
        runCatching {
            context.startActivity(
                Intent(Intent.ACTION_VIEW, Uri.parse(downloadWebsite)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        }.onFailure { onError(it.message ?: L("无法打开官网", "Could not open website")) }
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
