package top.pmh13.mctier.network

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.sin
import kotlin.math.PI

/**
 * 安卓端实时变声处理器（非 AI，纯 DSP）。
 * 接到 WebRTC JavaAudioDeviceModule 的录音 PCM 回调上，对 16bit PCM 原地变声后再发送。
 *
 * - 变调：双抽头延迟线颗粒变调（与桌面端 Jungle 思路一致，覆盖整数倍/半音变调）
 * - 机器人：环形调制
 * - 电话音：二阶带通滤波
 */
object VoiceProcessor {
    @Volatile var preset: String = "none"

    // 各预设变调半音
    private fun semitonesOf(p: String): Int = when (p) {
        "uncle" -> -6
        "male" -> -3
        "female" -> 4
        "loli" -> 7
        "chipmunk" -> 10
        "telephone" -> 1
        else -> 0
    }

    // ===== 双抽头颗粒变调状态 =====
    private var sampleRate = 48000
    private var windowLen = 2880 // ~60ms @48k，初始化时按采样率重算
    private var buf = FloatArray(windowLen * 2)
    private var writeIdx = 0
    private var phase = 0f
    private var curRatio = 1f
    private var targetRatio = 1f

    // ===== 机器人环形调制相位 =====
    private var ringPhase = 0.0

    // ===== 电话带通滤波器状态（二阶 biquad）=====
    private var bpReady = false
    private var b0 = 0f; private var b1 = 0f; private var b2 = 0f
    private var a1 = 0f; private var a2 = 0f
    private var z1 = 0f; private var z2 = 0f

    private fun ensureInit(sr: Int) {
        if (sr == sampleRate && buf.isNotEmpty()) return
        sampleRate = sr
        windowLen = (sr * 0.06f).toInt().coerceAtLeast(256)
        buf = FloatArray(windowLen * 2)
        writeIdx = 0
        phase = 0f
        // 初始化带通：中心 1500Hz，Q=6（电话音）
        val f0 = 1500.0
        val q = 6.0
        val w0 = 2.0 * PI * f0 / sr
        val alpha = sin(w0) / (2.0 * q)
        val cosw0 = kotlin.math.cos(w0)
        val a0 = 1.0 + alpha
        b0 = (alpha / a0).toFloat()
        b1 = 0f
        b2 = (-alpha / a0).toFloat()
        a1 = (-2.0 * cosw0 / a0).toFloat()
        a2 = ((1.0 - alpha) / a0).toFloat()
        z1 = 0f; z2 = 0f
        bpReady = true
    }

    private fun readInterp(delay: Float): Float {
        // 读 writeIdx - delay 处样本（线性插值），delay ∈ [0, windowLen)
        val size = buf.size
        var pos = writeIdx - delay
        while (pos < 0) pos += size
        val i0 = pos.toInt() % size
        val frac = pos - pos.toInt()
        val i1 = (i0 + 1) % size
        return buf[i0] * (1f - frac) + buf[i1] * frac
    }

    private fun triWin(d: Float): Float {
        // 三角窗，[0,windowLen) -> [0,1,0]
        val x = d / windowLen
        return 1f - abs(2f * x - 1f)
    }

    /** 处理一段 16bit PCM（小端，单声道为主；多声道按交织处理每个样本） */
    fun process(audioFormat: Int, channelCount: Int, sampleRate: Int, buffer: ByteBuffer, bytesRead: Int = -1) {
        val p = preset
        if (p == "none") return
        ensureInit(sampleRate)

        val order = buffer.order()
        buffer.order(ByteOrder.LITTLE_ENDIAN)
        val shorts = buffer.asShortBuffer()
        // 仅处理有效采样：bytesRead 为本次录音的有效字节数（16bit => /2 个 short）
        val n = if (bytesRead > 0) (bytesRead / 2).coerceAtMost(shorts.limit()) else shorts.limit()

        val isRobot = p == "robot"
        val isTelephone = p == "telephone"
        targetRatio = Math.pow(2.0, semitonesOf(p) / 12.0).toFloat()

        var idx = 0
        while (idx < n) {
            // 平滑过渡变调比例，避免切换爆音
            curRatio += (targetRatio - curRatio) * 0.001f
            val s = shorts.get(idx)
            var x = s / 32768f

            // 颗粒变调（仅当需要变调）
            if (semitonesOf(p) != 0) {
                buf[writeIdx] = x
                val d0 = phase
                val d1 = (phase + windowLen / 2f) % windowLen
                var out = triWin(d0) * readInterp(d0) + triWin(d1) * readInterp(d1)
                // 变调方向：读取速率 = 1 - delay'，故 delay 增量应为 (1 - ratio)
                // 升调(ratio>1) => delay 递减 => 读取更新的样本 => 播放更快 => 音调升高
                phase += (1f - curRatio)
                if (phase >= windowLen) phase -= windowLen
                if (phase < 0) phase += windowLen
                writeIdx = (writeIdx + 1) % buf.size
                x = out
            }

            // 机器人：环形调制
            if (isRobot) {
                val mod = sin(ringPhase).toFloat()
                ringPhase += 2.0 * PI * 60.0 / sampleRate
                if (ringPhase > 2 * PI) ringPhase -= 2 * PI
                x *= mod
            }

            // 电话音：带通滤波
            if (isTelephone && bpReady) {
                val inp = x
                val y = b0 * inp + z1
                z1 = b1 * inp - a1 * y + z2
                z2 = b2 * inp - a2 * y
                x = y * 2.2f // 带通后补偿增益
            }

            val v = (x * 32768f).toInt().coerceIn(-32768, 32767)
            shorts.put(idx, v.toShort())
            idx++
        }
        buffer.order(order)
    }
}
