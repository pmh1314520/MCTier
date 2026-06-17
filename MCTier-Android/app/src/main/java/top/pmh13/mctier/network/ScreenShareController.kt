package top.pmh13.mctier.network

import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjection
import android.util.DisplayMetrics
import android.util.Log
import android.view.WindowManager
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStreamTrack
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpTransceiver
import org.webrtc.ScreenCapturerAndroid
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import top.pmh13.mctier.data.IcePayload
import top.pmh13.mctier.data.SdpPayload
import top.pmh13.mctier.data.SignalingEnvelope

/**
 * 屏幕共享控制器（观看端 + 共享端，与桌面端互通）
 *
 * 约定：观看者创建 offer（recvonly 视频）发给共享者；共享者带屏幕视频轨 answer。
 * 信令：screen-share-offer / screen-share-answer / screen-share-ice-candidate（字段与语音同构）。
 *
 * 共享端（MediaProjection 采集）需真机验证；获取投屏前需先启动 mediaProjection 前台服务。
 */
class ScreenShareController(
    private val context: Context,
    private val localPlayerId: String,
    private val sendSignal: (SignalingEnvelope) -> Unit,
) {
    val eglBase: EglBase = EglBase.create()
    private val factory: PeerConnectionFactory

    // 观看端
    private var viewerPc: PeerConnection? = null
    private var currentShareId: String? = null
    var onRemoteVideoTrack: ((VideoTrack?) -> Unit)? = null

    // 共享端
    private var screenCapturer: ScreenCapturerAndroid? = null
    private var videoSource: VideoSource? = null
    private var localVideoTrack: VideoTrack? = null
    private var surfaceHelper: SurfaceTextureHelper? = null
    private var sharingShareId: String? = null
    private var sharePassword: String? = null
    private val sharerConnections = linkedMapOf<String, PeerConnection>()

    val isSharing: Boolean get() = localVideoTrack != null

    init {
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(context)
                .setEnableInternalTracer(false)
                // 同 AndroidRtcController：安卓 VPN(TUN) 下按接口名绑定 socket，保证屏幕共享能 P2P 直连
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

    // ========================= 观看端 =========================
    fun startViewing(shareId: String, sharerPlayerId: String, playerName: String, password: String?) {
        stopViewing(notify = false)
        currentShareId = shareId
        val connection = factory.createPeerConnection(
            PeerConnection.RTCConfiguration(emptyList()).apply { sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN },
            viewerObserver(sharerPlayerId, shareId),
        ) ?: return
        connection.addTransceiver(
            MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO,
            RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.RECV_ONLY),
        )
        connection.createOffer(object : SimpleSdpObserver() {
            override fun onCreateSuccess(desc: SessionDescription) {
                connection.setLocalDescription(SimpleSdpObserver(), desc)
                sendSignal(
                    SignalingEnvelope(
                        type = "screen-share-offer", from = localPlayerId, to = sharerPlayerId, shareId = shareId,
                        playerName = playerName, password = password?.takeIf { it.isNotBlank() },
                        offer = SdpPayload(desc.type.canonicalForm(), desc.description),
                    ),
                )
            }
        }, MediaConstraints())
        viewerPc = connection
    }

    private fun viewerObserver(sharerPlayerId: String, shareId: String) = object : PeerConnection.Observer {
        override fun onIceCandidate(candidate: IceCandidate) {
            sendSignal(SignalingEnvelope(type = "screen-share-ice-candidate", from = localPlayerId, to = sharerPlayerId, shareId = shareId, candidate = IcePayload(candidate.sdp, candidate.sdpMLineIndex, candidate.sdpMid)))
        }
        override fun onSignalingChange(s: PeerConnection.SignalingState) = Unit
        override fun onIceConnectionChange(s: PeerConnection.IceConnectionState) = Unit
        override fun onIceConnectionReceivingChange(b: Boolean) = Unit
        override fun onIceGatheringChange(s: PeerConnection.IceGatheringState) = Unit
        override fun onIceCandidatesRemoved(c: Array<out IceCandidate>) = Unit
        override fun onAddStream(s: org.webrtc.MediaStream) = Unit
        override fun onRemoveStream(s: org.webrtc.MediaStream) = Unit
        override fun onDataChannel(d: org.webrtc.DataChannel) = Unit
        override fun onRenegotiationNeeded() = Unit
        override fun onAddTrack(receiver: org.webrtc.RtpReceiver, streams: Array<out org.webrtc.MediaStream>) {
            val track = receiver.track()
            if (track is VideoTrack && track.kind() == MediaStreamTrack.VIDEO_TRACK_KIND) {
                Log.i(TAG, "收到远端屏幕视频轨: $shareId")
                onRemoteVideoTrack?.invoke(track)
            }
        }
    }

    fun stopViewing(notify: Boolean = true) {
        val sid = currentShareId
        if (notify && sid != null) sendSignal(SignalingEnvelope(type = "screen-share-viewer-left", from = localPlayerId, shareId = sid))
        onRemoteVideoTrack?.invoke(null)
        viewerPc?.close()
        viewerPc = null
        currentShareId = null
    }

    // ========================= 共享端 =========================
    /** 开始采集屏幕（需已获得 MediaProjection 授权数据 + 前台服务已启动） */
    fun startSharing(shareId: String, permissionData: Intent, password: String? = null) {
        sharePassword = password?.takeIf { it.isNotBlank() }
        runCatching {
            val metrics = DisplayMetrics()
            @Suppress("DEPRECATION")
            (context.getSystemService(Context.WINDOW_SERVICE) as WindowManager).defaultDisplay.getMetrics(metrics)
            val width = metrics.widthPixels.coerceAtMost(1280)
            val height = metrics.heightPixels.coerceAtMost(2280)

            val helper = SurfaceTextureHelper.create("MCTierScreenCapture", eglBase.eglBaseContext)
            surfaceHelper = helper
            val source = factory.createVideoSource(true) // isScreencast = true
            videoSource = source
            val capturer = ScreenCapturerAndroid(permissionData, object : MediaProjection.Callback() {
                override fun onStop() { Log.i(TAG, "MediaProjection 已停止") }
            })
            screenCapturer = capturer
            capturer.initialize(helper, context, source.capturerObserver)
            capturer.startCapture(width, height, 15)
            localVideoTrack = factory.createVideoTrack("screen-$localPlayerId", source)
            sharingShareId = shareId
            Log.i(TAG, "屏幕采集已启动 ${width}x$height")
        }.onFailure { Log.e(TAG, "启动屏幕采集失败: ${it.message}", it) }
    }

    private fun handleViewerOffer(from: String, shareId: String, offer: SdpPayload, providedPassword: String?) {
        // 密码校验：共享端设置了密码时，观看者必须提供正确密码，否则拒绝
        val expected = sharePassword
        if (expected != null && providedPassword != expected) {
            Log.w(TAG, "观看者密码错误，拒绝: $from")
            sendSignal(SignalingEnvelope(type = "screen-share-error", from = localPlayerId, to = from, shareId = shareId, error = "屏幕共享密码错误"))
            return
        }
        val track = localVideoTrack ?: return
        val pc = factory.createPeerConnection(
            PeerConnection.RTCConfiguration(emptyList()).apply { sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN },
            object : PeerConnection.Observer {
                override fun onIceCandidate(candidate: IceCandidate) {
                    sendSignal(SignalingEnvelope(type = "screen-share-ice-candidate", from = localPlayerId, to = from, shareId = shareId, candidate = IcePayload(candidate.sdp, candidate.sdpMLineIndex, candidate.sdpMid)))
                }
                override fun onSignalingChange(s: PeerConnection.SignalingState) = Unit
                override fun onIceConnectionChange(s: PeerConnection.IceConnectionState) = Unit
                override fun onIceConnectionReceivingChange(b: Boolean) = Unit
                override fun onIceGatheringChange(s: PeerConnection.IceGatheringState) = Unit
                override fun onIceCandidatesRemoved(c: Array<out IceCandidate>) = Unit
                override fun onAddStream(s: org.webrtc.MediaStream) = Unit
                override fun onRemoveStream(s: org.webrtc.MediaStream) = Unit
                override fun onDataChannel(d: org.webrtc.DataChannel) = Unit
                override fun onRenegotiationNeeded() = Unit
                override fun onAddTrack(receiver: org.webrtc.RtpReceiver, streams: Array<out org.webrtc.MediaStream>) = Unit
            },
        ) ?: return
        pc.addTrack(track, listOf("screen-stream-$localPlayerId"))
        pc.setRemoteDescription(SimpleSdpObserver(), SessionDescription(SessionDescription.Type.OFFER, offer.sdp))
        pc.createAnswer(object : SimpleSdpObserver() {
            override fun onCreateSuccess(desc: SessionDescription) {
                pc.setLocalDescription(SimpleSdpObserver(), desc)
                sendSignal(SignalingEnvelope(type = "screen-share-answer", from = localPlayerId, to = from, shareId = shareId, answer = SdpPayload(desc.type.canonicalForm(), desc.description)))
            }
        }, MediaConstraints())
        sharerConnections[from] = pc
    }

    fun stopSharing() {
        sharingShareId = null
        sharerConnections.values.forEach { it.close() }
        sharerConnections.clear()
        runCatching { screenCapturer?.stopCapture() }
        screenCapturer?.dispose()
        screenCapturer = null
        localVideoTrack?.dispose()
        localVideoTrack = null
        videoSource?.dispose()
        videoSource = null
        surfaceHelper?.dispose()
        surfaceHelper = null
    }

    // ========================= 信令路由 =========================
    fun handleSignal(message: SignalingEnvelope) {
        when (message.type) {
            "screen-share-offer" -> {
                val from = message.from ?: return
                val offer = message.offer ?: return
                if (isSharing) handleViewerOffer(from, message.shareId ?: sharingShareId ?: "", offer, message.password)
            }
            "screen-share-answer" -> {
                val answer = message.answer ?: return
                viewerPc?.setRemoteDescription(SimpleSdpObserver(), SessionDescription(SessionDescription.Type.ANSWER, answer.sdp))
            }
            "screen-share-ice-candidate" -> {
                val from = message.from ?: return
                val c = message.candidate ?: return
                val ice = IceCandidate(c.sdpMid, c.sdpMLineIndex ?: 0, c.candidate)
                val sharerPc = sharerConnections[from]
                if (sharerPc != null) sharerPc.addIceCandidate(ice) else viewerPc?.addIceCandidate(ice)
            }
            "screen-share-viewer-left" -> {
                val from = message.from ?: return
                sharerConnections.remove(from)?.close()
            }
        }
    }

    fun release() {
        stopViewing(notify = false)
        stopSharing()
        runCatching { eglBase.release() }
    }

    private companion object {
        private const val TAG = "ScreenShareController"
    }
}
