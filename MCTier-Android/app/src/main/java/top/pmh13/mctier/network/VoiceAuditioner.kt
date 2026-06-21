package top.pmh13.mctier.network

import android.annotation.SuppressLint
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * 变声器试听器（非通话场景）。
 * 打开麦克风采集 PCM，用 [VoiceProcessor] 按当前音色原地变声后，实时回放到扬声器，
 * 用户说话即可听到变声效果。
 *
 * 采集源使用 VOICE_COMMUNICATION 以启用系统硬件回声消除，减少外放回授；
 * 实时回放（不加延迟），避免输出被麦克风再次采集后层层叠加。
 */
object VoiceAuditioner {
    @Volatile private var running = false
    private var thread: Thread? = null

    val isRunning: Boolean get() = running

    @SuppressLint("MissingPermission")
    fun start(preset: String) {
        if (running) return
        running = true
        // 试听使用所选音色（与全局/大厅设置同步的 VoiceProcessor.preset 一致）
        VoiceProcessor.preset = preset
        thread = Thread {
            val sampleRate = 48000
            val channelIn = AudioFormat.CHANNEL_IN_MONO
            val channelOut = AudioFormat.CHANNEL_OUT_MONO
            val enc = AudioFormat.ENCODING_PCM_16BIT
            val minRec = AudioRecord.getMinBufferSize(sampleRate, channelIn, enc).coerceAtLeast(3840)
            val minPlay = AudioTrack.getMinBufferSize(sampleRate, channelOut, enc).coerceAtLeast(3840)
            val frame = 1920 // 20ms @48k mono 16bit = 960 samples * 2 bytes
            var record: AudioRecord? = null
            var track: AudioTrack? = null
            try {
                record = AudioRecord(
                    MediaRecorder.AudioSource.VOICE_COMMUNICATION,
                    sampleRate, channelIn, enc,
                    maxOf(minRec, frame * 8),
                )
                track = AudioTrack.Builder()
                    .setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build(),
                    )
                    .setAudioFormat(
                        AudioFormat.Builder()
                            .setEncoding(enc)
                            .setSampleRate(sampleRate)
                            .setChannelMask(channelOut)
                            .build(),
                    )
                    .setBufferSizeInBytes(maxOf(minPlay, frame * 8))
                    .setTransferMode(AudioTrack.MODE_STREAM)
                    .build()

                if (record.state != AudioRecord.STATE_INITIALIZED) { running = false; return@Thread }
                // 录音管线上启用系统级回声消除/降噪（若设备支持），进一步减少外放回授
                runCatching {
                    if (android.media.audiofx.AcousticEchoCanceler.isAvailable()) {
                        android.media.audiofx.AcousticEchoCanceler.create(record.audioSessionId)?.enabled = true
                    }
                    if (android.media.audiofx.NoiseSuppressor.isAvailable()) {
                        android.media.audiofx.NoiseSuppressor.create(record.audioSessionId)?.enabled = true
                    }
                }
                record.startRecording()
                track.play()

                val buf = ByteArray(frame)
                while (running) {
                    val n = record.read(buf, 0, buf.size)
                    if (n > 0) {
                        val bb = ByteBuffer.wrap(buf, 0, n).order(ByteOrder.LITTLE_ENDIAN)
                        runCatching { VoiceProcessor.process(enc, 1, sampleRate, bb, n) }
                        track.write(buf, 0, n)
                    }
                }
            } catch (_: Throwable) {
                // 忽略：试听失败静默退出
            } finally {
                runCatching { record?.stop() }
                runCatching { record?.release() }
                runCatching { track?.stop() }
                runCatching { track?.release() }
            }
        }.also { it.isDaemon = true; it.start() }
    }

    fun stop() {
        running = false
        thread = null
    }
}
