package top.pmh13.mctier.network

import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjection
import android.util.DisplayMetrics
import android.util.Log
import android.view.WindowManager
import org.json.JSONArray
import org.webrtc.DataChannel
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.ScreenCapturerAndroid
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import top.pmh13.mctier.data.IcePayload
import top.pmh13.mctier.data.SdpPayload
import top.pmh13.mctier.data.SignalingEnvelope
import top.pmh13.mctier.service.MctierAccessibilityService
import java.nio.charset.StandardCharsets

/**
 * 远程控制（被控端 = 手机）。
 * 控制端(电脑)发来 remote-control-request → UI 弹窗 → 用户接受后采集屏幕(MediaProjection)
 * 并经 WebRTC 把画面发给电脑；电脑通过 rc-input 数据通道发来归一化指针事件，
 * 本端映射为屏幕像素并经无障碍服务注入为点击/滑动手势。
 *
 * 信令复用现有 WebSocket，类型：remote-control-request/accept/reject/offer/answer/ice/stop。
 */
class RemoteControlController(
    private val context: Context,
    private val localPlayerId: String,
    private val sendSignal: (SignalingEnvelope) -> Unit,
) {
    private val eglBase: EglBase = EglBase.create()
    private val factory: PeerConnectionFactory

    private var pc: PeerConnection? = null
    private var capturer: ScreenCapturerAndroid? = null
    private var videoSource: VideoSource? = null
    private var localVideoTrack: VideoTrack? = null
    private var surfaceHelper: SurfaceTextureHelper? = null

    private var sessionId: String? = null
    private var controllerId: String? = null
    private var controllerName: String? = null

    // 真实屏幕尺寸（把归一化坐标 0..1 映射为像素）
    private var screenW = 1080f
    private var screenH = 1920f

    // 触摸手势状态
    private var isDown = false
    private var downTime = 0L
    private val pathPoints = ArrayList<Pair<Float, Float>>()

    var onRequest: ((sessionId: String, fromId: String, fromName: String) -> Unit)? = null
    var onActive: ((controllerName: String) -> Unit)? = null
    var onEnded: (() -> Unit)? = null

    val isActive: Boolean get() = sessionId != null

    init {
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(context)
                .setEnableInternalTracer(false)
                .setFieldTrials("WebRTC-BindUsingInterfaceName/Enabled/")
                .createInitializationOptions(),
        )
        val pcOptions = PeerConnectionFactory.Options().apply { networkIgnoreMask = 0 }
        factory = PeerConnectionFactory.builder()
            .setOptions(pcOptions)
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglBase.eglBaseContext))
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true))
            .createPeerConnectionFactory()
    }

    private fun updateScreenSize() {
        runCatching {
            val metrics = DisplayMetrics()
            @Suppress("DEPRECATION")
            (context.getSystemService(Context.WINDOW_SERVICE) as WindowManager).defaultDisplay.getRealMetrics(metrics)
            screenW = metrics.widthPixels.toFloat().coerceAtLeast(1f)
            screenH = metrics.heightPixels.toFloat().coerceAtLeast(1f)
        }
    }

    // ========================= 信令路由 =========================
    fun handleSignal(message: SignalingEnvelope) {
        when (message.type) {
            "remote-control-request" -> {
                val from = message.from ?: return
                val sid = message.sessionId ?: return
                val name = message.fromName ?: message.playerName ?: "玩家"
                if (isActive) {
                    // 忙：自动拒绝
                    sendSignal(SignalingEnvelope(type = "remote-control-reject", from = localPlayerId, to = from, sessionId = sid, reason = "busy"))
                    return
                }
                onRequest?.invoke(sid, from, name)
            }
            "remote-control-offer" -> {
                val from = message.from ?: return
                val sid = message.sessionId ?: return
                val offer = message.offer ?: return
                if (sid != sessionId || from != controllerId) return
                handleOffer(from, sid, offer.sdp)
            }
            "remote-control-ice" -> {
                val c = message.candidate ?: return
                pc?.addIceCandidate(IceCandidate(c.sdpMid, c.sdpMLineIndex ?: 0, c.candidate))
            }
            "remote-control-stop" -> stop(notify = false)
        }
    }

    /** 拒绝控制请求 */
    fun reject(sid: String, fromId: String) {
        sendSignal(SignalingEnvelope(type = "remote-control-reject", from = localPlayerId, to = fromId, sessionId = sid, reason = "rejected"))
    }

    /** 用户接受：启动屏幕采集并发送 accept，等待控制端 offer */
    fun accept(projectionData: Intent, sid: String, fromId: String, fromName: String) {
        sessionId = sid
        controllerId = fromId
        controllerName = fromName
        updateScreenSize()
        startCapture(projectionData)
        sendSignal(SignalingEnvelope(type = "remote-control-accept", from = localPlayerId, to = fromId, sessionId = sid))
    }

    private fun startCapture(permissionData: Intent) {
        runCatching {
            val metrics = DisplayMetrics()
            @Suppress("DEPRECATION")
            (context.getSystemService(Context.WINDOW_SERVICE) as WindowManager).defaultDisplay.getMetrics(metrics)
            val width = metrics.widthPixels.coerceAtMost(1280)
            val height = metrics.heightPixels.coerceAtMost(2280)
            val helper = SurfaceTextureHelper.create("MCTierRcCapture", eglBase.eglBaseContext)
            surfaceHelper = helper
            val source = factory.createVideoSource(true)
            videoSource = source
            val cap = ScreenCapturerAndroid(permissionData, object : MediaProjection.Callback() {
                override fun onStop() { Log.i(TAG, "MediaProjection 已停止") }
            })
            capturer = cap
            cap.initialize(helper, context, source.capturerObserver)
            cap.startCapture(width, height, 20)
            localVideoTrack = factory.createVideoTrack("rc-screen-$localPlayerId", source)
            Log.i(TAG, "远控屏幕采集已启动 ${width}x$height")
        }.onFailure { Log.e(TAG, "远控屏幕采集失败: ${it.message}", it) }
    }

    private fun handleOffer(from: String, sid: String, sdp: String) {
        val track = localVideoTrack ?: run { Log.w(TAG, "无屏幕轨，无法应答"); return }
        val connection = factory.createPeerConnection(
            PeerConnection.RTCConfiguration(emptyList()).apply { sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN },
            object : PeerConnection.Observer {
                override fun onIceCandidate(candidate: IceCandidate) {
                    sendSignal(SignalingEnvelope(type = "remote-control-ice", from = localPlayerId, to = from, sessionId = sid, candidate = IcePayload(candidate.sdp, candidate.sdpMLineIndex, candidate.sdpMid)))
                }
                override fun onSignalingChange(s: PeerConnection.SignalingState) = Unit
                override fun onIceConnectionChange(s: PeerConnection.IceConnectionState) {
                    if (s == PeerConnection.IceConnectionState.FAILED || s == PeerConnection.IceConnectionState.CLOSED) stop(notify = false)
                }
                override fun onIceConnectionReceivingChange(b: Boolean) = Unit
                override fun onIceGatheringChange(s: PeerConnection.IceGatheringState) = Unit
                override fun onIceCandidatesRemoved(c: Array<out IceCandidate>) = Unit
                override fun onAddStream(s: org.webrtc.MediaStream) = Unit
                override fun onRemoveStream(s: org.webrtc.MediaStream) = Unit
                override fun onRenegotiationNeeded() = Unit
                override fun onAddTrack(receiver: org.webrtc.RtpReceiver, streams: Array<out org.webrtc.MediaStream>) = Unit
                override fun onDataChannel(channel: DataChannel) {
                    if (channel.label() == "rc-input") registerInputChannel(channel)
                }
            },
        ) ?: return
        connection.addTrack(track, listOf("rc-stream-$localPlayerId"))
        connection.setRemoteDescription(SimpleSdpObserver(), SessionDescription(SessionDescription.Type.OFFER, sdp))
        connection.createAnswer(object : SimpleSdpObserver() {
            override fun onCreateSuccess(desc: SessionDescription) {
                connection.setLocalDescription(SimpleSdpObserver(), desc)
                sendSignal(SignalingEnvelope(type = "remote-control-answer", from = localPlayerId, to = from, sessionId = sid, answer = SdpPayload(desc.type.canonicalForm(), desc.description)))
            }
        }, MediaConstraints())
        pc = connection
        onActive?.invoke(controllerName ?: "")
    }

    private fun registerInputChannel(channel: DataChannel) {
        channel.registerObserver(object : DataChannel.Observer {
            override fun onBufferedAmountChange(previousAmount: Long) = Unit
            override fun onStateChange() = Unit
            override fun onMessage(buffer: DataChannel.Buffer) {
                val bytes = ByteArray(buffer.data.remaining())
                buffer.data.get(bytes)
                val text = String(bytes, StandardCharsets.UTF_8)
                runCatching { handleInputBatch(text) }
            }
        })
    }

    // ========================= 输入注入 =========================
    private fun handleInputBatch(json: String) {
        val arr = JSONArray(json)
        for (i in 0 until arr.length()) {
            val ev = arr.optJSONObject(i) ?: continue
            when (ev.optString("kind")) {
                "down" -> {
                    isDown = true
                    downTime = System.currentTimeMillis()
                    pathPoints.clear()
                    pathPoints.add(px(ev))
                }
                "move" -> if (isDown) pathPoints.add(px(ev))
                "up" -> {
                    if (isDown) {
                        pathPoints.add(px(ev))
                        finishGesture()
                    }
                    isDown = false
                }
                "wheel" -> {
                    val dy = ev.optDouble("dy", 0.0).toFloat()
                    injectScroll(dy)
                }
                "keyup" -> {
                    // 仅处理少量按键：ESC=返回
                    val code = ev.optInt("code", -1)
                    if (code == 27) MctierAccessibilityService.instance?.goBack()
                }
            }
        }
    }

    private fun px(ev: org.json.JSONObject): Pair<Float, Float> {
        val x = ev.optDouble("x", 0.0).toFloat().coerceIn(0f, 1f) * screenW
        val y = ev.optDouble("y", 0.0).toFloat().coerceIn(0f, 1f) * screenH
        return x to y
    }

    private fun finishGesture() {
        val svc = MctierAccessibilityService.instance ?: return
        if (pathPoints.isEmpty()) return
        val start = pathPoints.first()
        val end = pathPoints.last()
        val dist = Math.hypot((end.first - start.first).toDouble(), (end.second - start.second).toDouble())
        val elapsed = (System.currentTimeMillis() - downTime).coerceAtLeast(1)
        if (dist < 16 && elapsed < 350) {
            svc.tap(start.first, start.second)
        } else if (dist < 16) {
            svc.longPress(start.first, start.second)
        } else {
            svc.gesturePath(pathPoints.toList(), elapsed.coerceIn(50, 8000))
        }
        pathPoints.clear()
    }

    private fun injectScroll(dy: Float) {
        val svc = MctierAccessibilityService.instance ?: return
        val cx = screenW / 2f
        val cy = screenH / 2f
        // 滚轮向上(dy>0)看上方内容 → 手指下滑；向下 → 手指上滑
        val amount = (dy * 220f).coerceIn(-screenH / 2f, screenH / 2f)
        svc.gesturePath(listOf(cx to cy, cx to (cy + amount)), 260)
    }

    // ========================= 停止 =========================
    fun stop(notify: Boolean = true) {
        val cid = controllerId
        val sid = sessionId
        if (notify && cid != null && sid != null) {
            sendSignal(SignalingEnvelope(type = "remote-control-stop", from = localPlayerId, to = cid, sessionId = sid))
        }
        runCatching { pc?.close() }
        pc = null
        runCatching { capturer?.stopCapture() }
        runCatching { capturer?.dispose() }
        capturer = null
        runCatching { localVideoTrack?.dispose() }
        localVideoTrack = null
        runCatching { videoSource?.dispose() }
        videoSource = null
        runCatching { surfaceHelper?.dispose() }
        surfaceHelper = null
        sessionId = null
        controllerId = null
        controllerName = null
        isDown = false
        pathPoints.clear()
        onEnded?.invoke()
    }

    fun release() {
        stop(notify = false)
        runCatching { eglBase.release() }
    }

    private companion object {
        private const val TAG = "RemoteControlController"
    }
}
