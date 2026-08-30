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
import okhttp3.ResponseBody
import top.pmh13.mctier.data.AppClientVersion
import top.pmh13.mctier.data.AvailableUpdate
import top.pmh13.mctier.ui.L
import java.io.ByteArrayOutputStream
import java.nio.charset.StandardCharsets
import java.util.concurrent.TimeUnit

/**
 * 从 Gitee 检测最新版本和更新日志，安装包由官网引导用户手动下载。
 */
class UpdateChecker(private val context: Context) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .callTimeout(20, TimeUnit.SECONDS)
        // A version response must come from the pinned Gitee endpoint. Do not
        // allow a compromised redirect to supply update metadata.
        .followRedirects(false)
        .followSslRedirects(false)
        .build()
    private val json = Json { ignoreUnknownKeys = true }
    private val tagsUrl = "https://gitee.com/api/v5/repos/peng-minghang/mctier/tags?per_page=100&page=1"
    private val downloadWebsite = "https://mctier.pmhs.top"

    private companion object {
        const val MaxVersionResponseBytes = 256 * 1024L
        const val MaxTags = 100
        const val MaxReleaseNotesBytes = 8 * 1024
        val ReleaseVersionPattern = Regex("^v?(0|[1-9]\\d{0,8})\\.(0|[1-9]\\d{0,8})\\.(0|[1-9]\\d{0,8})$")
        val CommitShaPattern = Regex("^[0-9a-fA-F]{40}$")
    }

    /** 检测是否有新版本。回调在子线程触发，UI 层需切回主线程。 */
    fun check(onResult: (AvailableUpdate?) -> Unit) {
        Thread {
            runCatching {
                client.newCall(
                    Request.Builder()
                        .url(tagsUrl)
                        .header("Accept", "application/json")
                        .header("User-Agent", "MCTier-Android-update-check")
                        .build(),
                ).execute().use { resp ->
                    if (!resp.isSuccessful) { onResult(null); return@use }
                    val contentType = resp.header("Content-Type")?.lowercase()
                    if (contentType != null && !contentType.startsWith("application/json")) {
                        onResult(null)
                        return@use
                    }
                    val body = resp.body ?: run { onResult(null); return@use }
                    val text = readLimitedBody(body)
                    val arr = json.parseToJsonElement(text).jsonArray
                    if (arr.size > MaxTags) {
                        onResult(null)
                        return@use
                    }
                    val tags = arr.mapNotNull { element ->
                        val obj = element.jsonObject
                        val rawName = obj["name"]?.jsonPrimitive?.content ?: return@mapNotNull null
                        val version = normalizeReleaseVersion(rawName) ?: return@mapNotNull null
                        val sha = obj["commit"]?.jsonObject?.get("sha")?.jsonPrimitive?.content
                            ?: return@mapNotNull null
                        if (!CommitShaPattern.matches(sha)) return@mapNotNull null
                        val message = obj["message"]?.jsonPrimitive?.content.orEmpty()
                        if (message.toByteArray(StandardCharsets.UTF_8).size > MaxReleaseNotesBytes) {
                            return@mapNotNull null
                        }
                        UpdateTag(version, message)
                    }
                    val latestTag = tags.maxWithOrNull { left, right -> compareVersions(left.version, right.version) }
                    val latest = latestTag?.version
                    val current = normalizeReleaseVersion(AppClientVersion)
                    if (latest == null || current == null || compareVersions(latest, current) <= 0) {
                        onResult(null)
                        return@use
                    }
                    val releaseNotes = latestTag.notes
                        .lineSequence()
                        .map { it.trim().removePrefix("- ").trim() }
                        .take(64)
                        .filter { it.isNotBlank() }
                        .map { it.take(512) }
                        .toList()
                    onResult(AvailableUpdate(latest, releaseNotes))
                }
            }.onFailure { onResult(null) }
        }.start()
    }

    private data class UpdateTag(val version: String, val notes: String)

    private fun readLimitedBody(body: ResponseBody): String {
        val declaredLength = body.contentLength()
        if (declaredLength > MaxVersionResponseBytes) {
            throw IllegalArgumentException("版本响应过大")
        }
        val output = ByteArrayOutputStream(
            minOf(declaredLength.coerceAtLeast(0L), MaxVersionResponseBytes).toInt(),
        )
        val buffer = ByteArray(8192)
        var total = 0L
        body.byteStream().use { input ->
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                total += count
                if (total > MaxVersionResponseBytes) throw IllegalArgumentException("版本响应过大")
                output.write(buffer, 0, count)
            }
        }
        return output.toString(StandardCharsets.UTF_8.name())
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
        val a = v1.removePrefix("v").split(".").map { it.toIntOrNull() ?: return 0 }
        val b = v2.removePrefix("v").split(".").map { it.toIntOrNull() ?: return 0 }
        for (i in 0 until maxOf(a.size, b.size)) {
            val x = a.getOrElse(i) { 0 }
            val y = b.getOrElse(i) { 0 }
            if (x != y) return x.compareTo(y)
        }
        return 0
    }

    private fun normalizeReleaseVersion(value: String): String? {
        val match = ReleaseVersionPattern.matchEntire(value) ?: return null
        return "${match.groupValues[1]}.${match.groupValues[2]}.${match.groupValues[3]}"
    }
}
