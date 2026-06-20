package top.pmh13.mctier.network

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.audiofx.LoudnessEnhancer
import android.net.Uri
import android.util.Log
import top.pmh13.mctier.R
import top.pmh13.mctier.data.UserSettings
import java.util.Calendar

/**
 * 音效提示：使用 MediaPlayer 播放桌面端同款音频(NewMsg/UserJoined/UserLeft)。
 *
 * 支持：
 * - 自定义提示音（用户选取的音频 URI，留空=内置默认音，支持一键恢复默认）
 * - 音量调节（0.0~1.0）
 * - 消息免打扰时段（时段内不播放任何提示音）
 *
 * 音量方案：使用 LoudnessEnhancer 对“本应用自己这条音轨(audioSession)”做增益，
 * 它【只】放大 MCTier 自己的提示音，不会改动系统媒体音量、也不会影响用户正在播放的
 * 视频/音乐。
 */
class SoundManager(private val context: Context) {

    @Volatile private var settings: UserSettings = UserSettings()

    fun applySettings(s: UserSettings) { settings = s }

    fun isSoundMuted(): Boolean = settings.soundMuted

    private val audioManager: AudioManager by lazy {
        context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    }

    /** 是否处于免打扰时段（支持跨午夜，如 22:00~08:00） */
    private fun inDndWindow(): Boolean {
        val s = settings
        if (!s.dndEnabled) return false
        val cal = Calendar.getInstance()
        val now = cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE)
        val start = s.dndStartMinutes
        val end = s.dndEndMinutes
        return if (start <= end) now in start until end
        else now >= start || now < end // 跨午夜
    }

    /** 播放默认内置音 */
    private fun play(resId: Int, ignoreDnd: Boolean = false) {
        if (!ignoreDnd && inDndWindow()) return
        runCatching {
            val mp = newPlayer()
            val afd = context.resources.openRawResourceFd(resId) ?: return
            afd.use { mp.setDataSource(it.fileDescriptor, it.startOffset, it.length) }
            preparePlay(mp)
        }.onFailure { Log.e(TAG, "播放音效失败 resId=$resId", it) }
    }

    /** 播放自定义音（URI），失败则回退到默认音 */
    private fun playCustomOrDefault(customUri: String, fallbackResId: Int, ignoreDnd: Boolean = false) {
        if (!ignoreDnd && inDndWindow()) return
        if (customUri.isBlank()) { play(fallbackResId, ignoreDnd); return }
        runCatching {
            val mp = newPlayer()
            mp.setDataSource(context, Uri.parse(customUri))
            preparePlay(mp)
        }.onFailure {
            Log.w(TAG, "自定义提示音播放失败，回退默认", it)
            play(fallbackResId, ignoreDnd)
        }
    }

    private fun newPlayer(): MediaPlayer {
        runCatching { audioManager.mode = AudioManager.MODE_NORMAL }
        val sessionId = runCatching { audioManager.generateAudioSessionId() }
            .getOrDefault(AudioManager.AUDIO_SESSION_ID_GENERATE)
        val mp = MediaPlayer()
        if (sessionId > 0) runCatching { mp.audioSessionId = sessionId }
        mp.setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build(),
        )
        return mp
    }

    private fun preparePlay(mp: MediaPlayer) {
        val vol = settings.soundVolume.coerceIn(0f, 1f)
        mp.setVolume(vol, vol)
        var enhancer: LoudnessEnhancer? = null
        fun cleanup(p: MediaPlayer) {
            runCatching { enhancer?.release() }
            runCatching { p.release() }
        }
        mp.setOnCompletionListener { cleanup(it) }
        mp.setOnErrorListener { p, what, extra ->
            Log.w(TAG, "MediaPlayer error what=$what extra=$extra")
            cleanup(p); true
        }
        mp.setOnPreparedListener { p ->
            enhancer = runCatching {
                LoudnessEnhancer(p.audioSessionId).apply {
                    setTargetGain(800) // 约 +8dB，文件已归一化
                    enabled = true
                }
            }.getOrNull()
            p.start()
        }
        mp.prepareAsync()
    }

    /** 收到新聊天消息 */
    fun message() { if (settings.soundMutedMsg) return; playCustomOrDefault(settings.customSoundMsg, R.raw.new_msg) }

    /** 有玩家加入大厅 */
    fun playerJoin() { if (settings.soundMutedJoin) return; playCustomOrDefault(settings.customSoundJoin, R.raw.user_joined) }

    /** 有玩家离开大厅 */
    fun playerLeave() { if (settings.soundMutedLeave) return; playCustomOrDefault(settings.customSoundLeave, R.raw.user_left) }

    fun previewMessage() = playCustomOrDefault(settings.customSoundMsg, R.raw.new_msg, ignoreDnd = true)

    fun previewPlayerJoin() = playCustomOrDefault(settings.customSoundJoin, R.raw.user_joined, ignoreDnd = true)

    fun previewPlayerLeave() = playCustomOrDefault(settings.customSoundLeave, R.raw.user_left, ignoreDnd = true)

    fun release() { /* MediaPlayer 实例在播放完成时已释放 */ }

    private companion object {
        private const val TAG = "SoundManager"
    }
}
