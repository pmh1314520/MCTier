package top.pmh13.mctier.network

import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjection
import android.os.Handler
import android.os.Looper
import android.util.DisplayMetrics
import android.util.Log
import android.view.WindowManager
import org.webrtc.DataChannel
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.MediaStreamTrack
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.RtpSender
import org.webrtc.RtpTransceiver
import org.webrtc.ScreenCapturerAndroid
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoSource
import org.webrtc.VideoSink
import org.webrtc.VideoTrack
import top.pmh13.mctier.data.IcePayload
import top.pmh13.mctier.data.SdpPayload
import top.pmh13.mctier.data.SignalingEnvelope
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/**
 * Screen sharing uses an owner-coordinated shallow relay tree. The owner keeps
 * two direct branches and each healthy viewer serves at most one downstream.
 */
class ScreenShareController(
    private val context: Context,
    private val localPlayerId: String,
    private val sendSignal: (SignalingEnvelope) -> Unit,
) {
    val eglBase: EglBase = EglBase.create()
    private val factory: PeerConnectionFactory
    private val mainHandler = Handler(Looper.getMainLooper())

    private var currentShareId: String? = null
    private var currentOwnerId: String? = null
    private var currentPlayerName: String = ""
    private var currentPassword: String? = null
    private var currentUpstreamId: String? = null
    private var currentRouteVersion: Int? = null
    private var readyRouteVersion: Int? = null
    private var remoteVideoTrack: VideoTrack? = null
    private var pendingVideoTrack: VideoTrack? = null
    private var remoteFrameProbe: VideoSink? = null
    private var fallbackReadyVersion: Int? = null
    private var remoteFrameLastAt: Long = 0L
    private var remoteHealthCheck: Runnable? = null
    private var pendingRouteTimeout: Runnable? = null
    private val sourceFrameSequences = ConcurrentHashMap<String, AtomicLong>()
    private var localFrameProbe: VideoSink? = null
    private var upstreamHealthId: String? = null
    private var upstreamHealthVersion: Int? = null
    private var upstreamHealthSequence: Long = 0L
    private var upstreamHealthAt: Long = 0L
    private var upstreamHealthLimited: Boolean = false
    private val inboundConnections = linkedMapOf<String, PeerConnection>()
    private val outboundConnections = linkedMapOf<String, PeerConnection>()
    private val outboundSenders = linkedMapOf<String, RtpSender>()
    private val pendingIce = BoundedIceCache<String, IceCandidate>(
        maxEntries = MAX_PENDING_ICE_ENTRIES,
        maxBytes = MAX_PENDING_ICE_BYTES,
        maxEntriesPerPeer = MAX_PENDING_ICE_PER_PEER,
        ttlMillis = PENDING_ICE_TTL_MILLIS,
        peerOf = ::icePeer,
        bytesOf = ::iceCandidateBytes,
    )
    private val passwordAttemptLimiter = ExponentialBackoffLimiter(
        maxEntries = MAX_PASSWORD_BACKOFF_ENTRIES,
        baseDelayMillis = PASSWORD_BACKOFF_BASE_MILLIS,
        maxDelayMillis = PASSWORD_BACKOFF_MAX_MILLIS,
        ttlMillis = PASSWORD_BACKOFF_TTL_MILLIS,
    )
    private val expectedDownstreams = linkedMapOf<String, Int>()
    private val pendingOffers = linkedMapOf<String, SignalingEnvelope>()
    private var directFallback: Runnable? = null

    var onRemoteVideoTrack: ((VideoTrack?) -> Unit)? = null
        set(value) {
            field = value
            value?.invoke(remoteVideoTrack)
        }
    var onViewerCountChanged: ((String, Int) -> Unit)? = null
    var onCaptureStopped: ((String) -> Unit)? = null

    /**
     * 被采集内容的可见性变化（Android 14+ 的“单个应用”采集才会回调）。
     *
     * 采集单个应用时，一旦该应用退到后台（例如用户切回 MCTier 看本地预览），
     * 系统就停止投送画面，采集侧收不到任何新帧。此时界面若只显示“等待画面…”，
     * 用户无法判断是卡住还是设计如此——issue #44 正是这个现象。
     * 这里把可见性透出给界面，由界面给出明确说明。
     */
    var onCaptureVisibilityChanged: ((String, Boolean) -> Unit)? = null
        set(value) {
            field = value
            // 订阅时立即回放当前状态（与 onRemoteVideoTrack 同样的处理）。
            // 否则若可见性在订阅之前就已变化，这次变化会被永久丢掉，
            // 界面显示的就是过期状态。
            sharingShareId?.let { shareId -> value?.invoke(shareId, captureContentVisible) }
        }

    private var screenCapturer: ScreenCapturerAndroid? = null
    private var videoSource: VideoSource? = null
    private var localVideoTrack: VideoTrack? = null
    private var surfaceHelper: SurfaceTextureHelper? = null
    private var sharingShareId: String? = null
    private var sharePassword: String? = null
    // 仅“单个应用”采集会被系统置为不可见；整屏采集始终为 true。
    private var captureContentVisible: Boolean = true

    private val viewerOrder = mutableListOf<String>()
    private val viewerNames = linkedMapOf<String, String>()
    private val readyViewers = linkedSetOf<String>()
    private val assignedUpstreams = linkedMapOf<String, String>()
    private val assignedRouteVersions = linkedMapOf<String, Int>()
    private val pendingDetachUpstreams = linkedMapOf<String, String>()
    private val unhealthyRelays = linkedMapOf<String, Long>()
    private val unhealthyEdges = linkedMapOf<String, Long>()
    private val relayFailureCounts = linkedMapOf<String, Int>()
    private val outboundHealthChecks = linkedMapOf<String, Runnable>()
    private var relayRecoveryCheck: Runnable? = null
    private var routeVersion = 0

    val isSharing: Boolean get() = localVideoTrack != null

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

    fun startViewing(shareId: String, sharerPlayerId: String, playerName: String, password: String?) {
        stopViewing(notify = false)
        currentShareId = shareId
        currentOwnerId = sharerPlayerId
        currentPlayerName = playerName
        currentPassword = password?.takeIf { it.isNotBlank() }
        sendSignal(
            SignalingEnvelope(
                type = "screen-share-relay", action = "join", from = localPlayerId, to = sharerPlayerId,
                shareId = shareId, playerName = playerName, password = currentPassword,
            ),
        )

        // Compatibility with an older owner that does not understand relay control.
        directFallback = Runnable {
            if (currentShareId == shareId && remoteVideoTrack == null) {
                fallbackReadyVersion = currentRouteVersion
                connectUpstream(shareId, sharerPlayerId, null)
            }
        }.also { mainHandler.postDelayed(it, 5_000) }
    }

    fun startViewingLocal(shareId: String): Boolean {
        val track = localVideoTrack ?: return false
        if (sharingShareId != shareId) return false
        stopViewing(notify = false)
        currentShareId = shareId
        currentOwnerId = localPlayerId
        remoteVideoTrack = track
        onRemoteVideoTrack?.invoke(track)
        return true
    }

    private fun connectUpstream(shareId: String, upstreamId: String, requestedVersion: Int?) {
        if (currentShareId != shareId) return
        if (requestedVersion == null && remoteVideoTrack != null) return

        val connectionKey = peerKey(shareId, upstreamId)
        val existing = inboundConnections[connectionKey]
        if (currentUpstreamId == upstreamId && existing != null && currentRouteVersion == requestedVersion) {
            if (readyRouteVersion == requestedVersion) requestedVersion?.let { notifyReady(shareId, it) }
            return
        }

        val previousUpstream = currentUpstreamId
        val pc = createPeerConnection(observerForInbound(shareId, upstreamId, requestedVersion, previousUpstream)) ?: return
        inboundConnections.remove(connectionKey)?.close()
        inboundConnections[connectionKey] = pc
        currentUpstreamId = upstreamId
        currentRouteVersion = requestedVersion
        readyRouteVersion = null
        pendingRouteTimeout?.let(mainHandler::removeCallbacks)
        pendingRouteTimeout = Runnable {
            if (currentShareId == shareId && currentUpstreamId == upstreamId && currentRouteVersion == requestedVersion && readyRouteVersion != requestedVersion) {
                currentOwnerId?.let { ownerId ->
                    sendSignal(
                        SignalingEnvelope(
                            type = "screen-share-relay", action = "failure", from = localPlayerId, to = ownerId,
                            shareId = shareId, upstreamId = upstreamId, routeVersion = requestedVersion, reason = "no-frame",
                        ),
                    )
                }
            }
        }.also { mainHandler.postDelayed(it, 6_000L) }
        pc.addTransceiver(
            MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO,
            RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.RECV_ONLY),
        )
        pc.createOffer(object : SimpleSdpObserver() {
            override fun onCreateSuccess(desc: SessionDescription) {
                pc.setLocalDescription(object : SimpleSdpObserver() {
                    override fun onSetSuccess() {
                        sendSignal(
                            SignalingEnvelope(
                                type = "screen-share-offer", from = localPlayerId, to = upstreamId, shareId = shareId,
                                playerName = currentPlayerName, password = if (requestedVersion == null) currentPassword else null,
                                routeVersion = requestedVersion, offer = SdpPayload(desc.type.canonicalForm(), desc.description),
                            ),
                        )
                    }
                }, desc)
            }
        }, MediaConstraints())
    }

    private fun observerForInbound(
        shareId: String,
        upstreamId: String,
        requestedVersion: Int?,
        previousUpstream: String?,
    ) = baseObserver(
        onIce = { candidate ->
            sendSignal(
                SignalingEnvelope(
                    type = "screen-share-ice-candidate", from = localPlayerId, to = upstreamId, shareId = shareId,
                    connectionRole = "out", routeVersion = requestedVersion, candidate = candidate.toPayload(),
                ),
            )
        },
        onIceState = { state ->
            if (state == PeerConnection.IceConnectionState.FAILED || state == PeerConnection.IceConnectionState.DISCONNECTED) {
                mainHandler.postDelayed({
                    if (currentShareId == shareId && currentUpstreamId == upstreamId && currentRouteVersion == requestedVersion) {
                        currentOwnerId?.let { ownerId ->
                            sendSignal(
                                SignalingEnvelope(
                                    type = "screen-share-relay", action = "failure", from = localPlayerId, to = ownerId,
                                    shareId = shareId, upstreamId = upstreamId, routeVersion = requestedVersion,
                                    reason = "connection",
                                ),
                            )
                        }
                    }
                }, if (state == PeerConnection.IceConnectionState.FAILED) 0 else 3_500)
            }
        },
        onTrack = { track ->
            if (track !is VideoTrack || currentShareId != shareId || currentUpstreamId != upstreamId || currentRouteVersion != requestedVersion) return@baseObserver
            clearRemoteFrameProbe()
            pendingVideoTrack = track
            var activated = false
            lateinit var probe: VideoSink
            probe = VideoSink {
                mainHandler.post {
                    if (pendingVideoTrack !== track || currentShareId != shareId || currentUpstreamId != upstreamId || currentRouteVersion != requestedVersion) return@post
                    remoteFrameLastAt = android.os.SystemClock.elapsedRealtime()
                    sourceFrameSequences.computeIfAbsent(shareId) { AtomicLong(0L) }.incrementAndGet()
                    if (!activated) {
                        activated = true
                        directFallback?.let(mainHandler::removeCallbacks)
                        directFallback = null
                        remoteVideoTrack = track
                        val effectiveReadyVersion = requestedVersion ?: fallbackReadyVersion
                        readyRouteVersion = effectiveReadyVersion
                        pendingRouteTimeout?.let(mainHandler::removeCallbacks)
                        pendingRouteTimeout = null
                        fallbackReadyVersion = null
                        onRemoteVideoTrack?.invoke(track)
                        outboundSenders.filterKeys { it.startsWith("$shareId|") }.values.forEach { sender ->
                            runCatching { sender.setTrack(track, false) }
                        }
                        if (previousUpstream != null && previousUpstream != upstreamId) {
                            inboundConnections.remove(peerKey(shareId, previousUpstream))?.close()
                        }
                        if (requestedVersion == null && effectiveReadyVersion != null && previousUpstream != null) {
                            currentOwnerId?.let { ownerId ->
                                sendSignal(SignalingEnvelope(type = "screen-share-relay", action = "failure", from = localPlayerId, to = ownerId, shareId = shareId, upstreamId = previousUpstream, routeVersion = effectiveReadyVersion, reason = "direct-fallback"))
                            }
                        } else {
                            effectiveReadyVersion?.let { notifyReady(shareId, it) }
                        }
                        processPendingOffers(shareId)
                        startRemoteHealthMonitor(shareId, upstreamId, effectiveReadyVersion)
                    }
                }
            }
            remoteFrameProbe = probe
            track.addSink(probe)
        },
    )

    private fun clearRemoteFrameProbe() {
        remoteHealthCheck?.let(mainHandler::removeCallbacks)
        remoteHealthCheck = null
        val track = pendingVideoTrack
        val probe = remoteFrameProbe
        if (track != null && probe != null) runCatching { track.removeSink(probe) }
        pendingVideoTrack = null
        remoteFrameProbe = null
    }

    private fun startRemoteHealthMonitor(shareId: String, upstreamId: String, routeVersion: Int?) {
        remoteHealthCheck?.let(mainHandler::removeCallbacks)
        var lastSequence = upstreamHealthSequence
        var badChecks = 0
        val monitorStartedAt = android.os.SystemClock.elapsedRealtime()
        val check = object : Runnable {
            override fun run() {
                if (currentShareId != shareId || currentUpstreamId != upstreamId || remoteVideoTrack == null) return
                val stalledFor = android.os.SystemClock.elapsedRealtime() - remoteFrameLastAt
                val healthMatches = upstreamHealthId == upstreamId && (routeVersion == null || upstreamHealthVersion == null || upstreamHealthVersion == routeVersion)
                val heartbeatAge = android.os.SystemClock.elapsedRealtime() - upstreamHealthAt
                if (stalledFor < 4_000L) {
                    badChecks = 0
                } else if (healthMatches && heartbeatAge < 5_500L) {
                    if (upstreamHealthSequence > lastSequence) badChecks++ else badChecks = 0
                    lastSequence = maxOf(lastSequence, upstreamHealthSequence)
                } else if (healthMatches && heartbeatAge > 9_000L) {
                    badChecks++
                } else if (!healthMatches && routeVersion != null && android.os.SystemClock.elapsedRealtime() - monitorStartedAt > 12_000L) {
                    badChecks++
                }
                if (badChecks >= 3) {
                    currentOwnerId?.let { ownerId ->
                        sendSignal(
                            SignalingEnvelope(
                                type = "screen-share-relay", action = "failure", from = localPlayerId, to = ownerId,
                                shareId = shareId, upstreamId = upstreamId, routeVersion = routeVersion,
                                reason = if (upstreamHealthLimited) "bandwidth" else "stalled",
                            ),
                        )
                    }
                    return
                }
                mainHandler.postDelayed(this, 2_000L)
            }
        }
        remoteHealthCheck = check
        mainHandler.postDelayed(check, 2_000L)
    }

    private fun startOutboundHealthHeartbeat(shareId: String, downstreamId: String, routeVersion: Int?, connectionKey: String) {
        stopOutboundHealthHeartbeat(connectionKey)
        val heartbeat = object : Runnable {
            override fun run() {
                if (outboundConnections[connectionKey] == null) return
                sendSignal(
                    SignalingEnvelope(
                        type = "screen-share-relay", action = "health", from = localPlayerId, to = downstreamId,
                        shareId = shareId, routeVersion = routeVersion,
                        sequence = sourceFrameSequences[shareId]?.get() ?: 0L,
                        sourceSequence = sourceFrameSequences[shareId]?.get() ?: 0L,
                    ),
                )
                mainHandler.postDelayed(this, 2_000L)
            }
        }
        outboundHealthChecks[connectionKey] = heartbeat
        mainHandler.post(heartbeat)
    }

    private fun stopOutboundHealthHeartbeat(connectionKey: String) {
        outboundHealthChecks.remove(connectionKey)?.let(mainHandler::removeCallbacks)
    }

    private fun notifyReady(shareId: String, version: Int) {
        currentOwnerId?.let { ownerId ->
            sendSignal(
                SignalingEnvelope(
                    type = "screen-share-relay", action = "ready", from = localPlayerId, to = ownerId,
                    shareId = shareId, routeVersion = version,
                ),
            )
        }
    }

    fun stopViewing(notify: Boolean = true) {
        val shareId = currentShareId
        directFallback?.let(mainHandler::removeCallbacks)
        directFallback = null
        if (notify && shareId != null) {
            if (currentOwnerId == localPlayerId) handleViewerLeft(shareId, localPlayerId)
            else sendSignal(SignalingEnvelope(type = "screen-share-viewer-left", from = localPlayerId, shareId = shareId))
        }
        onRemoteVideoTrack?.invoke(null)
        clearRemoteFrameProbe()
        pendingRouteTimeout?.let(mainHandler::removeCallbacks)
        pendingRouteTimeout = null
        remoteVideoTrack = null
        if (shareId != null) {
            outboundHealthChecks.keys.filter { it.startsWith("$shareId|") }.toList().forEach(::stopOutboundHealthHeartbeat)
            closeConnectionsForShare(inboundConnections, shareId)
            closeConnectionsForShare(outboundConnections, shareId)
            outboundSenders.keys.filter { it.startsWith("$shareId|") }.forEach(outboundSenders::remove)
            pendingIce.removeWhere { it.contains("$shareId|") }
            pendingOffers.keys.filter { it.startsWith("$shareId|") }.forEach(pendingOffers::remove)
            expectedDownstreams.keys.filter { it.startsWith("$shareId|") }.forEach(expectedDownstreams::remove)
        }
        currentShareId = null
        currentOwnerId = null
        currentUpstreamId = null
        currentRouteVersion = null
        readyRouteVersion = null
        fallbackReadyVersion = null
        upstreamHealthId = null
        upstreamHealthVersion = null
        upstreamHealthSequence = 0L
        upstreamHealthAt = 0L
        upstreamHealthLimited = false
        currentPassword = null
    }

    fun startSharing(shareId: String, permissionData: Intent, password: String? = null): Boolean {
        stopSharing()
        sharePassword = password?.takeIf { it.isNotBlank() }
        viewerOrder.clear()
        viewerNames.clear()
        readyViewers.clear()
        assignedUpstreams.clear()
        assignedRouteVersions.clear()
        pendingDetachUpstreams.clear()
        unhealthyRelays.clear()
        unhealthyEdges.clear()
        relayFailureCounts.clear()
        relayRecoveryCheck?.let(mainHandler::removeCallbacks)
        relayRecoveryCheck = null
        routeVersion = 0
        return runCatching {
            captureContentVisible = true
            val metrics = DisplayMetrics()
            @Suppress("DEPRECATION")
            (context.getSystemService(Context.WINDOW_SERVICE) as WindowManager).defaultDisplay.getMetrics(metrics)
            // 等比缩放而不是两个维度各自截断，避免画面被拉伸。
            // “单个应用”采集的真实尺寸由 onCapturedContentResize 再纠正一次。
            val (width, height) = captureDimensions(metrics.widthPixels, metrics.heightPixels)
            val helper = SurfaceTextureHelper.create("MCTierScreenCapture", eglBase.eglBaseContext)
            surfaceHelper = helper
            val source = factory.createVideoSource(true)
            videoSource = source
            val capturer = ScreenCapturerAndroid(permissionData, object : MediaProjection.Callback() {
                override fun onStop() {
                    mainHandler.post {
                        if (sharingShareId != shareId) return@post
                        Log.i(TAG, "MediaProjection stopped")
                        stopSharing()
                        onCaptureStopped?.invoke(shareId)
                    }
                }

                // Android 14+ “单个应用”采集：被采集应用退到后台时系统停止投帧。
                // 不是故障，但必须让界面能说清楚，否则表现为“预览一直等待画面”。
                override fun onCapturedContentVisibilityChanged(isVisible: Boolean) {
                    mainHandler.post {
                        if (sharingShareId != shareId) return@post
                        captureContentVisible = isVisible
                        Log.i(TAG, "Captured content visibility changed: $isVisible")
                        onCaptureVisibilityChanged?.invoke(shareId, isVisible)
                    }
                }

                // “单个应用”采集区域的尺寸与整屏不同，且会随应用窗口变化（分屏/自由窗口）。
                // 不跟随调整的话，编码分辨率与实际内容不匹配，观看端会看到黑边或拉伸。
                override fun onCapturedContentResize(contentWidth: Int, contentHeight: Int) {
                    mainHandler.post {
                        if (sharingShareId != shareId) return@post
                        val (targetWidth, targetHeight) = captureDimensions(contentWidth, contentHeight)
                        Log.i(TAG, "Captured content resized: ${contentWidth}x$contentHeight -> ${targetWidth}x$targetHeight")
                        runCatching { screenCapturer?.changeCaptureFormat(targetWidth, targetHeight, CAPTURE_FPS) }
                            .onFailure { Log.w(TAG, "changeCaptureFormat failed: ${it.message}") }
                    }
                }
            })
            screenCapturer = capturer
            capturer.initialize(helper, context, source.capturerObserver)
            capturer.startCapture(width, height, CAPTURE_FPS)
            localVideoTrack = factory.createVideoTrack("screen-$localPlayerId", source)
            localFrameProbe?.let { probe -> localVideoTrack?.removeSink(probe) }
            sourceFrameSequences[shareId] = AtomicLong(0L)
            localFrameProbe = VideoSink { sourceFrameSequences.computeIfAbsent(shareId) { AtomicLong(0L) }.incrementAndGet() }.also { localVideoTrack?.addSink(it) }
            sharingShareId = shareId
            Log.i(TAG, "Screen capture started: ${width}x$height")
            true
        }.onFailure {
            Log.e(TAG, "Failed to start screen capture: ${it.message}", it)
            stopSharing()
        }.getOrDefault(false)
    }

    private fun handleViewerOffer(message: SignalingEnvelope) {
        val from = message.from ?: return
        val shareId = message.shareId ?: return
        val offer = message.offer ?: return
        if (message.to != localPlayerId || from == localPlayerId) return
        val isOwner = sharingShareId == shareId && localVideoTrack != null
        if (!isOwner && currentShareId != shareId) return
        val connectionKey = peerKey(shareId, from)
        val expectedVersion = expectedDownstreams[connectionKey]
        val legacyDirect = isOwner && message.routeVersion == null
        // Only the sharing owner may accept the legacy direct offer. A relay
        // viewer must wait for the owner's child assignment and route version;
        // otherwise a member could dial an already-watching relay directly.
        if (!isOwner && message.routeVersion == null) return
        if (!legacyDirect && (message.routeVersion == null || message.routeVersion <= 0)) return
        if (!legacyDirect && expectedVersion != message.routeVersion) {
            pendingOffers[relayOfferKey(shareId, from, message.routeVersion)] = message
            return
        }
        if (legacyDirect && !acceptViewerPassword(shareId, from, message.password)) return
        val sourceTrack = if (isOwner) localVideoTrack else remoteVideoTrack
        if (sourceTrack == null) {
            pendingOffers[relayOfferKey(shareId, from, message.routeVersion)] = message
            return
        }

        val pc = createPeerConnection(
            baseObserver(
                onIce = { candidate ->
                    sendSignal(
                        SignalingEnvelope(
                            type = "screen-share-ice-candidate", from = localPlayerId, to = from, shareId = shareId,
                            connectionRole = "in", routeVersion = message.routeVersion, candidate = candidate.toPayload(),
                        ),
                    )
                },
            ),
        ) ?: return
        stopOutboundHealthHeartbeat(connectionKey)
        outboundConnections.remove(connectionKey)?.close()
        outboundSenders.remove(connectionKey)
        outboundConnections[connectionKey] = pc
        outboundSenders[connectionKey] = pc.addTrack(sourceTrack, listOf("screen-stream-$localPlayerId"))
        startOutboundHealthHeartbeat(shareId, from, message.routeVersion, connectionKey)
        pc.setRemoteDescription(object : SimpleSdpObserver() {
            override fun onSetSuccess() {
                flushPendingIce(iceKey(shareId, "out", from, message.routeVersion), pc)
                pc.createAnswer(object : SimpleSdpObserver() {
                    override fun onCreateSuccess(desc: SessionDescription) {
                        pc.setLocalDescription(object : SimpleSdpObserver() {
                            override fun onSetSuccess() {
                                sendSignal(
                                    SignalingEnvelope(
                                        type = "screen-share-answer", from = localPlayerId, to = from, shareId = shareId,
                                        routeVersion = message.routeVersion, answer = SdpPayload(desc.type.canonicalForm(), desc.description),
                                    ),
                                )
                            }
                        }, desc)
                    }
                }, MediaConstraints())
            }
        }, SessionDescription(SessionDescription.Type.OFFER, offer.sdp))
    }

    private fun processPendingOffers(shareId: String) {
        val offers = pendingOffers.values.filter { message ->
            val from = message.from ?: return@filter false
            if (message.routeVersion == null) {
                sharingShareId == shareId
            } else {
                expectedDownstreams[peerKey(shareId, from)] == message.routeVersion
            }
        }.toList()
        offers.forEach { message ->
            message.from?.let { pendingOffers.remove(relayOfferKey(shareId, it, message.routeVersion)) }
            handleViewerOffer(message)
        }
    }

    private fun rebuildRelayRoutes() {
        val shareId = sharingShareId ?: return
        routeVersion += 1
        val children = linkedMapOf<String, Int>()
        val eligibleRelays = linkedSetOf<String>()
        val parents = linkedMapOf<String, String>()
        var ownerChildren = 0
        for (viewerId in viewerOrder) {
            val candidates = listOf(localPlayerId) + eligibleRelays
            val upstream = candidates.firstOrNull { candidate ->
                val hasCapacity = if (candidate == localPlayerId) ownerChildren < 2 else (children[candidate] ?: 0) < 1
                hasCapacity && isRelayEdgeAvailable(candidate, viewerId)
            } ?: localPlayerId
            parents[viewerId] = upstream
            if (upstream == localPlayerId) ownerChildren++
            children[upstream] = (children[upstream] ?: 0) + 1
            if (viewerId in readyViewers && isRelayAvailable(viewerId)) eligibleRelays += viewerId
        }
        for ((viewerId, upstream) in parents) {
            val oldUpstream = assignedUpstreams[viewerId]
            if (oldUpstream != upstream) {
                if (oldUpstream != null && oldUpstream != upstream) {
                    pendingDetachUpstreams[viewerId] = oldUpstream
                }
                if (upstream == localPlayerId) {
                    expectedDownstreams[peerKey(shareId, viewerId)] = routeVersion
                } else {
                    sendSignal(
                        SignalingEnvelope(
                            type = "screen-share-relay", action = "child", from = localPlayerId, to = upstream,
                            shareId = shareId, downstreamId = viewerId, routeVersion = routeVersion,
                        ),
                    )
                }
                sendSignal(
                    SignalingEnvelope(
                        type = "screen-share-relay", action = "route", from = localPlayerId, to = viewerId,
                        shareId = shareId, upstreamId = upstream, routeVersion = routeVersion,
                    ),
                )
                assignedUpstreams[viewerId] = upstream
                assignedRouteVersions[viewerId] = routeVersion
                readyViewers.remove(viewerId)
            }
        }
        val stale = assignedUpstreams.keys.filter { it !in viewerOrder }
        stale.forEach {
            assignedUpstreams.remove(it)
            assignedRouteVersions.remove(it)
        }
        val head = viewerOrder.firstOrNull()
        sendSignal(
            SignalingEnvelope(
                type = "screen-share-update", from = localPlayerId, shareId = shareId,
                viewerId = head, viewerName = head?.let(viewerNames::get), viewerCount = viewerOrder.size,
            ),
        )
        onViewerCountChanged?.invoke(shareId, viewerOrder.size)
    }

    private fun isRelayAvailable(playerId: String): Boolean {
        val until = unhealthyRelays[playerId] ?: return true
        if (until <= android.os.SystemClock.elapsedRealtime()) {
            unhealthyRelays.remove(playerId)
            return true
        }
        return false
    }

    private fun isRelayEdgeAvailable(upstreamId: String, viewerId: String): Boolean {
        val key = upstreamId + ">" + viewerId
        val until = unhealthyEdges[key] ?: return true
        if (until <= android.os.SystemClock.elapsedRealtime()) {
            unhealthyEdges.remove(key)
            return true
        }
        return false
    }

    private fun scheduleRelayRecovery() {
        relayRecoveryCheck?.let(mainHandler::removeCallbacks)
        relayRecoveryCheck = null
        val now = android.os.SystemClock.elapsedRealtime()
        val nextExpiry = (unhealthyRelays.values + unhealthyEdges.values)
            .filter { it > now }
            .minOrNull() ?: return
        relayRecoveryCheck = Runnable {
            relayRecoveryCheck = null
            rebuildRelayRoutes()
            scheduleRelayRecovery()
        }.also { mainHandler.postDelayed(it, maxOf(250L, nextExpiry - now + 100L)) }
    }

    fun stopSharing() {
        val shareId = sharingShareId
        sharingShareId = null
        // 复位为 true：下次采集若是整屏，系统不会再回调可见性，
        // 残留的 false 会让界面一直显示“被采集应用已退到后台”。
        captureContentVisible = true
        viewerOrder.clear()
        viewerNames.clear()
        readyViewers.clear()
        assignedUpstreams.clear()
        assignedRouteVersions.clear()
        pendingDetachUpstreams.clear()
        unhealthyRelays.clear()
        unhealthyEdges.clear()
        relayFailureCounts.clear()
        relayRecoveryCheck?.let(mainHandler::removeCallbacks)
        relayRecoveryCheck = null
        shareId?.let { currentShareId ->
            outboundHealthChecks.keys.filter { it.startsWith("$currentShareId|") }.toList().forEach(::stopOutboundHealthHeartbeat)
            closeConnectionsForShare(outboundConnections, currentShareId)
            outboundSenders.keys.filter { it.startsWith("$currentShareId|") }.forEach(outboundSenders::remove)
            expectedDownstreams.keys.filter { it.startsWith("$currentShareId|") }.forEach(expectedDownstreams::remove)
            pendingOffers.keys.filter { it.startsWith("$currentShareId|") }.forEach(pendingOffers::remove)
            pendingIce.removeWhere { it.contains("$currentShareId|") }
        }
        runCatching { screenCapturer?.stopCapture() }
        screenCapturer?.dispose()
        screenCapturer = null
        localFrameProbe?.let { probe -> localVideoTrack?.removeSink(probe) }
        localVideoTrack?.dispose()
        localFrameProbe = null
        shareId?.let(sourceFrameSequences::remove)
        localVideoTrack = null
        videoSource?.dispose()
        videoSource = null
        surfaceHelper?.dispose()
        surfaceHelper = null
        sharePassword = null
        passwordAttemptLimiter.clear()
    }

    fun handleSignal(message: SignalingEnvelope) {
        when (message.type) {
            "screen-share-relay" -> handleRelayControl(message)
            "screen-share-offer" -> handleViewerOffer(message)
            "screen-share-answer" -> {
                val from = message.from ?: return
                val answer = message.answer ?: return
                val shareId = message.shareId ?: return
                if (message.to != localPlayerId || currentShareId != shareId || from != currentUpstreamId) return
                if (message.routeVersion != currentRouteVersion) return
                val pc = inboundConnections[peerKey(shareId, from)] ?: return
                pc.setRemoteDescription(object : SimpleSdpObserver() {
                    override fun onSetSuccess() { flushPendingIce(iceKey(shareId, "in", from, message.routeVersion), pc) }
                }, SessionDescription(SessionDescription.Type.ANSWER, answer.sdp))
            }
            "screen-share-ice-candidate" -> handleIce(message)
            "screen-share-viewer-left" -> {
                val shareId = message.shareId ?: return
                if (message.to != null && message.to != localPlayerId) return
                message.from?.let { handleViewerLeft(shareId, it) }
            }
        }
    }

    private fun handleRelayControl(message: SignalingEnvelope) {
        val shareId = message.shareId ?: return
        if (sharingShareId != shareId && currentShareId != shareId) return
        val ownerId = if (sharingShareId == shareId) localPlayerId else currentOwnerId ?: return
        val action = message.action ?: return
        if (message.to != localPlayerId) return
        if (action == "health") {
            if (sharingShareId == shareId || currentUpstreamId == null || message.from != currentUpstreamId) return
            if (message.routeVersion != currentRouteVersion) return
            val sourceSequence = message.sourceSequence ?: message.sequence ?: 0L
            if (sourceSequence < upstreamHealthSequence) return
            upstreamHealthId = message.from
            upstreamHealthVersion = message.routeVersion
            upstreamHealthSequence = sourceSequence
            upstreamHealthLimited = message.limited == true
            upstreamHealthAt = android.os.SystemClock.elapsedRealtime()
            return
        }
        when (action) {
            "join" -> if (localPlayerId == ownerId && sharingShareId == shareId) {
                val viewerId = message.from ?: return
                if (viewerId == localPlayerId || message.routeVersion != null || message.upstreamId != null || message.downstreamId != null) return
                if (!acceptViewerPassword(shareId, viewerId, message.password)) return
                if (viewerId !in viewerOrder) viewerOrder += viewerId
                viewerNames[viewerId] = message.playerName ?: top.pmh13.mctier.ui.L("玩家", "Player")
                sendSignal(
                    SignalingEnvelope(
                        type = "screen-share-relay", action = "accepted", from = localPlayerId, to = viewerId, shareId = shareId,
                    ),
                )
                rebuildRelayRoutes()
            }
            "ready" -> if (localPlayerId == ownerId && sharingShareId == shareId) {
                val viewerId = message.from ?: return
                if (viewerId !in viewerOrder) return
                val assignedVersion = assignedRouteVersions[viewerId] ?: return
                if (message.routeVersion != assignedVersion || message.upstreamId != null || message.downstreamId != null) return
                readyViewers += viewerId
                val oldUpstream = pendingDetachUpstreams.remove(viewerId)
                val activeUpstream = assignedUpstreams[viewerId]
                if (oldUpstream != null && oldUpstream != activeUpstream) {
                    if (oldUpstream == localPlayerId) {
                        expectedDownstreams.remove(peerKey(shareId, viewerId))
                        stopOutboundHealthHeartbeat(peerKey(shareId, viewerId))
                        outboundConnections.remove(peerKey(shareId, viewerId))?.close()
                        outboundSenders.remove(peerKey(shareId, viewerId))
                    } else {
                        sendSignal(SignalingEnvelope(type = "screen-share-relay", action = "detach", from = localPlayerId, to = oldUpstream, shareId = shareId, downstreamId = viewerId, routeVersion = message.routeVersion))
                    }
                }
                rebuildRelayRoutes()
            }
            "failure" -> if (localPlayerId == ownerId && sharingShareId == shareId) {
                val viewerId = message.from ?: return
                if (viewerId !in viewerOrder) return
                val assignedUpstream = assignedUpstreams[viewerId]
                val assignedVersion = assignedRouteVersions[viewerId] ?: return
                if (message.upstreamId != assignedUpstream || message.routeVersion != assignedVersion) return
                if (assignedUpstream != null) {
                    val failedUpstream = assignedUpstream
                    val count = (relayFailureCounts[failedUpstream] ?: 0) + 1
                    relayFailureCounts[failedUpstream] = count
                    val backoff = minOf(60_000L, 4_000L * (1L shl minOf(count - 1, 4)))
                    val until = android.os.SystemClock.elapsedRealtime() + backoff
                    if (failedUpstream != localPlayerId) unhealthyRelays[failedUpstream] = until
                    unhealthyEdges[failedUpstream + ">" + viewerId] = until
                    scheduleRelayRecovery()
                }
                if (assignedUpstream == localPlayerId) {
                    val key = peerKey(shareId, viewerId)
                    stopOutboundHealthHeartbeat(key)
                    expectedDownstreams.remove(key)
                    outboundConnections.remove(key)?.close()
                    outboundSenders.remove(key)
                } else if (assignedUpstream != null) {
                    sendSignal(SignalingEnvelope(type = "screen-share-relay", action = "detach", from = localPlayerId, to = assignedUpstream, shareId = shareId, downstreamId = viewerId, routeVersion = assignedVersion))
                }
                readyViewers.remove(viewerId)
                assignedUpstreams.remove(viewerId)
                assignedRouteVersions.remove(viewerId)
                rebuildRelayRoutes()
            }
            else -> {
                if (message.from != ownerId) return
                when (action) {
                    "accepted" -> if (message.routeVersion == null && message.upstreamId == null && message.downstreamId == null) Unit
                    "route" -> {
                        val upstreamId = message.upstreamId ?: return
                        if (upstreamId == localPlayerId) return
                        val version = message.routeVersion ?: return
                        if (version <= 0 || (currentRouteVersion != null && version < currentRouteVersion!!)) return
                        if (currentRouteVersion == version && currentUpstreamId != null && currentUpstreamId != upstreamId) return
                        connectUpstream(shareId, upstreamId, version)
                    }
                    "child" -> {
                        val downstreamId = message.downstreamId ?: return
                        if (downstreamId == localPlayerId) return
                        val version = message.routeVersion ?: return
                        if (version <= 0) return
                        val key = peerKey(shareId, downstreamId)
                        val previousVersion = expectedDownstreams[key]
                        if (previousVersion != null && version < previousVersion) return
                        expectedDownstreams[key] = version
                        pendingOffers.remove(relayOfferKey(shareId, downstreamId, version))?.let(::handleViewerOffer)
                        outboundConnections[key]?.let { pc ->
                            if (pc.remoteDescription != null) flushPendingIce(iceKey(shareId, "out", downstreamId, version), pc)
                        }
                    }
                    "detach" -> {
                        val downstreamId = message.downstreamId ?: return
                        val key = peerKey(shareId, downstreamId)
                        val expectedVersion = expectedDownstreams[key] ?: return
                        if (message.routeVersion != expectedVersion) return
                        expectedDownstreams.remove(key)
                        stopOutboundHealthHeartbeat(key)
                        outboundConnections.remove(key)?.close()
                        outboundSenders.remove(key)
                    }
                }
            }
        }
    }

    private fun handleIce(message: SignalingEnvelope) {
        val from = message.from ?: return
        val shareId = message.shareId ?: return
        val payload = message.candidate ?: return
        val ice = IceCandidate(payload.sdpMid, payload.sdpMLineIndex ?: 0, payload.candidate)
        if (message.to != localPlayerId) return
        val ownerMode = sharingShareId == shareId && localVideoTrack != null
        val viewerMode = currentShareId == shareId && currentOwnerId != null && !ownerMode
        if (!ownerMode && !viewerMode) return
        val routeVersion = message.routeVersion
        if (routeVersion != null && routeVersion <= 0) return
        val connectionKey = peerKey(shareId, from)
        val targetsInbound = when (message.connectionRole) {
            "in" -> {
                if (!viewerMode) return
                if (currentUpstreamId != null && from != currentUpstreamId) return
                if (routeVersion == null && from != currentOwnerId) return
                if (currentRouteVersion != null && routeVersion != currentRouteVersion) return
                true
            }
            "out" -> {
                if (routeVersion == null && !ownerMode) return
                val expectedVersion = expectedDownstreams[connectionKey]
                if (expectedVersion != null && routeVersion != expectedVersion) return
                false
            }
            null -> when {
                viewerMode && (from == currentUpstreamId || (currentUpstreamId == null && routeVersion != null)) -> {
                    if (routeVersion == null && from != currentOwnerId) return
                    if (currentRouteVersion != null && routeVersion != currentRouteVersion) return
                    true
                }
                ownerMode -> {
                    val expectedVersion = expectedDownstreams[connectionKey]
                    if (expectedVersion != null && routeVersion != expectedVersion) return
                    if (routeVersion == null && expectedVersion != null) return
                    false
                }
                else -> return
            }
            else -> return
        }
        val key = iceKey(shareId, if (targetsInbound) "in" else "out", from, routeVersion)
        val pc = if (targetsInbound) inboundConnections[peerKey(shareId, from)] else outboundConnections[peerKey(shareId, from)]
        val expectedVersion = if (targetsInbound) currentRouteVersion else expectedDownstreams[connectionKey]
        if (expectedVersion != null && routeVersion != expectedVersion) return
        if (pc?.remoteDescription != null) {
            runCatching { pc.addIceCandidate(ice) }
                .onFailure { if (!pendingIce.add(key, ice)) Log.w(TAG, "丢弃超出限制的待处理屏幕共享 ICE") }
        } else if (!pendingIce.add(key, ice)) {
            Log.w(TAG, "丢弃超出限制的待处理屏幕共享 ICE")
        }
    }

    private fun flushPendingIce(key: String, pc: PeerConnection) {
        pendingIce.remove(key)?.forEach(pc::addIceCandidate)
    }

    private fun handleViewerLeft(shareId: String, viewerId: String) {
        if (viewerId.isBlank() || viewerId == localPlayerId) return
        val key = peerKey(shareId, viewerId)
        val isOwner = sharingShareId == shareId && localVideoTrack != null
        val isKnownViewer = isOwner && viewerId in viewerOrder
        val isKnownDownstream = !isOwner && expectedDownstreams.containsKey(key)
        if (!isKnownViewer && !isKnownDownstream) return

        stopOutboundHealthHeartbeat(key)
        outboundConnections.remove(key)?.close()
        outboundSenders.remove(key)
        expectedDownstreams.remove(key)
        pendingOffers.keys.filter { it.startsWith("$shareId|$viewerId|") }.forEach(pendingOffers::remove)
        clearPendingIceForPeer(shareId, "out", viewerId)
        if (isOwner) {
            viewerOrder.remove(viewerId)
            viewerNames.remove(viewerId)
            readyViewers.remove(viewerId)
            assignedUpstreams.remove(viewerId)
            assignedRouteVersions.remove(viewerId)
            rebuildRelayRoutes()
        }
    }

    fun handlePlayerLeft(playerId: String) {
        sharingShareId?.let { handleViewerLeft(it, playerId) }
        currentShareId?.let { handleViewerLeft(it, playerId) }
        if (currentUpstreamId == playerId && currentOwnerId != null && currentShareId != null) {
            sendSignal(
                SignalingEnvelope(
                    type = "screen-share-relay", action = "failure", from = localPlayerId, to = currentOwnerId,
                    shareId = currentShareId, upstreamId = playerId, routeVersion = currentRouteVersion,
                ),
            )
        }
        if (currentOwnerId == playerId) stopViewing(notify = false)
    }

    fun release() {
        stopViewing(notify = false)
        stopSharing()
        runCatching { eglBase.release() }
    }

    private fun createPeerConnection(observer: PeerConnection.Observer): PeerConnection? =
        factory.createPeerConnection(
            PeerConnection.RTCConfiguration(emptyList()).apply { sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN },
            observer,
        )

    private fun baseObserver(
        onIce: (IceCandidate) -> Unit = {},
        onIceState: (PeerConnection.IceConnectionState) -> Unit = {},
        onTrack: (MediaStreamTrack?) -> Unit = {},
    ) = object : PeerConnection.Observer {
        override fun onIceCandidate(candidate: IceCandidate) = onIce(candidate)
        override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) = onIceState(state)
        override fun onAddTrack(receiver: RtpReceiver, streams: Array<out MediaStream>) = onTrack(receiver.track())
        override fun onSignalingChange(state: PeerConnection.SignalingState) = Unit
        override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
        override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) = Unit
        override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) = Unit
        override fun onAddStream(stream: MediaStream) = Unit
        override fun onRemoveStream(stream: MediaStream) = Unit
        override fun onDataChannel(channel: DataChannel) = Unit
        override fun onRenegotiationNeeded() = Unit
    }

    private fun IceCandidate.toPayload() = IcePayload(sdp, sdpMLineIndex, sdpMid)

    private fun peerKey(shareId: String, playerId: String) = "$shareId|$playerId"

    private fun relayOfferKey(shareId: String, playerId: String, routeVersion: Int?) =
        "$shareId|$playerId|${routeVersion ?: "legacy"}"

    private fun iceKey(shareId: String, direction: String, playerId: String, routeVersion: Int?) =
        "$direction:$shareId|$playerId|${routeVersion ?: "legacy"}"

    private fun icePeer(key: String): String =
        key.substringAfter(':').substringAfter('|').substringBefore('|')

    private fun acceptViewerPassword(shareId: String, viewerId: String, supplied: String?): Boolean {
        val expected = sharePassword ?: return true
        val key = "$shareId|$viewerId"
        if (!passwordAttemptLimiter.beforeAttempt(key).allowed) {
            sendPasswordError(shareId, viewerId)
            return false
        }
        if (supplied == expected) {
            passwordAttemptLimiter.recordSuccess(key)
            return true
        }
        passwordAttemptLimiter.recordFailure(key)
        sendPasswordError(shareId, viewerId)
        return false
    }

    private fun sendPasswordError(shareId: String, viewerId: String) {
        sendSignal(
            SignalingEnvelope(
                type = "screen-share-error", from = localPlayerId, to = viewerId, shareId = shareId,
                error = top.pmh13.mctier.ui.L("屏幕共享密码错误", "Wrong screen share password"),
            ),
        )
    }

    private fun clearPendingIceForPeer(shareId: String, direction: String, playerId: String) {
        val prefix = "$direction:$shareId|$playerId|"
        pendingIce.removeWhere { it.startsWith(prefix) }
    }

    private fun closeConnectionsForShare(connections: MutableMap<String, PeerConnection>, shareId: String) {
        connections.keys.filter { it.startsWith("$shareId|") }.forEach { key ->
            connections.remove(key)?.close()
        }
    }

    private companion object {
        private const val TAG = "ScreenShareController"

        private const val MAX_PENDING_ICE_ENTRIES = 512
        private const val MAX_PENDING_ICE_BYTES = 512 * 1024
        private const val MAX_PENDING_ICE_PER_PEER = 64
        private const val PENDING_ICE_TTL_MILLIS = 15_000L
        private const val MAX_PASSWORD_BACKOFF_ENTRIES = 1024
        private const val PASSWORD_BACKOFF_BASE_MILLIS = 1_000L
        private const val PASSWORD_BACKOFF_MAX_MILLIS = 60_000L
        private const val PASSWORD_BACKOFF_TTL_MILLIS = 15 * 60_000L

        /** 采集帧率。startCapture 与 changeCaptureFormat 必须用同一个值，否则重设格式会顺带改帧率。 */
        private const val CAPTURE_FPS = 15

        /** 编码分辨率上限。按长短边约束而不是按宽高分别约束，见 captureDimensions 的说明。 */
        private const val CAPTURE_MAX_SHORT_EDGE = 1280
        private const val CAPTURE_MAX_LONG_EDGE = 2280

        private fun iceCandidateBytes(candidate: IceCandidate): Int =
            candidate.sdp.toByteArray(Charsets.UTF_8).size +
                (candidate.sdpMid?.toByteArray(Charsets.UTF_8)?.size ?: 0) + 16

        /**
         * 把内容尺寸压到编码上限内，并保持宽高比。
         *
         * 原实现用 `width.coerceAtMost(1280)` / `height.coerceAtMost(2280)` 分别裁剪，
         * 两个维度独立设限会改变宽高比（横屏设备、以及“单个应用”采集的窄窗口尤其明显），
         * 观看端看到的画面会被拉伸。这里改为按长短边等比缩放。
         *
         * 结果强制为偶数：多数硬件 H.264 编码器要求宽高为偶数，奇数会导致初始化失败或画面错位。
         */
        fun captureDimensions(contentWidth: Int, contentHeight: Int): Pair<Int, Int> {
            // 兜底：拿不到有效尺寸时退回竖屏上限，不能返回 0（VirtualDisplay 会直接抛异常）
            if (contentWidth <= 0 || contentHeight <= 0) {
                return CAPTURE_MAX_SHORT_EDGE to CAPTURE_MAX_LONG_EDGE
            }
            val shortEdge = minOf(contentWidth, contentHeight)
            val longEdge = maxOf(contentWidth, contentHeight)
            val scale = minOf(
                1.0,
                CAPTURE_MAX_SHORT_EDGE.toDouble() / shortEdge,
                CAPTURE_MAX_LONG_EDGE.toDouble() / longEdge,
            )
            fun even(value: Double): Int = (value.toInt() / 2 * 2).coerceAtLeast(2)
            return even(contentWidth * scale) to even(contentHeight * scale)
        }
    }
}
