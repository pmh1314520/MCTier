package top.pmh13.mctier.audio

import android.content.Context
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.ArrayDeque
import org.webrtc.audio.JavaAudioDeviceModule

/**
 * Bridges JavaAudioDeviceModule PCM callbacks to LocalVQE's 16 kHz/256-sample
 * streaming API. Playback samples provide the far-end reference for AEC; the
 * Android hardware AEC/NS remains enabled as a fallback and a second safety net.
 */
internal object LocalVqePcmProcessor {
    private const val MODEL = "localvqe-pi-v1-49k-f32.gguf"
    private const val HOP = 256
    private var context: Long = 0
    private val reference = ArrayDeque<Short>()
    private val microphone = ArrayDeque<Short>()
    private val enhanced = ArrayDeque<Short>()
    private var pendingInput = 0
    private var inputRatio = 1

    @Synchronized
    fun init(appContext: Context) {
        if (context != 0L || !LocalVqeNative.available) return
        val modelFile = File(appContext.filesDir, MODEL)
        if (!modelFile.exists()) {
            appContext.assets.open(MODEL).use { input -> modelFile.outputStream().use(input::copyTo) }
        }
        context = LocalVqeNative.create(modelFile.absolutePath)
    }

    @Synchronized
    fun onPlaybackSamplesReady(samples: JavaAudioDeviceModule.AudioSamples) {
        if (context == 0L || samples.audioFormat != 2) return
        appendReference(samples.data, samples.channelCount, samples.sampleRate)
    }

    @Synchronized
    fun processCapture(buffer: ByteBuffer, audioFormat: Int, channels: Int, sampleRate: Int, bytesRead: Int) {
        if (context == 0L || audioFormat != 2 || channels <= 0) return
        val bytes = minOf(bytesRead, buffer.remaining())
        val samples = bytes / 2 / channels
        if (samples <= 0 || sampleRate !in setOf(16000, 48000)) return
        val input = buffer.duplicate().order(ByteOrder.LITTLE_ENDIAN)
        val output = ShortArray(samples)
        val ratio = sampleRate / 16000
        inputRatio = ratio
        for (index in 0 until samples) {
            var sum = 0
            for (channel in 0 until channels) {
                sum += input.getShort(index * channels * 2 + channel * 2).toInt()
            }
            val mono = (sum / channels).toShort()
            output[index] = if (enhanced.isNotEmpty()) enhanced.removeFirst() else mono
            if (index % ratio == 0) microphone.addLast(mono)
            pendingInput++
            if (microphone.size >= HOP && pendingInput >= HOP * ratio) {
                processHop()
                pendingInput -= HOP * ratio
            }
        }
        for (index in 0 until samples) {
            for (channel in 0 until channels) {
                val offset = index * channels * 2 + channel * 2
                input.putShort(offset, output[index])
            }
        }
    }

    private fun appendReference(data: ByteArray, channels: Int, sampleRate: Int) {
        if (channels <= 0 || sampleRate !in setOf(16000, 48000)) return
        val input = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN)
        val ratio = sampleRate / 16000
        val samples = data.size / 2 / channels
        for (index in 0 until samples) {
            if (index % ratio != 0) continue
            var sum = 0
            for (channel in 0 until channels) {
                sum += input.getShort(index * channels * 2 + channel * 2).toInt()
            }
            reference.addLast((sum / channels).toShort())
        }
        while (reference.size > 16384) reference.removeFirst()
    }

    private fun processHop() {
        val mic = ShortArray(HOP)
        val ref = ShortArray(HOP)
        val out = ShortArray(HOP)
        for (index in 0 until HOP) mic[index] = microphone.removeFirst()
        for (index in 0 until HOP) ref[index] = if (reference.isNotEmpty()) reference.removeFirst() else 0
        if (LocalVqeNative.processFrame(context, mic, ref, out) == 0) {
            repeat(HOP) { sample -> repeat(inputRatio) { enhanced.addLast(out[sample]) } }
        }
    }

    @Synchronized
    fun dispose() {
        if (context != 0L) LocalVqeNative.destroy(context)
        context = 0
        reference.clear()
        enhanced.clear()
        microphone.clear()
        pendingInput = 0
        inputRatio = 1
    }
}
