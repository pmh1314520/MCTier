package top.pmh13.mctier.ui

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.BackHandler
import kotlinx.coroutines.launch
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.ui.res.painterResource
import top.pmh13.mctier.R
import androidx.compose.foundation.background
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.basicMarquee
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.Login
import androidx.compose.material.icons.automirrored.rounded.Logout
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.BarChart
import androidx.compose.material.icons.rounded.Build
import androidx.compose.material.icons.rounded.ArrowDropDown
import androidx.compose.material.icons.rounded.Casino
import androidx.compose.material.icons.rounded.Chat
import androidx.compose.material.icons.rounded.Checklist
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.PersonAdd
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.material.icons.rounded.ArrowDownward
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.EmojiEmotions
import androidx.compose.material.icons.rounded.Folder
import androidx.compose.material.icons.rounded.Fullscreen
import androidx.compose.material.icons.rounded.FullscreenExit
import androidx.compose.material.icons.rounded.Group
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material.icons.rounded.Wifi
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.Apps
import androidx.compose.material.icons.rounded.Mouse
import androidx.compose.material.icons.rounded.MilitaryTech
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.MicOff
import androidx.compose.material.icons.rounded.Photo
import androidx.compose.material.icons.rounded.Public
import androidx.compose.material.icons.rounded.Campaign
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.QrCodeScanner
import androidx.compose.material.icons.rounded.QrCode2
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.ScreenShare
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.SettingsRemote
import androidx.compose.material.icons.rounded.SportsEsports
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material.icons.rounded.StarBorder
import androidx.compose.material.icons.rounded.VolumeOff
import androidx.compose.material.icons.rounded.VolumeUp
import androidx.compose.material.icons.rounded.WorkspacePremium
import androidx.compose.material.icons.rounded.Visibility
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material.icons.rounded.WifiTethering
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.ui.input.pointer.pointerInteropFilter
import androidx.compose.ui.zIndex
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack
import top.pmh13.mctier.MctierRepository
import top.pmh13.mctier.MctierUiState
import top.pmh13.mctier.data.AppConnectionState
import top.pmh13.mctier.data.AppClientVersion
import top.pmh13.mctier.data.BuiltinNodes
import top.pmh13.mctier.data.ChatMessage
import top.pmh13.mctier.data.RemoteFileInfo
import top.pmh13.mctier.data.RemoteShareEntry
import top.pmh13.mctier.data.ScreenShareInfo
import top.pmh13.mctier.data.SharedFolder
import top.pmh13.mctier.data.UserSettings
import top.pmh13.mctier.network.UpdateChecker

// —— 主题调色板：用 mutableStateOf 支持的顶层 var，组合内读取后随主题切换实时重组 ——
internal var GrassGreen by mutableStateOf(Color(0xFF52C41A))
internal var GrassGreenDark by mutableStateOf(Color(0xFF3C9A12))
internal var DirtBrown by mutableStateOf(Color(0xFFB07C46))
internal var DirtBrownDeep by mutableStateOf(Color(0xFF8C5A2B))
internal val DangerRed = Color(0xFFE5484D)
internal var PageBgTop by mutableStateOf(Color(0xFF1C1C2A))
internal var PageBg by mutableStateOf(Color(0xFF121220))
internal var Panel by mutableStateOf(Color(0xFF20202F))
internal var PanelHigh by mutableStateOf(Color(0xFF2B2B40))
internal var Hairline by mutableStateOf(Color(0x1FFFFFFF))
/** 主文本/图标颜色：深色主题=白，浅色主题=近黑（取代原先硬编码的 Color.White） */
internal var TextPrimary by mutableStateOf(Color(0xFFFFFFFF))

// —— 界面语言：顶层 var，切换后所有读取 L(...) 的组合实时重组 ——
internal var appLang by mutableStateOf("zh")

/** 双语取词：根据当前语言返回中文或英文 */
internal fun L(zh: String, en: String): String = if (appLang == "en") en else zh

/** 应用语言设置（""=跟随系统，匹配不到回退中文） */
fun applyAppLanguage(lang: String) {
    appLang = when (lang) {
        "en" -> "en"
        "zh" -> "zh"
        else -> if (java.util.Locale.getDefault().language.lowercase().startsWith("zh")) "zh" else "en"
    }
}

/** 解析主色十六进制（空=默认绿） */
private fun parseAccent(hex: String): Color =
    if (hex.isBlank()) Color(0xFF52C41A)
    else runCatching { Color(android.graphics.Color.parseColor(hex)) }.getOrDefault(Color(0xFF52C41A))

/** 把主色调暗一档，用于渐变/按下态 */
private fun darken(c: Color, f: Float = 0.78f): Color =
    Color(c.red * f, c.green * f, c.blue * f, c.alpha)

/**
 * 应用主题：实时改写全局调色板 var，所有组合中的颜色随之重组。
 * @param mode "light" 或 "dark"
 * @param primaryHex 自定义主色十六进制（空=默认绿）
 */
fun applyAppTheme(mode: String, primaryHex: String) {
    val accent = parseAccent(primaryHex)
    GrassGreen = accent
    GrassGreenDark = darken(accent)
    if (mode == "light") {
        PageBgTop = Color(0xFFF7F8FC)
        PageBg = Color(0xFFEDEFF5)
        Panel = Color(0xFFFFFFFF)
        PanelHigh = Color(0xFFE9ECF3)
        Hairline = Color(0x14000000)
        TextPrimary = Color(0xFF1A1B22)
        DirtBrown = Color(0xFF9A6A38)
        DirtBrownDeep = Color(0xFF7C5226)
    } else {
        PageBgTop = Color(0xFF1C1C2A)
        PageBg = Color(0xFF121220)
        Panel = Color(0xFF20202F)
        PanelHigh = Color(0xFF2B2B40)
        Hairline = Color(0x1FFFFFFF)
        TextPrimary = Color(0xFFFFFFFF)
        DirtBrown = Color(0xFFB07C46)
        DirtBrownDeep = Color(0xFF8C5A2B)
    }
}

@Composable
fun MctierApp(repository: MctierRepository, onConsentGranted: () -> Unit = {}) {
    val state by repository.state.collectAsState()
    val consentCtx = androidx.compose.ui.platform.LocalContext.current
    var agreed by remember { mutableStateOf(ConsentStore.isAgreed(consentCtx)) }
    LaunchedEffect(Unit) { repository.maybeAutoJoin() }
    // 主题：根据设置实时应用（深/浅色 + 自定义主色），切换即重组整个界面
    LaunchedEffect(state.settings.themeMode, state.settings.themePrimary) {
        applyAppTheme(state.settings.themeMode, state.settings.themePrimary)
    }
    // 语言：根据设置实时应用，切换即重组整个界面
    LaunchedEffect(state.settings.language) {
        applyAppLanguage(state.settings.language)
    }
    var booting by remember { mutableStateOf(true) }
    LaunchedEffect(Unit) { kotlinx.coroutines.delay(1300); booting = false }
    val accent = GrassGreen
    val isLight = state.settings.themeMode == "light"
    val scheme = if (isLight) lightColorScheme(
        primary = accent, onPrimary = Color(0xFFFFFFFF), secondary = DirtBrown,
        background = PageBg, surface = Panel, surfaceVariant = PanelHigh,
        onBackground = TextPrimary, onSurface = TextPrimary,
        onSurfaceVariant = TextPrimary.copy(alpha = 0.7f), error = DangerRed,
    ) else darkColorScheme(
        primary = accent, onPrimary = Color(0xFFFFFFFF), secondary = DirtBrown,
        background = PageBg, surface = Panel, surfaceVariant = PanelHigh,
        onBackground = TextPrimary, onSurface = TextPrimary,
        onSurfaceVariant = TextPrimary.copy(alpha = 0.7f), error = DangerRed,
    )
    MaterialTheme(
        colorScheme = scheme,
    ) {
        if (!agreed) {
            // 首次启动：必须同意隐私政策与用户协议方可使用；不同意则退出
            ConsentScreen(
                onAgree = {
                    ConsentStore.setAgreed(consentCtx, true)
                    agreed = true
                    onConsentGranted()
                },
                onDisagree = {
                    (consentCtx as? android.app.Activity)?.finishAffinity()
                },
            )
            return@MaterialTheme
        }
        Box(
            Modifier
                .fillMaxSize()
                .background(Brush.verticalGradient(listOf(PageBgTop, PageBg))),
        ) {
            AnimatedContent(
                targetState = state.state == AppConnectionState.InLobby && state.lobby != null,
                transitionSpec = {
                    val dur = 320
                    (fadeIn(animationSpec = androidx.compose.animation.core.tween(dur)) +
                        androidx.compose.animation.scaleIn(initialScale = 0.96f, animationSpec = androidx.compose.animation.core.tween(dur)) +
                        androidx.compose.animation.slideInHorizontally(animationSpec = androidx.compose.animation.core.tween(dur)) { if (targetState) it / 8 else -it / 8 }) togetherWith
                        fadeOut(animationSpec = androidx.compose.animation.core.tween(220))
                },
                label = "mctier-root",
            ) { inLobby ->
                if (inLobby) LobbyScreen(state, repository) else HomeScreen(state, repository)
            }
            if (state.showOnboarding) OnboardingDialog { repository.dismissOnboarding() }
            // 启动加载动画（淡出）
            androidx.compose.animation.AnimatedVisibility(
                visible = booting,
                enter = fadeIn(),
                exit = fadeOut(),
            ) { SplashScreen() }
            // 版本过低（信令服务器要求）：强制更新，阻断使用
            state.versionError?.let { VersionErrorDialog(it, repository) }
            // Gitee 检测到新版本：可选更新提示（无强制更新弹窗时才显示）
            if (state.versionError == null) {
                state.updateAvailable?.let { UpdateAvailableDialog(it, repository) }
            }
            // 远程控制（电脑控制本机手机）：请求弹窗 + 被控横幅
            RemoteControlGate(state, repository)
            // 高风险功能一次性同意门控宿主
            FeatureGateHost()
        }
    }
}

@Composable
private fun RemoteControlGate(state: MctierUiState, repository: MctierRepository) {
    val ctx = LocalContext.current
    val req = state.remoteControlRequest
    // MediaProjection 授权回调：拿到授权后真正接受控制
    val projectionLauncher = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        if (result.resultCode == android.app.Activity.RESULT_OK && result.data != null) {
            repository.acceptRemoteControl(result.data!!)
        } else {
            android.widget.Toast.makeText(ctx, L("已取消：未授予屏幕录制权限", "Cancelled: screen capture permission not granted"), android.widget.Toast.LENGTH_SHORT).show()
            repository.rejectRemoteControl()
        }
    }

    // 收到控制请求：弹窗确认
    if (req != null) {
        AlertDialog(
            onDismissRequest = { repository.rejectRemoteControl() },
            confirmButton = {
                androidx.compose.material3.TextButton(onClick = {
                    // 需先开启无障碍服务才能注入触摸
                    if (!top.pmh13.mctier.service.MctierAccessibilityService.isEnabledInSettings(ctx)) {
                        android.widget.Toast.makeText(ctx, L("请先开启 MCTier 无障碍服务以允许远程操作", "Please enable MCTier accessibility service first"), android.widget.Toast.LENGTH_LONG).show()
                        runCatching { ctx.startActivity(android.content.Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
                        return@TextButton
                    }
                    // 暂存请求并请求 MediaProjection 授权
                    if (repository.beginAcceptRemoteControl() != null) {
                        val mpm = ctx.getSystemService(android.content.Context.MEDIA_PROJECTION_SERVICE) as android.media.projection.MediaProjectionManager
                        projectionLauncher.launch(mpm.createScreenCaptureIntent())
                    }
                }) { Text(L("接受", "Accept"), color = GrassGreen, fontWeight = FontWeight.SemiBold) }
            },
            dismissButton = {
                androidx.compose.material3.TextButton(onClick = { repository.rejectRemoteControl() }) {
                    Text(L("拒绝", "Reject"), color = TextPrimary.copy(alpha = 0.7f))
                }
            },
            title = { Text(L("远程控制请求", "Remote Control Request"), color = TextPrimary, fontWeight = FontWeight.Bold) },
            text = {
                Text(
                    L(
                        "「${req.fromName}」请求远程控制你的手机。\n\n· 用途：接受后对方可实时看到你的屏幕画面，并对你的手机进行点击/滑动等操作，需开启无障碍权限与屏幕录制权限。\n· 你的控制权：控制期间顶部会显示横幅，你可随时点「停止」结束，或关闭无障碍/录屏权限立即终止。\n· 风险提示：请仅在你信任的人之间使用，避免在屏幕上展示银行、验证码、隐私等敏感信息。\n· 禁止用途：严禁用于偷窥、窃取信息、非法控制等行为，否则相关责任由控制方承担并可能触犯法律。\n\n确认要接受吗？",
                        "\"${req.fromName}\" requests to remotely control your phone.\n\n- Purpose: they will see your screen in real time and can tap/swipe on your phone; accessibility and screen-capture permissions are required.\n- Your control: a banner stays on top during the session; tap \"Stop\" anytime, or revoke accessibility/capture permission to end it immediately.\n- Risk: use only with people you trust; avoid showing bank info, verification codes or private data on screen.\n- Prohibited: spying, stealing information or unauthorized control are strictly forbidden and may violate the law.\n\nAccept?",
                    ),
                    color = TextPrimary.copy(alpha = 0.85f), fontSize = 13.sp, lineHeight = 19.sp,
                )
            },
            containerColor = PanelHigh,
        )
    }

    // 正在被控制：顶部横幅 + 停止按钮
    val activeBy = state.remoteControlActiveBy
    if (activeBy != null) {
        Box(
            Modifier.fillMaxWidth().statusBarsPadding().padding(10.dp),
            contentAlignment = Alignment.TopCenter,
        ) {
            Row(
                Modifier.clip(RoundedCornerShape(12.dp)).background(DangerRed.copy(alpha = 0.92f))
                    .padding(horizontal = 14.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(L("正在被「$activeBy」远程控制", "Being controlled by \"$activeBy\""), color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.width(12.dp))
                Box(
                    Modifier.clip(RoundedCornerShape(8.dp)).background(Color.White.copy(alpha = 0.25f))
                        .clickable { repository.stopRemoteControl() }
                        .padding(horizontal = 10.dp, vertical = 5.dp),
                ) { Text(L("停止", "Stop"), color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold) }
            }
        }
    }

    // 本机正在远程控制对方设备：全屏查看器（渲染对方屏幕 + 触摸操作）
    val controllingPeer = state.remoteControllingPeer
    if (controllingPeer != null) {
        RemoteControlControllerView(repository, controllingPeer)
    }
}

@Composable
private fun RcToolBtn(icon: ImageVector, desc: String, active: Boolean = false, onClick: () -> Unit) {
    Box(
        Modifier.padding(horizontal = 3.dp).size(34.dp).clip(RoundedCornerShape(8.dp))
            .background(if (active) GrassGreen.copy(alpha = 0.28f) else PanelHigh)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, desc, tint = if (active) GrassGreen else TextPrimary.copy(alpha = 0.85f), modifier = Modifier.size(18.dp))
    }
}

@OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class)
@Composable
private fun RemoteControlControllerView(repository: MctierRepository, peerName: String) {
    val controller = repository.remoteControl
    val ctx = LocalContext.current
    var track by remember { mutableStateOf<VideoTrack?>(null) }
    var frameW by remember { mutableStateOf(0) }
    var frameH by remember { mutableStateOf(0) }
    var viewW by remember { mutableStateOf(1) }
    var viewH by remember { mutableStateOf(1) }
    var rightClick by remember { mutableStateOf(false) }
    var showKeyboard by remember { mutableStateOf(false) }
    var kbText by remember { mutableStateOf("") }
    val mainHandler = remember { android.os.Handler(android.os.Looper.getMainLooper()) }

    DisposableEffect(controller) {
        controller?.onControllerVideoTrack = { t -> mainHandler.post { track = t } }
        onDispose { controller?.onControllerVideoTrack = null }
    }

    // 沉浸式全屏 + 根据对方屏幕宽高比自动选择横屏/竖屏，最大化利用屏幕
    val activity = ctx as? android.app.Activity
    DisposableEffect(activity) {
        val original = activity?.requestedOrientation ?: android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        val win = activity?.window
        val insetsController = win?.let { androidx.core.view.WindowCompat.getInsetsController(it, it.decorView) }
        insetsController?.let {
            it.systemBarsBehavior = androidx.core.view.WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            it.hide(androidx.core.view.WindowInsetsCompat.Type.systemBars())
        }
        onDispose {
            activity?.requestedOrientation = original
            insetsController?.show(androidx.core.view.WindowInsetsCompat.Type.systemBars())
        }
    }
    // 对方屏幕为横向(宽>高)则本机横屏，否则竖屏；分辨率到达后再决定
    LaunchedEffect(frameW, frameH) {
        if (frameW > 0 && frameH > 0) {
            activity?.requestedOrientation = if (frameW > frameH)
                android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            else
                android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
        }
    }

    fun sendRaw(json: String) {
        repository.remoteControl?.sendInput(json)
    }
    fun sendEvent(kind: String, xPx: Float, yPx: Float) {
        val fw = if (frameW > 0) frameW.toFloat() else viewW.toFloat()
        val fh = if (frameH > 0) frameH.toFloat() else viewH.toFloat()
        val scale = minOf(viewW / fw, viewH / fh)
        val contentW = fw * scale
        val contentH = fh * scale
        val offX = (viewW - contentW) / 2f
        val offY = (viewH - contentH) / 2f
        val nx = ((xPx - offX) / contentW).coerceIn(0f, 1f)
        val ny = ((yPx - offY) / contentH).coerceIn(0f, 1f)
        // 右键模式：本次按下/抬起用 button=2（电脑→右键，手机→长按），抬起后自动复位
        val btn = if (rightClick) 2 else 0
        val json = "[{\"kind\":\"$kind\",\"button\":$btn,\"x\":$nx,\"y\":$ny}]"
        sendRaw(json)
        if (kind == "up" && rightClick) rightClick = false
    }
    fun jsonEscape(s: String): String = s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "")

    Box(Modifier.fillMaxSize().background(Color.Black).zIndex(50f)) {
        Column(Modifier.fillMaxSize().statusBarsPadding()) {
            Row(
                Modifier.fillMaxWidth().background(Panel).padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Rounded.SettingsRemote, null, tint = GrassGreen, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(8.dp))
                Text(L("控制「$peerName」", "Controlling \"$peerName\""), color = TextPrimary, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                // 工具栏：键盘 / 右键 / 返回 / 主页 / 最近
                RcToolBtn(Icons.Rounded.Edit, L("键盘", "Keyboard"), active = showKeyboard) { showKeyboard = !showKeyboard }
                RcToolBtn(Icons.Rounded.Mouse, L("右键", "Right-click"), active = rightClick) { rightClick = !rightClick }
                RcToolBtn(Icons.AutoMirrored.Rounded.ArrowBack, L("返回/ESC", "Back/ESC")) { sendRaw("[{\"kind\":\"keyup\",\"code\":27}]") }
                RcToolBtn(Icons.Rounded.Home, L("主页", "Home")) { sendRaw("[{\"kind\":\"key\",\"key\":\"home\"}]") }
                RcToolBtn(Icons.Rounded.Apps, L("最近", "Recents")) { sendRaw("[{\"kind\":\"key\",\"key\":\"recents\"}]") }
                Spacer(Modifier.width(6.dp))
                Box(
                    Modifier.clip(RoundedCornerShape(8.dp)).background(DangerRed)
                        .clickable { repository.stopRemoteControl() }
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                ) { Text(L("结束", "End"), color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Bold) }
            }
            // 软键盘输入行：输入文本即时发送到被控端聚焦的输入框
            if (showKeyboard) {
                Row(
                    Modifier.fillMaxWidth().background(PanelHigh).padding(horizontal = 10.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    OutlinedTextField(
                        value = kbText,
                        onValueChange = { new ->
                            // 追加的字符立即作为 text 发送；退格作为 backspace 键
                            if (new.length > kbText.length) {
                                val added = new.substring(kbText.length)
                                sendRaw("[{\"kind\":\"text\",\"text\":\"${jsonEscape(added)}\"}]")
                            } else if (new.length < kbText.length) {
                                repeat(kbText.length - new.length) { sendRaw("[{\"kind\":\"keyup\",\"code\":8}]") }
                            }
                            kbText = new
                        },
                        placeholder = { Text(L("在此输入，实时发送到对方", "Type here, sent live"), fontSize = 12.sp) },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                        colors = fieldColors(),
                    )
                    Spacer(Modifier.width(6.dp))
                    RcToolBtn(Icons.AutoMirrored.Rounded.Send, L("回车", "Enter")) { sendRaw("[{\"kind\":\"keyup\",\"code\":13}]") }
                }
            }
            Box(
                Modifier.fillMaxWidth().weight(1f).background(Color.Black)
                    .onSizeChanged { viewW = it.width.coerceAtLeast(1); viewH = it.height.coerceAtLeast(1) }
                    .pointerInteropFilter { ev ->
                        when (ev.actionMasked) {
                            android.view.MotionEvent.ACTION_DOWN -> sendEvent("down", ev.x, ev.y)
                            android.view.MotionEvent.ACTION_MOVE -> sendEvent("move", ev.x, ev.y)
                            android.view.MotionEvent.ACTION_UP, android.view.MotionEvent.ACTION_CANCEL -> sendEvent("up", ev.x, ev.y)
                        }
                        true
                    },
                contentAlignment = Alignment.Center,
            ) {
                if (controller != null) {
                    AndroidView(
                        factory = { c ->
                            SurfaceViewRenderer(c).apply {
                                init(controller.eglBase.eglBaseContext, object : RendererCommon.RendererEvents {
                                    override fun onFirstFrameRendered() {}
                                    override fun onFrameResolutionChanged(w: Int, h: Int, rotation: Int) {
                                        mainHandler.post {
                                            if (rotation % 180 == 0) { frameW = w; frameH = h } else { frameW = h; frameH = w }
                                        }
                                    }
                                })
                                setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FIT)
                                setEnableHardwareScaler(true)
                                track?.let { runCatching { it.addSink(this) } }
                            }
                        },
                        update = { view -> track?.let { runCatching { it.addSink(view) } } },
                        modifier = Modifier.fillMaxSize(),
                    )
                }
                if (track == null) {
                    Text(L("等待对方接受并共享屏幕…", "Waiting for the other side to accept and share..."), color = TextPrimary.copy(alpha = 0.5f))
                }
            }
        }
    }
}

@Composable
private fun VersionErrorDialog(alert: top.pmh13.mctier.data.VersionAlert, repository: MctierRepository) {
    var progress by remember { mutableIntStateOf(-1) }
    var err by remember { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = { /* 强制更新，不可关闭 */ },
        containerColor = Panel,
        title = { Text(L("需要更新 MCTier", "Update Required"), color = DangerRed, fontWeight = FontWeight.Bold) },
        text = {
            Column {
                Text(L("当前客户端版本过低，已被服务器拒绝。请更新到最新版后再创建或加入大厅。", "Your client version is too old and was rejected by the server. Please update before creating or joining a lobby."), color = TextPrimary.copy(alpha = 0.85f), fontSize = 13.sp)
                Spacer(Modifier.height(10.dp))
                Text(L("当前版本：", "Current: ") + alert.current, color = TextPrimary.copy(alpha = 0.7f), fontSize = 12.sp)
                Text(L("最低要求：", "Minimum: ") + alert.minimum, color = GrassGreen, fontSize = 12.sp)
                if (progress in 0..100) {
                    Spacer(Modifier.height(10.dp))
                    Text(L("下载中 ", "Downloading ") + "$progress%", color = GrassGreen, fontSize = 13.sp)
                }
                if (err != null) {
                    Spacer(Modifier.height(8.dp))
                    Text(L("更新失败：", "Update failed: ") + err, color = DangerRed, fontSize = 12.sp)
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = progress !in 0..100,
                onClick = {
                    err = null; progress = 0
                    repository.startInAppUpdate(onProgress = { progress = it }, onError = { err = it; progress = -1 })
                },
            ) { Text(if (progress in 0..100) L("更新中…", "Updating...") else L("一键更新到最新版", "Update to latest"), color = GrassGreen, fontWeight = FontWeight.Bold) }
        },
    )
}

@Composable
private fun UpdateAvailableDialog(latest: String, repository: MctierRepository) {
    var progress by remember { mutableIntStateOf(-1) }
    var err by remember { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = { repository.dismissUpdateAvailable() },
        containerColor = Panel,
        title = { Text(L("发现新版本 v", "New version v") + latest, color = TextPrimary, fontWeight = FontWeight.Bold) },
        text = {
            Column {
                Text(L("检测到 MCTier 有新版本，建议更新以获得最新功能与互通修复。", "A new version of MCTier is available. Update for the latest features and fixes."), color = TextPrimary.copy(alpha = 0.85f), fontSize = 13.sp)
                if (progress in 0..100) {
                    Spacer(Modifier.height(10.dp))
                    Text(L("下载中 ", "Downloading ") + "$progress%", color = GrassGreen, fontSize = 13.sp)
                }
                if (err != null) {
                    Spacer(Modifier.height(8.dp))
                    Text(L("更新失败：", "Update failed: ") + err, color = DangerRed, fontSize = 12.sp)
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = progress !in 0..100,
                onClick = {
                    err = null; progress = 0
                    repository.startInAppUpdate(onProgress = { progress = it }, onError = { err = it; progress = -1 })
                },
            ) { Text(if (progress in 0..100) L("更新中…", "Updating...") else L("立即更新", "Update now"), color = GrassGreen, fontWeight = FontWeight.Bold) }
        },
        dismissButton = {
            TextButton(enabled = progress !in 0..100, onClick = { repository.dismissUpdateAvailable() }) { Text(L("稍后", "Later"), color = TextPrimary.copy(alpha = 0.6f)) }
        },
    )
}

@Composable
private fun SplashScreen() {
    val scale = remember { androidx.compose.animation.core.Animatable(0.7f) }
    LaunchedEffect(Unit) {
        scale.animateTo(1f, animationSpec = androidx.compose.animation.core.tween(700, easing = androidx.compose.animation.core.FastOutSlowInEasing))
    }
    Box(
        Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(PageBgTop, PageBg))),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Image(
                painterResource(R.drawable.mctier_logo), "MCTier",
                modifier = Modifier.size(96.dp).graphicsLayer(scaleX = scale.value, scaleY = scale.value),
            )
            Spacer(Modifier.height(18.dp))
            Text("MCTier", fontSize = 26.sp, fontWeight = FontWeight.Bold, color = TextPrimary)
            Spacer(Modifier.height(4.dp))
            Text(L("虚拟局域网通用联机工具", "Universal VLAN Gaming Tool"), fontSize = 12.sp, color = TextPrimary.copy(alpha = 0.55f))
            Spacer(Modifier.height(28.dp))
            CircularProgressIndicator(color = GrassGreen, strokeWidth = 3.dp, modifier = Modifier.size(28.dp))
        }
    }
}

@Composable
private fun OnboardingDialog(onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Panel,
        title = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.WifiTethering, null, tint = GrassGreen)
                Spacer(Modifier.width(8.dp))
                Text(L("欢迎使用 MCTier", "Welcome to MCTier"), color = TextPrimary)
            }
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OnboardStep("1", L("填写大厅名称与密码，点创建/加入，即可与电脑端好友组网联机", "Enter a lobby name and password, then create/join to play with desktop friends"))
                OnboardStep("2", L("首次需授予 VPN 与麦克风权限，否则无法组网与语音", "Grant VPN and microphone permissions on first use, or networking and voice will not work"))
                OnboardStep("3", L("进入大厅后可语音、聊天、共享文件；房主可在设置里管理成员", "In a lobby you can talk, chat and share files; the host can manage members in settings"))
                OnboardStep("4", L("大厅名称、密码需与电脑端完全一致才能互通", "Lobby name and password must exactly match the desktop side"))
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(L("开始使用", "Get Started"), color = GrassGreen) } },
    )
}

@Composable
private fun OnboardStep(num: String, text: String) {
    Row(verticalAlignment = Alignment.Top) {
        Box(
            Modifier.size(22.dp).clip(CircleShape).background(GrassGreen.copy(alpha = 0.2f)),
            contentAlignment = Alignment.Center,
        ) { Text(num, fontSize = 12.sp, color = GrassGreen, fontWeight = FontWeight.Bold) }
        Spacer(Modifier.width(10.dp))
        Text(text, fontSize = 13.sp, color = TextPrimary.copy(alpha = 0.85f))
    }
}

// ============================ 首页 ============================
@Composable
private fun HomeScreen(state: MctierUiState, repository: MctierRepository) {
    var lobbyName by remember { mutableStateOf(state.settings.autoLobbyName) }
    var password by remember { mutableStateOf(state.settings.autoLobbyPassword) }
    // 从公开广场选择大厅时同步到的房主节点（手动改大厅名会清空，避免误用）
    var plazaNode by remember { mutableStateOf<String?>(null) }
    var showSettings by remember { mutableStateOf(false) }
    var showPlaza by remember { mutableStateOf(false) }
    var showFavorites by remember { mutableStateOf(false) }
    var showRecent by remember { mutableStateOf(false) }
    val connecting = state.state == AppConnectionState.Connecting
    var mode by remember { mutableStateOf("create") } // create / join，对齐桌面端模式切换
    val ctx = LocalContext.current

    // 邀请 deep link：收到预填信息后自动填入并切到加入模式（仅填表，不自动连接）
    LaunchedEffect(state.pendingJoin) {
        state.pendingJoin?.let { pj ->
            lobbyName = pj.name
            password = pj.pwd
            mode = "join"
            repository.consumePendingJoin()
        }
    }

    // 扫码加入：扫描其他端展示的大厅二维码，解析后自动填入并切到加入模式
    val scanLauncher = rememberLauncherForActivityResult(com.journeyapps.barcodescanner.ScanContract()) { result ->
        val contents = result.contents
        if (contents != null) {
            // 优先解析 deep link（mctier://join?name=&pwd=），参数 URL 编码无歧义；否则回退中文文本解析
            val dl = Regex("mctier://join/?\\?([^\\s]+)").find(contents)
            var ok = false
            if (dl != null) {
                val params = dl.groupValues[1].split("&").mapNotNull {
                    val kv = it.split("=", limit = 2)
                    if (kv.size == 2) kv[0] to runCatching { java.net.URLDecoder.decode(kv[1], "UTF-8") }.getOrDefault(kv[1]) else null
                }.toMap()
                val nm = params["name"].orEmpty()
                if (nm.isNotBlank()) {
                    // 通过 pendingJoin 走与 deep link 相同的预填路径：经仓库单例下发，
                    // 即使扫码 Activity 触发了本 Activity 重建也不会丢失，且会无条件覆盖输入框
                    // （始终以二维码中的密码为准，包括空密码，避免残留旧密码进错大厅）
                    repository.applyDeepLink(nm, params["pwd"].orEmpty())
                    mode = "join"; ok = true
                }
            }
            if (!ok) {
                val nameM = Regex("大厅名称[:：]([^\\r\\n]+)").find(contents)
                val pwdM = Regex("密码[:：]([^\\r\\n]*)").find(contents)
                if (nameM != null) {
                    repository.applyDeepLink(nameM.groupValues[1].trim(), pwdM?.groupValues?.getOrNull(1)?.trim().orEmpty())
                    mode = "join"; ok = true
                }
            }
            android.widget.Toast.makeText(ctx, if (ok) L("已扫码识别大厅信息", "Lobby info recognized from QR") else L("二维码不是有效的大厅信息", "QR code is not a valid lobby"), android.widget.Toast.LENGTH_SHORT).show()
        }
    }
    fun launchScan() {
        scanLauncher.launch(
            com.journeyapps.barcodescanner.ScanOptions().apply {
                setDesiredBarcodeFormats(com.journeyapps.barcodescanner.ScanOptions.QR_CODE)
                setPrompt(L("将二维码放入框内扫描加入大厅", "Place the QR code in the frame to join"))
                setBeepEnabled(false)
                setOrientationLocked(true)
                setCaptureActivity(top.pmh13.mctier.PortraitCaptureActivity::class.java)
            },
        )
    }

    val clipboard = LocalClipboardManager.current
    LaunchedEffect(Unit) {
        if (lobbyName.isBlank()) {
            val text = runCatching { clipboard.getText()?.text }.getOrNull().orEmpty()
            if (text.isNotBlank()) {
                val nameM = Regex("大厅名称[:：]([^\\r\\n]+)").find(text)
                val pwdM = Regex("密码[:：]([^\\r\\n]*)").find(text)
                if (nameM != null) {
                    val n = nameM.groupValues[1].trim()
                    val p = pwdM?.groupValues?.getOrNull(1)?.trim().orEmpty()
                    if (n.length >= 4) {
                        lobbyName = n
                        if (p.isNotEmpty()) password = p
                    }
                } else {
                    // 兼容旧格式：大厅名称|密码
                    val parts = text.trim().split('|')
                    if (parts.size == 2 && parts[0].length >= 4) {
                        lobbyName = parts[0].trim()
                        password = parts[1].trim()
                    }
                }
            }
        }
    }

    // 切换到"加入大厅"分页时自动读取一次剪贴板大厅信息
    LaunchedEffect(mode) {
        if (mode == "join") {
            val text = runCatching { clipboard.getText()?.text }.getOrNull().orEmpty()
            val nameM = Regex("大厅名称[:：]([^\\r\\n]+)").find(text)
            val pwdM = Regex("密码[:：]([^\\r\\n]*)").find(text)
            if (nameM != null) {
                lobbyName = nameM.groupValues[1].trim()
                pwdM?.groupValues?.getOrNull(1)?.trim()?.let { if (it.isNotEmpty()) password = it }
            }
        }
    }

    if (showPlaza) PublicPlazaDialog(state, repository, onFill = { n, p, node -> lobbyName = n; password = p; plazaNode = node.ifBlank { null } }, onDismiss = { showPlaza = false })
    if (showFavorites) FavoritesDialog(state, repository, lobbyName, password, onFill = { n, p -> lobbyName = n; password = p; plazaNode = null }, onDismiss = { showFavorites = false })
    if (showRecent) RecentDialog(state, repository, onFill = { n, p -> lobbyName = n; password = p; plazaNode = null }, onDismiss = { showRecent = false })

    if (showSettings) {
        BackHandler { showSettings = false }
        SettingsScreen(state, repository) { showSettings = false }
        return
    }

    Scaffold(containerColor = Color.Transparent) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .statusBarsPadding()
                .navigationBarsPadding()
                .imePadding()
                .padding(horizontal = 18.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            item { Spacer(Modifier.height(8.dp)) }
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Image(
                        painter = painterResource(R.drawable.mctier_logo),
                        contentDescription = "MCTier",
                        modifier = Modifier.size(48.dp).clip(RoundedCornerShape(14.dp)),
                    )
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text("MCTier", fontSize = 24.sp, fontWeight = FontWeight.Bold, color = TextPrimary)
                        Text(L("虚拟局域网通用联机工具", "Universal VLAN Gaming Tool"), fontSize = 12.sp, color = TextPrimary.copy(alpha = 0.55f))
                    }
                    CircleIconButton(Icons.Rounded.QrCodeScanner, L("扫码加入大厅", "Scan to join lobby")) { launchScan() }
                    Spacer(Modifier.width(8.dp))
                    CircleIconButton(Icons.Rounded.Settings, L("设置", "Settings")) { showSettings = true }
                }
            }
            item {
                SectionCard {
                    // 标题（随模式变化，对齐桌面端）
                    Text(if (mode == "create") L("创建大厅", "Create Lobby") else L("加入大厅", "Join Lobby"), fontSize = 20.sp, fontWeight = FontWeight.Bold, color = TextPrimary)
                    Spacer(Modifier.height(12.dp))
                    // 创建 / 加入 模式切换
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        ToggleChip(L("创建大厅", "Create"), mode == "create", Icons.Rounded.Add, Modifier.weight(1f)) { mode = "create" }
                        ToggleChip(L("加入大厅", "Join"), mode == "join", Icons.AutoMirrored.Rounded.Login, Modifier.weight(1f)) { mode = "join" }
                    }
                    Spacer(Modifier.height(14.dp))
                    // 操作按钮行：常用 / 最近 / 广场 / 随机或识别（对齐桌面端 lobby-action-bar）
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        HomeActionButton(L("常用", "Favorites"), Icons.Rounded.Star, Modifier.weight(1f), tint = Color(0xFFFFD24A)) { showFavorites = true }
                        HomeActionButton(L("最近", "Recent"), Icons.Rounded.History, Modifier.weight(1f)) { showRecent = true }
                        HomeActionButton(L("广场", "Plaza"), Icons.Rounded.Public, Modifier.weight(1f)) { showPlaza = true }
                        if (mode == "create") {
                            HomeActionButton(L("随机", "Random"), Icons.Rounded.Casino, Modifier.weight(1f)) {
                                lobbyName = randomLobbyName()
                                password = randomPassword()
                                android.widget.Toast.makeText(ctx, L("已随机生成大厅名称和密码", "Random lobby name and password generated"), android.widget.Toast.LENGTH_SHORT).show()
                            }
                        } else {
                            HomeActionButton(L("\u8bc6\u522b", "Detect"), Icons.Rounded.QrCodeScanner, Modifier.weight(1f)) {
                                val text = runCatching { clipboard.getText()?.text }.getOrNull().orEmpty()
                                val nameM = Regex("\u5927\u5385\u540d\u79f0[:\uff1a]([^\\r\\n]+)").find(text)
                                val pwdM = Regex("\u5bc6\u7801[:\uff1a]([^\\r\\n]*)").find(text)
                                if (nameM != null) {
                                    lobbyName = nameM.groupValues[1].trim()
                                    pwdM?.groupValues?.getOrNull(1)?.trim()?.let { if (it.isNotEmpty()) password = it }
                                    android.widget.Toast.makeText(ctx, L("\u5df2\u8bc6\u522b\u526a\u8d34\u677f\u5927\u5385\u4fe1\u606f", "Lobby info detected from clipboard"), android.widget.Toast.LENGTH_SHORT).show()
                                } else {
                                    android.widget.Toast.makeText(ctx, L("\u526a\u8d34\u677f\u6ca1\u6709\u8bc6\u522b\u5230\u5927\u5385\u4fe1\u606f", "No lobby info found in clipboard"), android.widget.Toast.LENGTH_SHORT).show()
                                }
                            }
                        }
                    }
                    Spacer(Modifier.height(16.dp))
                    MctierField(lobbyName, { lobbyName = it; plazaNode = null }, L("大厅名称（4-32位）", "Lobby Name (4-32 chars)"), enabled = !connecting)
                    Spacer(Modifier.height(12.dp))
                    MctierField(password, { password = it }, L("大厅密码（8-32位，含字母和数字）", "Password (8-32, letters & digits)"), enabled = !connecting, isPassword = true)
                    Spacer(Modifier.height(12.dp))
                    MctierField(state.settings.playerName, {
                        val name = it.replace(Regex("\\s+"), "")
                        if (name.length <= 8) repository.updateSettings(state.settings.copy(playerName = name))
                    }, L("玩家名称（最多8字）", "Player Name (max 8)"), enabled = !connecting)
                    Spacer(Modifier.height(12.dp))
                    NodeSelector(state, repository, enabled = !connecting)
                    Spacer(Modifier.height(6.dp))
                    Text(
                        L(
                            "双方需选同一节点",
                            "Both must pick the same node",
                        ),
                        fontSize = 11.sp,
                        lineHeight = 16.sp,
                        color = TextPrimary.copy(alpha = 0.45f),
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 2.dp),
                    )
                    Spacer(Modifier.height(18.dp))
                    PrimaryButton(
                        text = if (connecting) L("正在组网…", "Connecting…") else if (mode == "create") L("创建大厅", "Create Lobby") else L("加入大厅", "Join Lobby"),
                        enabled = isValidLobbyName(lobbyName) && isValidLobbyPassword(password) && !connecting && state.versionError == null,
                    ) { repository.createOrJoinLobby(lobbyName, password, plazaNode) }
                }
            }
            item {
                Text(
                    "MCTier Android v$AppClientVersion",
                    fontSize = 11.sp,
                    color = TextPrimary.copy(alpha = 0.35f),
                    modifier = Modifier.fillMaxWidth(),
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                )
            }
            item { Spacer(Modifier.height(20.dp)) }
        }
    }
}

@Composable
private fun StatusCard(state: MctierUiState) {
    val (label, color) = when (state.state) {
        AppConnectionState.Idle -> L("未连接", "Disconnected") to TextPrimary.copy(alpha = 0.6f)
        AppConnectionState.Connecting -> L("正在组网…", "Connecting...") to DirtBrown
        AppConnectionState.InLobby -> L("已在大厅", "In Lobby") to GrassGreen
        AppConnectionState.Error -> L("连接失败", "Connection failed") to DangerRed
    }
    SectionCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(10.dp).clip(CircleShape).background(color))
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(label, fontWeight = FontWeight.SemiBold, color = TextPrimary)
                Text(state.error ?: state.settings.signalingServer, fontSize = 12.sp, color = TextPrimary.copy(alpha = 0.5f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@Composable
private fun PublicPlazaDialog(state: MctierUiState, repository: MctierRepository, onFill: (String, String, String) -> Unit, onDismiss: () -> Unit) {
    LaunchedEffect(Unit) { repository.fetchPublicLobbies() }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Panel,
        title = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(L("公开广场", "Public Plaza"), color = TextPrimary, modifier = Modifier.weight(1f))
                IconButton(onClick = { repository.fetchPublicLobbies() }) { Icon(Icons.Rounded.Refresh, L("刷新", "Refresh"), tint = GrassGreen) }
            }
        },
        text = {
            Box(Modifier.heightIn(min = 120.dp, max = 380.dp)) {
                when {
                    state.publicLoading -> Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = GrassGreen) }
                    state.publicLobbies.isEmpty() -> Text(L("暂无公开大厅", "No public lobbies"), color = TextPrimary.copy(alpha = 0.5f))
                    else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(state.publicLobbies, key = { it.lobbyName + it.hostName }) { lobby ->
                            Row(
                                Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(PanelHigh)
                                    .clickable { onFill(lobby.lobbyName, lobby.password, lobby.serverNode); onDismiss() }.padding(12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text(lobby.lobbyName, color = TextPrimary, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text(L("房主 ", "Host ") + "${lobby.hostName} · ${lobby.playerCount}${lobby.maxPlayers?.let { "/$it" } ?: ""} " + L("人", "players"), fontSize = 12.sp, color = TextPrimary.copy(alpha = 0.5f))
                                }
                                Text(L("填入", "Fill"), color = GrassGreen, fontSize = 13.sp)
                            }
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(L("关闭", "Close"), color = GrassGreen) } },
    )
}

@Composable
private fun FavoritesDialog(state: MctierUiState, repository: MctierRepository, currentName: String, currentPassword: String, onFill: (String, String) -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Panel,
        title = { Text(L("收藏大厅", "Saved Lobbies"), color = TextPrimary) },
        text = {
            Column {
                if (currentName.isNotBlank() && currentPassword.isNotBlank()) {
                    TextButton(onClick = { repository.addFavorite(currentName, currentPassword) }) {
                        Icon(Icons.Rounded.StarBorder, null, tint = GrassGreen, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(L("收藏当前填写的大厅", "Save current lobby"), color = GrassGreen)
                    }
                }
                Box(Modifier.heightIn(min = 80.dp, max = 360.dp)) {
                    if (state.favorites.isEmpty()) Text(L("还没有收藏", "No favorites yet"), color = TextPrimary.copy(alpha = 0.5f))
                    else LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        val sortedFavs = state.favorites.sortedWith(compareByDescending<top.pmh13.mctier.data.FavoriteLobby> { it.lastUsedAt })
                        items(sortedFavs, key = { it.name + it.password }) { fav ->
                            Row(
                                Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(PanelHigh)
                                    .clickable { repository.touchFavorite(fav.name, fav.password); onFill(fav.name, fav.password); onDismiss() }.padding(12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Icon(Icons.Rounded.Star, null, tint = DirtBrown, modifier = Modifier.size(18.dp))
                                Spacer(Modifier.width(10.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(fav.name, color = TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    if (fav.useCount > 0) Text(L("使用 ${fav.useCount} 次", "Used ${fav.useCount}x"), fontSize = 10.sp, color = TextPrimary.copy(alpha = 0.4f))
                                }
                                IconButton(onClick = { repository.removeFavorite(fav.name, fav.password) }) {
                                    Icon(Icons.Rounded.Close, L("移除", "Remove"), tint = DangerRed, modifier = Modifier.size(18.dp))
                                }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(L("关闭", "Close"), color = GrassGreen) } },
    )
}

@Composable
private fun RecentDialog(state: MctierUiState, repository: MctierRepository, onFill: (String, String) -> Unit, onDismiss: () -> Unit) {
    var tab by remember { mutableIntStateOf(0) }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Panel,
        title = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(if (tab == 0) L("最近大厅", "Recent Lobbies") else L("最近玩家", "Recent Players"), color = TextPrimary, modifier = Modifier.weight(1f))
                TextButton(onClick = { if (tab == 0) repository.clearRecentLobbies() else repository.clearRecentPlayers() }) { Text(L("清空", "Clear"), color = DangerRed) }
            }
        },
        text = {
            Column {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ToggleChip(L("大厅", "Lobby"), tab == 0, Icons.Rounded.History, Modifier.weight(1f)) { tab = 0 }
                    ToggleChip(L("玩家", "Player"), tab == 1, Icons.Rounded.Group, Modifier.weight(1f)) { tab = 1 }
                }
                Spacer(Modifier.height(10.dp))
                Box(Modifier.heightIn(min = 80.dp, max = 340.dp)) {
                    if (tab == 0) {
                        if (state.recentLobbies.isEmpty()) Text(L("暂无最近大厅", "No recent lobbies"), color = TextPrimary.copy(alpha = 0.5f))
                        else LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            items(state.recentLobbies, key = { it.name + it.password }) { r ->
                                Row(
                                    Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(PanelHigh)
                                        .clickable { onFill(r.name, r.password); onDismiss() }.padding(12.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Text(r.name, color = TextPrimary, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text(L("填入", "Fill"), color = GrassGreen, fontSize = 13.sp)
                                }
                            }
                        }
                    } else {
                        if (state.recentPlayers.isEmpty()) Text(L("暂无最近玩家", "No recent players"), color = TextPrimary.copy(alpha = 0.5f))
                        else {
                            val sorted = state.recentPlayers.sortedByDescending { state.favoritePlayers.contains(it.name) }
                            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            items(sorted, key = { it.name }) { p ->
                                val fav = state.favoritePlayers.contains(p.name)
                                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(PanelHigh).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Icon(
                                        if (fav) Icons.Rounded.Star else Icons.Rounded.StarBorder,
                                        if (fav) L("取消收藏", "Unfavorite") else L("收藏队友", "Favorite"),
                                        tint = if (fav) Color(0xFFFFD24A) else TextPrimary.copy(alpha = 0.4f),
                                        modifier = Modifier.size(20.dp).clickable { repository.toggleFavoritePlayer(p.name) },
                                    )
                                    Spacer(Modifier.width(10.dp))
                                    Text(p.name, color = TextPrimary, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text(L("共 ${p.count} 次", "${p.count} times"), fontSize = 12.sp, color = TextPrimary.copy(alpha = 0.5f))
                                }
                            }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(L("关闭", "Close"), color = GrassGreen) } },
    )
}

// ============================ 大厅 ============================
private data class TabItem(val label: String, val icon: ImageVector)

@Composable
private fun LobbyScreen(state: MctierUiState, repository: MctierRepository) {
    // 与桌面端 MiniWindow 一致：大厅主视图常驻，聊天/文件/屏幕/设置由底部动作按钮打开为覆盖视图
    val ctx = LocalContext.current
    var currentView by remember { mutableStateOf("lobby") }
    var showTools by remember { mutableStateOf(false) }
    // 游戏联机工具：状态上提到大厅级，统一收纳进「房间工具 - 联机」中，避免堆在拥挤的大厅卡片头部
    var showWorlds by remember { mutableStateOf(false) }
    var showQuickConnect by remember { mutableStateOf(false) }
    var showDiagnostic by remember { mutableStateOf(false) }
    var hudOn by remember { mutableStateOf(GameHudOverlay.enabled) }

    // 游戏内 HUD：开启时显示悬浮层并周期推送队友延迟/说话状态；关闭时移除
    LaunchedEffect(hudOn) {
        if (!hudOn) { GameHudOverlay.hide(); return@LaunchedEffect }
        GameHudOverlay.show(ctx)
        while (hudOn) {
            val st = repository.state.value
            val selfId = st.playerId
            val rows = st.players.map { p ->
                val ip = p.virtualIp
                val lat = if (p.id == selfId || ip.isNullOrBlank()) null else top.pmh13.mctier.ui.probeLatency(ip)
                GameHudOverlay.HudRow(p.name, lat, p.speaking, p.id == selfId)
            }.sortedByDescending { it.self }
            GameHudOverlay.update(rows)
            kotlinx.coroutines.delay(4000)
        }
    }

    if (showTools) RoomToolsDialog(
        state, repository,
        onOpenWorlds = { showTools = false; showWorlds = true },
        onOpenQuickConnect = { showTools = false; showQuickConnect = true },
        onOpenDiagnostic = { showTools = false; showDiagnostic = true },
        hudOn = hudOn,
        onToggleHud = {
            if (!hudOn && !GameHudOverlay.hasPermission(ctx)) {
                android.widget.Toast.makeText(ctx, L("请先授予悬浮窗权限", "Please grant overlay permission first"), android.widget.Toast.LENGTH_SHORT).show()
                runCatching { ctx.startActivity(GameHudOverlay.requestPermissionIntent(ctx)) }
            } else {
                hudOn = !hudOn
                GameHudOverlay.enabled = hudOn
            }
        },
        onDismiss = { showTools = false },
    )
    if (showWorlds) MinecraftWorldsDialog(repository) { showWorlds = false }
    if (showQuickConnect) GameQuickConnectDialog(state) { showQuickConnect = false }
    if (showDiagnostic) ConnectionDiagnosticDialog(state) { showDiagnostic = false }
    // 返回键：在子视图时返回大厅（对齐桌面端 ESC 返回上一页）
    BackHandler(enabled = currentView != "lobby") { currentView = "lobby" }
    // 未读消息标记：不在聊天界面时收到新消息则标红
    var lastSeenChat by remember { mutableIntStateOf(state.chatMessages.size) }
    var hasUnread by remember { mutableStateOf(false) }
    LaunchedEffect(state.chatMessages.size, currentView) {
        if (currentView == "chat") { hasUnread = false; lastSeenChat = state.chatMessages.size }
        else if (state.chatMessages.size > lastSeenChat) hasUnread = true
    }

    Box(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(horizontal = 16.dp)) {
        AnimatedContent(
            targetState = currentView,
            transitionSpec = {
                val dur = 300
                val forward = targetState != "lobby" // 进入子页 = 前进，返回大厅 = 后退
                (fadeIn(animationSpec = androidx.compose.animation.core.tween(dur)) +
                    androidx.compose.animation.slideInHorizontally(animationSpec = androidx.compose.animation.core.tween(dur)) { if (forward) it / 3 else -it / 3 }) togetherWith
                    (fadeOut(animationSpec = androidx.compose.animation.core.tween(dur)) +
                        androidx.compose.animation.slideOutHorizontally(animationSpec = androidx.compose.animation.core.tween(dur)) { if (forward) -it / 3 else it / 3 })
            },
            label = "lobby-view",
        ) { view ->
            when (view) {
                "chat" -> LobbySubView(L("聊天室", "Chat"), onClose = { currentView = "lobby" }) { ChatTab(state, repository) }
                "files" -> LobbySubView(L("文件共享", "File Sharing"), onClose = { currentView = "lobby" }) { FilesTab(state, repository) }
                "screen" -> LobbySubView(L("屏幕共享", "Screen Sharing"), onClose = { currentView = "lobby" }) { ScreenTab(state, repository) }
                "settings" -> LobbySubView(L("大厅动态设置", "Lobby Settings"), onClose = { currentView = "lobby" }) {
                    LobbyDynamicConfigView(state, repository, onClose = { currentView = "lobby" })
                }
                else -> LobbyMainView(
                    state, repository,
                    hasUnread = hasUnread,
                    onTools = { showTools = true },
                    onSettings = { currentView = "settings" },
                    onOpen = { currentView = it },
                    onOpenWorlds = { showWorlds = true },
                )
            }
        }
        // 断线重连提示条(顶部)
        androidx.compose.animation.AnimatedVisibility(
            visible = state.reconnecting,
            modifier = Modifier.align(Alignment.TopCenter),
            enter = fadeIn() + androidx.compose.animation.slideInVertically { -it },
            exit = fadeOut() + androidx.compose.animation.slideOutVertically { -it },
        ) {
            Row(
                Modifier.statusBarsPadding().padding(top = 6.dp).clip(RoundedCornerShape(20.dp))
                    .background(Color(0xFFFFD24A).copy(alpha = 0.95f)).padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CircularProgressIndicator(modifier = Modifier.size(14.dp), strokeWidth = 2.dp, color = Color(0xFF06210A))
                Spacer(Modifier.width(8.dp))
                Text(L("网络波动，重连中…", "Network unstable, reconnecting..."), color = Color(0xFF06210A), fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
private fun LobbySubView(title: String, onClose: () -> Unit, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxSize()) {
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title, fontSize = 18.sp, fontWeight = FontWeight.Bold, color = TextPrimary, modifier = Modifier.weight(1f))
            CircleIconButton(Icons.Rounded.Close, L("返回大厅", "Back to Lobby"), onClick = onClose)
        }
        Spacer(Modifier.height(12.dp))
        Box(Modifier.weight(1f)) { content() }
    }
}

@Composable
private fun LobbyMainView(
    state: MctierUiState,
    repository: MctierRepository,
    hasUnread: Boolean,
    onTools: () -> Unit,
    onSettings: () -> Unit,
    onOpen: (String) -> Unit,
    onOpenWorlds: () -> Unit,
) {
    var showLeaveConfirm by remember { mutableStateOf(false) }
    if (showLeaveConfirm) {
        AlertDialog(
            onDismissRequest = { showLeaveConfirm = false },
            containerColor = Panel,
            title = { Text(L("退出大厅", "Leave Lobby"), color = TextPrimary, fontWeight = FontWeight.Bold) },
            text = { Text(L("确定要退出当前大厅吗？退出后将断开与好友的组网。", "Leave this lobby? You will disconnect from your friends."), color = TextPrimary.copy(alpha = 0.85f), fontSize = 14.sp) },
            confirmButton = { TextButton(onClick = { showLeaveConfirm = false; repository.leaveLobby() }) { Text(L("退出", "Leave"), color = DangerRed, fontWeight = FontWeight.Bold) } },
            dismissButton = { TextButton(onClick = { showLeaveConfirm = false }) { Text(L("取消", "Cancel"), color = TextPrimary.copy(alpha = 0.7f)) } },
        )
    }
    Column(Modifier.fillMaxSize()) {
        Spacer(Modifier.height(8.dp))
        // 顶部：LOGO + 标题 + 房间工具/设置/退出（对齐桌面端标题栏）
        Row(verticalAlignment = Alignment.CenterVertically) {
            Image(painterResource(R.drawable.mctier_logo), "MCTier", modifier = Modifier.size(32.dp))
            Spacer(Modifier.width(10.dp))
            Text("MCTier", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = TextPrimary, modifier = Modifier.weight(1f))
            CircleIconButton(Icons.Rounded.Build, L("房间工具", "Room Tools")) { onTools() }
            Spacer(Modifier.width(8.dp))
            CircleIconButton(Icons.Rounded.Settings, L("设置", "Settings")) { onSettings() }
            Spacer(Modifier.width(8.dp))
            CircleIconButton(Icons.AutoMirrored.Rounded.Logout, L("退出大厅", "Leave Lobby")) { showLeaveConfirm = true }
        }
        Spacer(Modifier.height(12.dp))
        LobbyCard(state, repository, onOpenWorlds)
        Spacer(Modifier.height(12.dp))
        AnnouncementBar(state, repository)
        Box(Modifier.weight(1f)) { PlayersTab(state, repository) }
        Spacer(Modifier.height(10.dp))
        LobbyActionBar(state, repository, hasUnread, onOpen)
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun LobbyCard(state: MctierUiState, repository: MctierRepository, onOpenWorlds: () -> Unit) {
    val clipboard = LocalClipboardManager.current
    val ctx = LocalContext.current
    var showHelp by remember { mutableStateOf(false) }
    var showQr by remember { mutableStateOf(false) }
    val lobby = state.lobby
    LaunchedEffect(lobby?.name, lobby?.password) {
        showQr = false
    }
    val ipText = (if (lobby?.useDomain == true) lobby.virtualDomain else lobby?.virtualIp).orEmpty().ifBlank { L("获取中...", "Loading...") }

    SectionCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(lobby?.name.orEmpty(), fontSize = 18.sp, fontWeight = FontWeight.Bold, color = TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            CircleIconButton(Icons.Rounded.Public, L("局域网世界", "LAN Worlds")) { onOpenWorlds() }
            Spacer(Modifier.width(6.dp))
            CircleIconButton(Icons.Rounded.QrCode2, L("大厅二维码", "Lobby QR Code")) { if (lobby != null) showQr = true }
            Spacer(Modifier.width(6.dp))
            CircleIconButton(Icons.Rounded.ContentCopy, L("复制大厅信息", "Copy Lobby Info")) {
                if (lobby != null) {
                    val info = L("——————— 邀请您加入大厅 ———————\n完整复制后打开 MCTier-加入大厅 界面（自动识别）\n大厅名称：${lobby.name}\n密码：${lobby.password}\n————— https://mctier.pmhs.top —————", "——————— Invitation to Join Lobby ———————\nCopy everything, then open MCTier - Join Lobby (auto-detected)\nLobby Name: ${lobby.name}\nPassword: ${lobby.password}\n————— https://mctier.pmhs.top —————")
                    clipboard.setText(AnnotatedString(info))
                    android.widget.Toast.makeText(ctx, L("大厅信息已复制，发给好友粘贴即可自动识别", "Lobby info copied; paste to a friend to auto-detect"), android.widget.Toast.LENGTH_SHORT).show()
                }
            }
        }
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(if (lobby?.useDomain == true) L("您的虚拟域名:", "Your domain:") else L("您的虚拟IP:", "Your IP:"), fontSize = 12.sp, color = TextPrimary.copy(alpha = 0.55f))
            Spacer(Modifier.width(8.dp))
            Box(
                Modifier.clip(RoundedCornerShape(8.dp)).background(GrassGreen.copy(alpha = 0.16f))
                    .clickable { clipboard.setText(AnnotatedString(ipText)); android.widget.Toast.makeText(ctx, L("已复制", "Copied"), android.widget.Toast.LENGTH_SHORT).show() }
                    .padding(horizontal = 10.dp, vertical = 4.dp),
            ) { Text(ipText, fontSize = 13.sp, color = GrassGreen, fontWeight = FontWeight.SemiBold) }
            Spacer(Modifier.weight(1f))
            Text(L("无法联机?", "Cannot connect?"), fontSize = 12.sp, color = DirtBrown, modifier = Modifier.clickable { showHelp = true })
        }
    }
    if (showQr && lobby != null) {
        val qrText = "mctier://join?name=${java.net.URLEncoder.encode(lobby.name, "UTF-8")}&pwd=${java.net.URLEncoder.encode(lobby.password, "UTF-8")}"
        val logoBmp = remember {
            runCatching {
                val opts = android.graphics.BitmapFactory.Options().apply { inScaled = false }
                android.graphics.BitmapFactory.decodeResource(ctx.resources, R.drawable.mctier_logo, opts)
            }.getOrNull()
        }
        val qrBitmap = remember(qrText) { top.pmh13.mctier.network.QrUtil.encodeWithLogo(qrText, logoBmp) }
        val accentArgb = GrassGreen.toArgb()
        Dialog(onDismissRequest = { showQr = false }) {
            Column(
                Modifier.clip(RoundedCornerShape(18.dp)).background(Panel).padding(20.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(L("大厅二维码", "Lobby QR Code"), color = TextPrimary, fontWeight = FontWeight.Bold, fontSize = 16.sp, modifier = Modifier.weight(1f))
                    CircleIconButton(Icons.Rounded.Close, L("关闭", "Close")) { showQr = false }
                }
                Spacer(Modifier.height(4.dp))
                Text(L("让好友用 MCTier 扫码即可加入", "Let friends scan with MCTier to join"), fontSize = 12.sp, color = TextPrimary.copy(alpha = 0.6f))
                Spacer(Modifier.height(14.dp))
                if (qrBitmap != null) {
                    Image(
                        bitmap = qrBitmap.asImageBitmap(),
                        contentDescription = L("大厅二维码", "Lobby QR Code"),
                        modifier = Modifier.size(188.dp).clip(RoundedCornerShape(12.dp)).background(Color(0xFFFFFFFF)).padding(10.dp),
                    )
                } else {
                    Text(L("二维码生成失败", "Failed to generate QR code"), color = DangerRed)
                }
                Spacer(Modifier.height(12.dp))
                Text(lobby.name, color = TextPrimary, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(14.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Box(
                        Modifier.clip(RoundedCornerShape(12.dp)).background(GrassGreen.copy(alpha = 0.18f))
                            .border(1.dp, GrassGreen.copy(alpha = 0.5f), RoundedCornerShape(12.dp))
                            .clickable(enabled = qrBitmap != null) {
                                qrBitmap?.let { qb ->
                                    val poster = top.pmh13.mctier.network.QrUtil.buildPoster(qb, lobby.name, lobby.password, accentArgb)
                                    repository.saveBitmapToGallery(poster) { ok ->
                                        android.widget.Toast.makeText(ctx, if (ok) L("二维码海报已保存到相册 Pictures/MCTier", "QR poster saved to Pictures/MCTier") else L("保存失败", "Save failed"), android.widget.Toast.LENGTH_LONG).show()
                                    }
                                }
                            }
                            .padding(horizontal = 18.dp, vertical = 11.dp),
                    ) { Text(L("下载二维码", "Download QR"), color = GrassGreen, fontWeight = FontWeight.SemiBold, fontSize = 13.sp) }
                    Box(
                        Modifier.clip(RoundedCornerShape(12.dp)).background(PanelHigh)
                            .clickable {
                                val dl = "mctier://join?name=${java.net.URLEncoder.encode(lobby.name, "UTF-8")}&pwd=${java.net.URLEncoder.encode(lobby.password, "UTF-8")}"
                                clipboard.setText(AnnotatedString(dl))
                                android.widget.Toast.makeText(ctx, L("邀请链接已复制，发给电脑端好友在浏览器打开即可加入", "Invite link copied; send to a desktop friend to open in a browser and join"), android.widget.Toast.LENGTH_LONG).show()
                            }
                            .padding(horizontal = 18.dp, vertical = 11.dp),
                    ) { Text(L("复制邀请链接", "Copy Link"), color = TextPrimary, fontWeight = FontWeight.SemiBold, fontSize = 13.sp) }
                }
                Spacer(Modifier.height(8.dp))
                Text(L("「复制邀请链接」发给电脑端好友，粘贴到浏览器打开即可加入", "Copy the invite link and send it to a desktop friend to open in a browser"), fontSize = 11.sp, color = TextPrimary.copy(alpha = 0.5f), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            }
        }
    }
    if (showHelp) {
        AlertDialog(
            onDismissRequest = { showHelp = false },
            containerColor = Panel,
            title = { Text(L("无法联机？", "Cannot connect?"), color = TextPrimary) },
            text = {
                Column {
                    Text(L("1. 确认手机与电脑用了相同的大厅名称和密码", "1. Make sure phone and PC use the same lobby name and password"), color = TextPrimary.copy(alpha = 0.85f), fontSize = 13.sp)
                    Spacer(Modifier.height(8.dp))
                    Text(L("2. Minecraft 中对局域网开放后，用「您的虚拟IP + 端口」连接", "2. After Open to LAN in Minecraft, connect with your virtual IP + port"), color = TextPrimary.copy(alpha = 0.85f), fontSize = 13.sp)
                    Spacer(Modifier.height(8.dp))
                    Text(L("3. 若语音/聊天不通，退出大厅重进一次", "3. If voice/chat fails, leave and rejoin the lobby"), color = TextPrimary.copy(alpha = 0.85f), fontSize = 13.sp)
                }
            },
            confirmButton = { TextButton(onClick = { showHelp = false }) { Text(L("知道了", "Got it"), color = GrassGreen) } },
        )
    }
}

@Composable
private fun AnnouncementBar(state: MctierUiState, repository: MctierRepository) {
    val text = state.announcement
    if (text.isBlank()) return
    // 只读跑马灯：公告从右向左匀速滚动；房主在「大厅动态设置」中编辑
    Column {
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Color(0xFFFFD24A).copy(alpha = 0.14f))
                .border(1.dp, Color(0xFFFFD24A).copy(alpha = 0.4f), RoundedCornerShape(14.dp))
                .padding(horizontal = 12.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Rounded.Campaign, L("公告", "Announcement"), tint = Color(0xFFFFD24A), modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(10.dp))
            MarqueeText(text, color = TextPrimary.copy(alpha = 0.92f), modifier = Modifier.weight(1f))
        }
        Spacer(Modifier.height(12.dp))
    }
}

/** 从右向左匀速循环滚动的跑马灯文本 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun MarqueeText(text: String, color: Color, modifier: Modifier = Modifier) {
    Text(
        text,
        color = color,
        fontSize = 13.sp,
        maxLines = 1,
        modifier = modifier.basicMarquee(iterations = Int.MAX_VALUE),
    )
}

@Composable
private fun MinecraftWorldsDialog(repository: MctierRepository, onClose: () -> Unit) {
    val ctx = LocalContext.current
    val clipboard = LocalClipboardManager.current
    var port by remember { mutableStateOf("25565") }
    var scanning by remember { mutableStateOf(false) }
    var worlds by remember { mutableStateOf<List<top.pmh13.mctier.network.DiscoveredWorld>>(emptyList()) }
    var scanned by remember { mutableStateOf(false) }
    fun doScan() {
        val p = port.toIntOrNull()?.takeIf { it in 1..65535 } ?: 25565
        scanning = true
        repository.scanMinecraftWorlds(p) { list -> worlds = list; scanning = false; scanned = true }
    }
    LaunchedEffect(Unit) { doScan() }
    Dialog(onDismissRequest = onClose) {
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Panel).padding(20.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.Public, null, tint = GrassGreen, modifier = Modifier.size(22.dp))
                Spacer(Modifier.width(8.dp))
                Text(L("局域网世界", "LAN Worlds"), color = TextPrimary, fontWeight = FontWeight.Bold, fontSize = 17.sp, modifier = Modifier.weight(1f))
                CircleIconButton(Icons.Rounded.Close, L("关闭", "Close"), onClick = onClose)
            }
            Spacer(Modifier.height(6.dp))
            Text(L("自动扫描大厅成员在端口上开启的 Minecraft 世界（需对方「对局域网开放」或自建服务器）", "Scan for Minecraft worlds opened by lobby members (Open to LAN or self-hosted)"), fontSize = 12.sp, color = TextPrimary.copy(alpha = 0.55f))
            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = port, onValueChange = { v -> port = v.filter { it.isDigit() }.take(5) },
                    label = { Text(L("端口", "Port"), fontSize = 12.sp) }, singleLine = true,
                    modifier = Modifier.width(120.dp), shape = RoundedCornerShape(12.dp), colors = fieldColors(),
                )
                Spacer(Modifier.width(10.dp))
                PrimaryButton(if (scanning) L("扫描中…", "Scanning...") else L("扫描", "Scan"), enabled = !scanning) { doScan() }
            }
            Spacer(Modifier.height(14.dp))
            when {
                scanning && worlds.isEmpty() -> Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = GrassGreen, modifier = Modifier.size(28.dp), strokeWidth = 3.dp)
                }
                scanned && worlds.isEmpty() -> Text(L("未发现可加入的世界。请确认对方已在游戏中点击「对局域网开放」或已开服。", "No joinable worlds found. Make sure the other side clicked Open to LAN or started a server."),
                    fontSize = 13.sp, color = TextPrimary.copy(alpha = 0.6f), modifier = Modifier.padding(vertical = 12.dp))
                else -> Column(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.heightIn(max = 360.dp).verticalScroll(rememberScrollState())) {
                    worlds.forEach { w ->
                        val addr = if (w.port == 25565) w.ip else "${w.ip}:${w.port}"
                        Column(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(PanelHigh).padding(12.dp),
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("${w.ownerName} 的世界", color = TextPrimary, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Box(
                                    Modifier.clip(RoundedCornerShape(8.dp)).background(GrassGreen)
                                        .clickable {
                                            clipboard.setText(AnnotatedString(addr))
                                            android.widget.Toast.makeText(ctx, L("已复制地址 $addr，在 Minecraft「多人游戏→直接连接」粘贴即可", "Address $addr copied — paste it in Minecraft \"Multiplayer → Direct Connect\""), android.widget.Toast.LENGTH_LONG).show()
                                        }.padding(horizontal = 12.dp, vertical = 6.dp),
                                ) { Text(L("复制地址", "Copy Address"), color = TextPrimary, fontSize = 12.sp) }
                            }
                            if (w.motd.isNotBlank()) {
                                Spacer(Modifier.height(4.dp))
                                Text(w.motd, fontSize = 12.sp, color = TextPrimary.copy(alpha = 0.7f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                            Spacer(Modifier.height(6.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                                WorldTag(w.version, GrassGreen)
                                if (w.maxPlayers > 0) WorldTag("${w.onlinePlayers}/${w.maxPlayers} 人", Color(0xFF3B82F6))
                                WorldTag("${w.latencyMs}ms", if (w.latencyMs < 80) GrassGreen else if (w.latencyMs < 200) Color(0xFFF59E0B) else DangerRed)
                                WorldTag(addr, TextPrimary.copy(alpha = 0.5f))
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun WorldTag(text: String, color: Color) {
    Box(Modifier.clip(RoundedCornerShape(6.dp)).background(color.copy(alpha = 0.18f)).padding(horizontal = 7.dp, vertical = 2.dp)) {
        Text(text, fontSize = 10.sp, color = color)
    }
}

@Composable
private fun LobbyActionBar(state: MctierUiState, repository: MctierRepository, hasUnread: Boolean, onOpen: (String) -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Panel).padding(vertical = 12.dp),
        horizontalArrangement = Arrangement.SpaceEvenly,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LobbyActionButton(
            icon = if (state.micEnabled) Icons.Rounded.Mic else Icons.Rounded.MicOff,
            desc = L("麦克风", "Microphone"),
            active = state.micEnabled,
            danger = !state.micEnabled,
        ) { repository.toggleMic() }
        LobbyActionButton(
            icon = if (state.globalMuted) Icons.Rounded.VolumeOff else Icons.Rounded.VolumeUp,
            desc = L("扬声器", "Speaker"),
            active = !state.globalMuted,
            danger = state.globalMuted,
        ) { repository.toggleGlobalMute() }
        // 聊天按钮：有未读时显示脉动红点
        Box {
            LobbyActionButton(Icons.Rounded.Chat, L("聊天室", "Chat"), active = false, danger = false) { onOpen("chat") }
            if (hasUnread) {
                val pulse = rememberInfiniteTransition(label = "unread")
                val a by pulse.animateFloat(
                    initialValue = 0.4f, targetValue = 1f,
                    animationSpec = androidx.compose.animation.core.infiniteRepeatable(
                        androidx.compose.animation.core.tween(700),
                        androidx.compose.animation.core.RepeatMode.Reverse,
                    ),
                    label = "unread-alpha",
                )
                Box(
                    Modifier.align(Alignment.TopEnd).padding(2.dp).size(11.dp)
                        .graphicsLayer(alpha = a).clip(CircleShape).background(DangerRed),
                )
            }
        }
        LobbyActionButton(Icons.Rounded.Folder, L("文件共享", "File Sharing"), active = false, danger = false) { onOpen("files") }
        LobbyActionButton(Icons.Rounded.ScreenShare, L("屏幕共享", "Screen Sharing"), active = false, danger = false) { onOpen("screen") }
    }
}

@Composable
private fun LobbyActionButton(icon: ImageVector, desc: String, active: Boolean, danger: Boolean, onClick: () -> Unit) {
    val actInteraction = remember { MutableInteractionSource() }
    val actPressed by actInteraction.collectIsPressedAsState()
    val actScale by animateFloatAsState(if (actPressed) 0.86f else 1f, label = "actScale")
    val bg = when {
        danger -> DangerRed.copy(alpha = 0.9f)
        active -> GrassGreen
        else -> PanelHigh
    }
    val tint = when {
        danger -> TextPrimary
        active -> TextPrimary
        else -> TextPrimary.copy(alpha = 0.9f)
    }
    Box(
        Modifier.size(54.dp).graphicsLayer { scaleX = actScale; scaleY = actScale }
            .clip(CircleShape).background(bg)
            .clickable(interactionSource = actInteraction, indication = null, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, desc, tint = tint, modifier = Modifier.size(24.dp)) }
}



@Composable
private fun LobbyHeader(state: MctierUiState, repository: MctierRepository, onTools: () -> Unit) {
    val clipboard = LocalClipboardManager.current
    SectionCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(state.lobby?.name.orEmpty(), fontSize = 18.sp, fontWeight = FontWeight.Bold, color = TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Spacer(Modifier.height(2.dp))
                Text(
                    (if (state.lobby?.useDomain == true) state.lobby?.virtualDomain else state.lobby?.virtualIp).orEmpty(),
                    fontSize = 13.sp, color = GrassGreen,
                )
            }
            CircleIconButton(Icons.Rounded.Build, L("房间工具", "Room Tools")) { onTools() }
            Spacer(Modifier.width(8.dp))
            CircleIconButton(Icons.Rounded.ContentCopy, L("复制大厅信息", "Copy Lobby Info")) {
                val lobby = state.lobby ?: return@CircleIconButton
                clipboard.setText(AnnotatedString("邀请您加入大厅\n大厅名称：${lobby.name}\n密码：${lobby.password}\nhttps://mctier.pmhs.top"))
            }
        }
        Spacer(Modifier.height(14.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            ToggleChip(
                text = if (state.micEnabled) L("麦克风开", "Mic On") else L("麦克风关", "Mic Off"),
                active = state.micEnabled,
                icon = if (state.micEnabled) Icons.Rounded.Mic else Icons.Rounded.MicOff,
                modifier = Modifier.weight(1f),
            ) { repository.toggleMic() }
            ToggleChip(
                text = if (state.globalMuted) L("已静音", "Muted") else L("扬声器", "Speaker"),
                active = !state.globalMuted,
                icon = if (state.globalMuted) Icons.Rounded.VolumeOff else Icons.Rounded.VolumeUp,
                modifier = Modifier.weight(1f),
            ) { repository.toggleGlobalMute() }
            Button(
                onClick = { repository.leaveLobby() },
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(containerColor = DangerRed),
                contentPadding = PaddingValues(horizontal = 14.dp, vertical = 10.dp),
            ) { Icon(Icons.AutoMirrored.Rounded.Logout, null, modifier = Modifier.size(18.dp)) }
        }
    }
}

@Composable
private fun RoomToolButton(icon: ImageVector, title: String, subtitle: String, active: Boolean = false, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp))
            .background(if (active) GrassGreen.copy(alpha = 0.18f) else PanelHigh)
            .clickable { onClick() }.padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, title, tint = if (active) GrassGreen else TextPrimary, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, color = TextPrimary, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
            Text(subtitle, color = TextPrimary.copy(alpha = 0.55f), fontSize = 11.sp)
        }
    }
}

@Composable
private fun RoomToolsDialog(
    state: MctierUiState,
    repository: MctierRepository,
    onOpenWorlds: () -> Unit,
    onOpenQuickConnect: () -> Unit,
    onOpenDiagnostic: () -> Unit,
    hudOn: Boolean,
    onToggleHud: () -> Unit,
    onDismiss: () -> Unit,
) {
    var newTodo by remember { mutableStateOf("") }
    var minutes by remember { mutableStateOf("5") }
    var seconds by remember { mutableStateOf("0") }
    var tab by remember { mutableIntStateOf(3) }
    var dice by remember { mutableIntStateOf(1) }
    var diceSides by remember { mutableIntStateOf(6) }
    var rolling by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Panel,
        title = { Text(L("房间工具", "Room Tools"), color = TextPrimary, fontWeight = FontWeight.Bold) },
        text = {
            Column(Modifier.heightIn(max = 480.dp)) {
                // 分页切换（横向滚动，容纳更多工具）
                Row(
                    Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    ToggleChip(L("联机", "Net"), tab == 3, Icons.Rounded.SportsEsports) { tab = 3 }
                    ToggleChip(L("骰子", "Dice"), tab == 0, Icons.Rounded.Casino) { tab = 0 }
                    ToggleChip(L("倒计时", "Timer"), tab == 1, Icons.Rounded.History) { tab = 1 }
                    ToggleChip(L("待办", "To-Do"), tab == 2, Icons.Rounded.Checklist) { tab = 2 }
                }
                Spacer(Modifier.height(16.dp))
                when (tab) {
                    0 -> {
                        // 骰子：支持面数选择 + 本地掷骰 / 掷骰并广播（广播到聊天室，与桌面端一致）
                        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                            Box(
                                Modifier.size(96.dp).clip(RoundedCornerShape(20.dp)).background(PanelHigh),
                                contentAlignment = Alignment.Center,
                            ) { Text("$dice", fontSize = 52.sp, fontWeight = FontWeight.Bold, color = GrassGreen) }
                            Spacer(Modifier.height(12.dp))
                            Text(L("面数", "Sides"), fontSize = 12.sp, color = TextPrimary.copy(alpha = 0.7f))
                            Spacer(Modifier.height(6.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                listOf(4, 6, 8, 12, 20, 100).forEach { s ->
                                    val sel = diceSides == s
                                    Box(
                                        Modifier.clip(RoundedCornerShape(10.dp))
                                            .background(if (sel) GrassGreen else PanelHigh)
                                            .clickable(enabled = !rolling) { diceSides = s }
                                            .padding(horizontal = 10.dp, vertical = 6.dp),
                                    ) { Text("d$s", fontSize = 12.sp, color = TextPrimary, fontWeight = if (sel) FontWeight.Bold else FontWeight.Normal) }
                                }
                            }
                            Spacer(Modifier.height(16.dp))
                            fun rollThen(after: (Int) -> Unit) {
                                rolling = true
                                scope.launch {
                                    repeat(12) { dice = (1..diceSides).random(); kotlinx.coroutines.delay(60) }
                                    val result = (1..diceSides).random()
                                    dice = result
                                    rolling = false
                                    after(result)
                                }
                            }
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                Box(
                                    Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).background(PanelHigh)
                                        .clickable(enabled = !rolling) { rollThen {} }.padding(vertical = 12.dp),
                                    contentAlignment = Alignment.Center,
                                ) { Text(if (rolling) L("投掷中…", "Rolling...") else L("本地掷骰", "Roll Locally"), color = TextPrimary) }
                                Box(
                                    Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).background(if (rolling) PanelHigh else GrassGreen)
                                        .clickable(enabled = !rolling) {
                                            rollThen { r -> repository.sendChat("🎲 ${state.settings.playerName} 掷出了 $r 点（d$diceSides）") }
                                        }.padding(vertical = 12.dp),
                                    contentAlignment = Alignment.Center,
                                ) { Text(L("掷骰并广播", "Roll & Broadcast"), color = TextPrimary, fontWeight = FontWeight.Bold) }
                            }
                        }
                    }
                    1 -> {
                        // 倒计时（分+秒）
                        if (state.countdownRunning) {
                            val m = state.countdownRemaining / 60
                            val s = state.countdownRemaining % 60
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("%02d:%02d".format(m, s), fontSize = 40.sp, fontWeight = FontWeight.Bold, color = GrassGreen, modifier = Modifier.weight(1f))
                                Button(onClick = { repository.stopCountdown() }, shape = RoundedCornerShape(10.dp), colors = ButtonDefaults.buttonColors(containerColor = DangerRed)) { Text(L("停止", "Stop")) }
                            }
                        } else {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedTextField(minutes, { minutes = it.filter { c -> c.isDigit() }.take(3) }, modifier = Modifier.weight(1f), label = { Text(L("分", "Min")) }, singleLine = true, shape = RoundedCornerShape(12.dp), colors = fieldColors())
                                OutlinedTextField(seconds, { seconds = it.filter { c -> c.isDigit() }.take(2) }, modifier = Modifier.weight(1f), label = { Text(L("秒", "Sec")) }, singleLine = true, shape = RoundedCornerShape(12.dp), colors = fieldColors())
                            }
                            Spacer(Modifier.height(12.dp))
                            PrimaryButton(L("开始倒计时", "Start Timer")) {
                                val total = (minutes.toIntOrNull() ?: 0) * 60 + (seconds.toIntOrNull() ?: 0)
                                if (total > 0) repository.startCountdown(total)
                            }
                        }
                    }
                    3 -> {
                        // 联机工具：把双端新增的游戏工具统一收纳到房间工具中
                        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            RoomToolButton(Icons.Rounded.Public, L("局域网世界", "LAN Worlds"), L("自动发现可加入的 Minecraft 世界", "Auto-discover joinable Minecraft worlds")) { onOpenWorlds() }
                            RoomToolButton(Icons.Rounded.Link, L("游戏快连", "Game Quick-Connect"), L("常见游戏端口与成员地址一键复制", "Common game ports & member addresses")) { onOpenQuickConnect() }
                            RoomToolButton(Icons.Rounded.Wifi, L("连接诊断", "Diagnostics"), L("直连/中继 · 延迟 · 优化建议", "Direct/Relay · latency · tips")) { onOpenDiagnostic() }
                            RoomToolButton(
                                if (hudOn) Icons.Rounded.Visibility else Icons.Rounded.VisibilityOff,
                                if (hudOn) L("关闭游戏内 HUD 浮层", "Turn off in-game HUD") else L("开启游戏内 HUD 浮层", "Turn on in-game HUD"),
                                L("游戏内显示队友延迟 / 说话状态", "Show teammates' latency / speaking in-game"),
                                active = hudOn,
                            ) { onToggleHud() }
                        }
                    }
                    else -> when (tab) {
                    2 -> {
                        // 个人待办
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(L("个人待办", "Personal To-Do"), fontSize = 13.sp, color = TextPrimary.copy(alpha = 0.7f), modifier = Modifier.weight(1f))
                            TextButton(onClick = { repository.clearDoneTodos() }) { Text(L("清除已完成", "Clear Done"), color = GrassGreen, fontSize = 12.sp) }
                        }
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedTextField(newTodo, { newTodo = it }, modifier = Modifier.weight(1f), placeholder = { Text(L("新增个人待办", "Add a personal task")) }, singleLine = true, shape = RoundedCornerShape(12.dp), colors = fieldColors())
                            Box(
                                Modifier.size(46.dp).clip(CircleShape).background(if (newTodo.isBlank()) PanelHigh else GrassGreen)
                                    .clickable(enabled = newTodo.isNotBlank()) { repository.addTodo(newTodo); newTodo = "" },
                                contentAlignment = Alignment.Center,
                            ) { Icon(Icons.Rounded.Add, L("添加", "Add"), tint = if (newTodo.isBlank()) TextPrimary.copy(alpha = 0.4f) else TextPrimary) }
                        }
                        Spacer(Modifier.height(8.dp))
                        Box(Modifier.heightIn(max = 240.dp)) {
                            if (state.todos.isEmpty()) Text(L("暂无待办", "No tasks yet"), color = TextPrimary.copy(alpha = 0.45f))
                            else LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                items(state.todos, key = { it.id }) { todo ->
                                    Row(
                                        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(PanelHigh).padding(10.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Box(
                                            Modifier.size(18.dp).clip(RoundedCornerShape(5.dp)).background(if (todo.done) GrassGreen else Color.Transparent)
                                                .border(1.5.dp, if (todo.done) GrassGreen else TextPrimary.copy(alpha = 0.4f), RoundedCornerShape(5.dp))
                                                .clickable { repository.toggleTodo(todo.id) },
                                            contentAlignment = Alignment.Center,
                                        ) { if (todo.done) Text("✓", fontSize = 12.sp, color = Color(0xFF06210A), fontWeight = FontWeight.Bold) }
                                        Spacer(Modifier.width(10.dp))
                                        Column(Modifier.weight(1f)) {
                                            Text(todo.text, color = if (todo.done) TextPrimary.copy(alpha = 0.4f) else TextPrimary, textDecoration = if (todo.done) androidx.compose.ui.text.style.TextDecoration.LineThrough else null)
                                        }
                                        IconButton(onClick = { repository.removeTodo(todo.id) }) { Icon(Icons.Rounded.Close, L("删除", "Delete"), tint = DangerRed, modifier = Modifier.size(16.dp)) }
                                    }
                                }
                            }
                        }
                    }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(L("关闭", "Close"), color = GrassGreen) } },
    )
}

@Composable
private fun LobbyDynamicConfigView(state: MctierUiState, repository: MctierRepository, onClose: () -> Unit) {
    val ctx = LocalContext.current
    val iAmHost = state.hostId != null && state.hostId == state.playerId
    // 工作副本：编辑期间不直接改全局，取消则丢弃
    var useGlobal by remember { mutableStateOf(state.settings.lobbyUseGlobalConfig) }
    var cfg by remember { mutableStateOf(state.settings) }
    LazyColumn(verticalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.fillMaxSize()) {
        // 语音频道（小队语音）：所有玩家可选
        item {
            SectionCard {
                Text(L("语音频道", "Voice Channel"), fontWeight = FontWeight.Bold, color = TextPrimary)
                Spacer(Modifier.height(6.dp))
                Text(
                    L("选择一个语音频道后，你将只能听到同频道玩家的声音，也只有同频道的人能听到你的声音。", "After choosing a voice channel you only hear players in the same channel, and only they hear you."),
                    fontSize = 12.sp, color = TextPrimary.copy(alpha = 0.6f), lineHeight = 18.sp,
                )
                Spacer(Modifier.height(12.dp))
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    listOf(0 to L("公共频道", "Public"), 1 to L("1 队", "Team 1"), 2 to L("2 队", "Team 2"), 3 to L("3 队", "Team 3"), 4 to L("4 队", "Team 4"), 5 to L("5 队", "Team 5")).forEach { (g, label) ->
                        val sel = state.myVoiceGroup == g
                        Box(
                            Modifier.clip(RoundedCornerShape(16.dp))
                                .background(if (sel) GrassGreen else PanelHigh)
                                .clickable {
                                    repository.setMyVoiceGroup(g)
                                    android.widget.Toast.makeText(ctx, if (g == 0) L("已切换到公共频道", "Switched to public channel") else L("已加入${label}", "Joined $label"), android.widget.Toast.LENGTH_SHORT).show()
                                }
                                .padding(horizontal = 14.dp, vertical = 8.dp),
                        ) { Text(label, fontSize = 13.sp, color = if (sel) TextPrimary else TextPrimary.copy(alpha = 0.75f), fontWeight = if (sel) FontWeight.SemiBold else FontWeight.Normal) }
                    }
                }
            }
        }
        if (iAmHost) item { LobbySettingsCard(state, repository) }
        // 变声器：大厅内实时切换音色，开麦即生效
        item {
            SectionCard {
                VoiceChangerSection(
                    settings = state.settings,
                    onChange = { repository.updateSettings(it) },
                )
            }
        }
        // 消息弹幕：大厅内即时调整，无需退出大厅
        item {
            SectionCard {
                DanmakuSettingsSection(
                    settings = state.settings,
                    onChange = { repository.updateSettings(it) },
                )
            }
        }
        item {
            SectionCard {
                Text(L("EasyTier 动态配置", "EasyTier Live Config"), fontWeight = FontWeight.Bold, color = TextPrimary)
                Spacer(Modifier.height(4.dp))
                Text(L("修改后保存将自动重新加入大厅以生效", "Saving will rejoin the lobby to apply changes"), fontSize = 11.sp, color = TextPrimary.copy(alpha = 0.5f))
                Spacer(Modifier.height(12.dp))
                SwitchRow(L("使用全局配置", "Use global config"), useGlobal) { useGlobal = it }
                if (useGlobal) {
                    Spacer(Modifier.height(10.dp))
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp))
                            .background(GrassGreen.copy(alpha = 0.12f)).padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Rounded.CheckCircle, null, tint = GrassGreen, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(8.dp))
                        Text(L("当前使用全局配置，可在 MCTier 设置中修改全局配置", "Using global config; change it in MCTier Settings"), fontSize = 12.sp, color = TextPrimary.copy(alpha = 0.85f))
                    }
                } else {
                    Spacer(Modifier.height(10.dp))
                    MctierField(cfg.mtu.toString(), { v -> cfg = cfg.copy(mtu = v.filter { it.isDigit() }.toIntOrNull() ?: cfg.mtu) }, L("MTU（默认 1420）", "MTU (default 1420)"))
                    Spacer(Modifier.height(8.dp))
                    SwitchRow(L("延迟优先", "Latency first"), cfg.latencyFirst) { cfg = cfg.copy(latencyFirst = it) }
                    SwitchRow(L("多线程", "Multi-thread"), cfg.multiThread) { cfg = cfg.copy(multiThread = it) }
                    SwitchRow(L("启用 smoltcp 用户态协议栈", "Enable smoltcp stack"), cfg.useSmoltcp) { cfg = cfg.copy(useSmoltcp = it) }
                    SwitchRow(L("启用 KCP 代理", "Enable KCP proxy"), cfg.enableKcpProxy) { cfg = cfg.copy(enableKcpProxy = it) }
                    SwitchRow(L("启用 QUIC 代理", "Enable QUIC proxy"), cfg.enableQuicProxy) { cfg = cfg.copy(enableQuicProxy = it) }
                    SwitchRow(L("禁用 P2P(仅走中继)", "Disable P2P (relay only)"), cfg.disableP2p) { cfg = cfg.copy(disableP2p = it) }
                    SwitchRow(L("禁用 UDP 打洞", "Disable UDP hole punching"), cfg.disableUdpHolePunching) { cfg = cfg.copy(disableUdpHolePunching = it) }
                    SwitchRow(L("转发所有对等节点 RPC", "Relay all peer RPC"), cfg.relayAllPeerRpc) { cfg = cfg.copy(relayAllPeerRpc = it) }
                    SwitchRow(L("私有模式", "Private mode"), cfg.privateMode) { cfg = cfg.copy(privateMode = it) }
                    SwitchRow(L("作为出口节点", "As exit node"), cfg.enableAsExitNode) { cfg = cfg.copy(enableAsExitNode = it) }
                }
                Spacer(Modifier.height(14.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Box(
                        Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).background(PanelHigh)
                            .clickable { onClose() }.padding(vertical = 12.dp),
                        contentAlignment = Alignment.Center,
                    ) { Text(L("取消", "Cancel"), color = TextPrimary) }
                    Box(
                        Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).background(DangerRed)
                            .clickable {
                                val d = UserSettings()
                                cfg = cfg.copy(
                                    mtu = d.mtu, latencyFirst = d.latencyFirst, multiThread = d.multiThread,
                                    useSmoltcp = d.useSmoltcp, enableKcpProxy = d.enableKcpProxy, enableQuicProxy = d.enableQuicProxy,
                                    disableP2p = d.disableP2p, disableUdpHolePunching = d.disableUdpHolePunching,
                                    relayAllPeerRpc = d.relayAllPeerRpc, privateMode = d.privateMode, enableAsExitNode = d.enableAsExitNode,
                                )
                                useGlobal = true
                                android.widget.Toast.makeText(ctx, L("已重置为默认配置", "Reset to defaults"), android.widget.Toast.LENGTH_SHORT).show()
                            }.padding(vertical = 12.dp),
                        contentAlignment = Alignment.Center,
                    ) { Text(L("重置", "Reset"), color = TextPrimary) }
                    Box(
                        Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).background(GrassGreen)
                            .clickable {
                                repository.updateSettings(cfg.copy(lobbyUseGlobalConfig = useGlobal))
                                onClose()
                                repository.reloadLobby()
                                android.widget.Toast.makeText(ctx, L("配置已保存，正在重新加入大厅…", "Config saved, rejoining lobby..."), android.widget.Toast.LENGTH_SHORT).show()
                            }.padding(vertical = 12.dp),
                        contentAlignment = Alignment.Center,
                    ) { Text(L("保存", "Save"), color = TextPrimary, fontWeight = FontWeight.Bold) }
                }
            }
        }
        item { Spacer(Modifier.height(12.dp)) }
    }
}

@Composable
private fun LobbySettingsCard(state: MctierUiState, repository: MctierRepository) {
    val ctx = LocalContext.current
    var isPublic by remember(state.isPublicLobby) { mutableStateOf(state.isPublicLobby) }
    var maxText by remember(state.maxPlayers) { mutableStateOf(state.maxPlayers?.toString() ?: "") }
    var description by remember { mutableStateOf("") }
    var announce by remember(state.announcement) { mutableStateOf(state.announcement) }
    SectionCard {
        Text(L("大厅动态设置（房主）", "Lobby Settings (Host)"), fontWeight = FontWeight.Bold, color = TextPrimary)
        Spacer(Modifier.height(4.dp))
        Text(L("修改后点保存即时生效，无需重新进入大厅", "Changes take effect on save without rejoining"), fontSize = 11.sp, color = TextPrimary.copy(alpha = 0.5f))
        Spacer(Modifier.height(12.dp))
        MctierField(maxText, { maxText = it.filter { c -> c.isDigit() } }, L("人数上限（留空=不限）", "Max players (blank = unlimited)"))
        Spacer(Modifier.height(10.dp))
        SwitchRow(L("发布到公开广场", "Publish to plaza"), isPublic) { isPublic = it }
        if (isPublic) {
            Spacer(Modifier.height(6.dp))
            MctierField(description, { description = it }, L("大厅描述", "Lobby description"))
            Spacer(Modifier.height(6.dp))
            Text(L("会展示在公开广场，帮助其他用户快速了解这个大厅。", "Shown in the public plaza so others can understand this lobby."), fontSize = 11.sp, color = TextPrimary.copy(alpha = 0.5f))
        }
        Spacer(Modifier.height(10.dp))
        SwitchRow(L("新消息提示音", "New message sound"), !state.settings.soundMutedMsg) {
            repository.updateSettings(state.settings.copy(soundMutedMsg = !it))
        }
        Spacer(Modifier.height(8.dp))
        SwitchRow(L("玩家加入提示音", "Player joined sound"), !state.settings.soundMutedJoin) {
            repository.updateSettings(state.settings.copy(soundMutedJoin = !it))
        }
        Spacer(Modifier.height(8.dp))
        SwitchRow(L("玩家离开提示音", "Player left sound"), !state.settings.soundMutedLeave) {
            repository.updateSettings(state.settings.copy(soundMutedLeave = !it))
        }
        Spacer(Modifier.height(14.dp))
        PrimaryButton(L("保存大厅设置", "Save Lobby Settings")) {
            val lobbyPwd = state.lobby?.password
            repository.setLobbyOptions(maxText.toIntOrNull()?.takeIf { it > 0 }, isPublic, description, lobbyPwd)
            android.widget.Toast.makeText(ctx, L("大厅设置已保存", "Lobby settings saved"), android.widget.Toast.LENGTH_SHORT).show()
        }
    }
    Spacer(Modifier.height(12.dp))
    SectionCard {
        Text(L("大厅公告", "Lobby Announcement"), fontWeight = FontWeight.SemiBold, color = TextPrimary, fontSize = 14.sp)
        Spacer(Modifier.height(4.dp))
        Text(L("公告会在所有成员的大厅顶部以滚动条形式展示，新加入者也会自动看到（玩法规则/服务器地址等）", "The announcement scrolls at the top for all members, including newcomers"), fontSize = 11.sp, color = TextPrimary.copy(alpha = 0.5f), lineHeight = 16.sp)
        Spacer(Modifier.height(8.dp))
        MctierField(announce, { announce = it.take(200) }, L("公告内容（留空并发布可清除）", "Announcement (publish empty to clear)"))
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(
                Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).background(GrassGreen)
                    .clickable {
                        repository.setAnnouncement(announce)
                        android.widget.Toast.makeText(ctx, if (announce.isBlank()) L("已清空公告", "Announcement cleared") else L("公告已发布", "Announcement published"), android.widget.Toast.LENGTH_SHORT).show()
                    }.padding(vertical = 11.dp),
                contentAlignment = Alignment.Center,
            ) { Text(L("发布公告", "Publish"), color = TextPrimary, fontWeight = FontWeight.SemiBold) }
            if (state.announcement.isNotBlank()) {
                Box(
                    Modifier.clip(RoundedCornerShape(12.dp)).background(PanelHigh)
                        .clickable {
                            announce = ""
                            repository.setAnnouncement("")
                            android.widget.Toast.makeText(ctx, L("已清空公告", "Announcement cleared"), android.widget.Toast.LENGTH_SHORT).show()
                        }.padding(horizontal = 18.dp, vertical = 11.dp),
                    contentAlignment = Alignment.Center,
                ) { Text(L("清空", "Clear"), color = DangerRed) }
            }
        }
    }
}

@Composable
private fun PlayersTab(state: MctierUiState, repository: MctierRepository) {
    val clipboard = LocalClipboardManager.current
    val ctx = LocalContext.current
    var transferTarget by remember { mutableStateOf<Pair<String, String>?>(null) }
    var kickTarget by remember { mutableStateOf<Pair<String, String>?>(null) }

    transferTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { transferTarget = null },
            containerColor = Panel,
            title = { Text(L("转让房主", "Transfer Host"), color = TextPrimary) },
            text = { Text(L("确定把房主权限转让给 ${target.second} 吗？", "Transfer host permission to ${target.second}?"), color = TextPrimary.copy(alpha = 0.82f)) },
            confirmButton = {
                TextButton(onClick = {
                    repository.transferHost(target.first)
                    android.widget.Toast.makeText(ctx, L("已将房主转让给 ${target.second}", "Transferred host to ${target.second}"), android.widget.Toast.LENGTH_SHORT).show()
                    transferTarget = null
                }) { Text(L("转让", "Transfer"), color = GrassGreen, fontWeight = FontWeight.Bold) }
            },
            dismissButton = {
                TextButton(onClick = { transferTarget = null }) { Text(L("取消", "Cancel"), color = TextPrimary.copy(alpha = 0.7f)) }
            },
        )
    }

    kickTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { kickTarget = null },
            containerColor = Panel,
            title = { Text(L("踢出玩家", "Kick Player"), color = TextPrimary) },
            text = { Text(L("确定将 ${target.second} 踢出大厅吗？", "Kick ${target.second} out of the lobby?"), color = TextPrimary.copy(alpha = 0.82f)) },
            confirmButton = {
                TextButton(onClick = {
                    repository.kickPlayer(target.first)
                    android.widget.Toast.makeText(ctx, L("已将 ${target.second} 踢出大厅", "Kicked ${target.second} from the lobby"), android.widget.Toast.LENGTH_SHORT).show()
                    kickTarget = null
                }) { Text(L("踢出", "Kick"), color = DangerRed, fontWeight = FontWeight.Bold) }
            },
            dismissButton = {
                TextButton(onClick = { kickTarget = null }) { Text(L("取消", "Cancel"), color = TextPrimary.copy(alpha = 0.7f)) }
            },
        )
    }

    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 2.dp)) {
                Text(L("在线玩家", "Online Players"), fontWeight = FontWeight.Bold, color = TextPrimary)
                Spacer(Modifier.width(8.dp))
                Box(Modifier.clip(RoundedCornerShape(8.dp)).background(GrassGreen.copy(alpha = 0.18f)).padding(horizontal = 8.dp, vertical = 2.dp)) {
                    Text("${state.players.size}${state.maxPlayers?.let { "/$it" } ?: ""}", fontSize = 12.sp, color = GrassGreen, fontWeight = FontWeight.Bold)
                }
            }
        }
        items(state.players, key = { it.id }) { player ->
            val isHost = state.hostId != null && player.id == state.hostId
            val isMe = player.id == state.playerId
            val iAmHost = state.hostId != null && state.hostId == state.playerId
            SectionCard(padding = 12.dp, modifier = Modifier.animateItem()) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Box(
                            Modifier.size(44.dp).clip(CircleShape).background(if (player.speaking) GrassGreen else PanelHigh)
                                .then(if (player.speaking) Modifier.border(2.dp, GrassGreen, CircleShape) else Modifier),
                            contentAlignment = Alignment.Center,
                        ) { Text(player.name.take(1).uppercase(), fontWeight = FontWeight.Bold, color = TextPrimary) }
                        // 连接模式（在头像下方显示，节省横向空间）
                        if (!isMe) {
                            val conn = state.playerConnTypes[player.id]
                            if (!conn.isNullOrBlank()) {
                                Spacer(Modifier.height(3.dp))
                                val (ct, cc) = if (conn == "p2p") "P2P" to GrassGreen else L("中继", "Relay") to Color(0xFFFA8C16)
                                Box(Modifier.clip(RoundedCornerShape(4.dp)).background(cc.copy(alpha = 0.18f)).padding(horizontal = 5.dp, vertical = 0.dp)) {
                                    Text(ct, fontSize = 9.sp, color = cc, lineHeight = 12.sp)
                                }
                            }
                        }
                    }
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(player.name, fontWeight = FontWeight.SemiBold, color = TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            if (isHost) {
                                Spacer(Modifier.width(6.dp))
                                Icon(painterResource(R.drawable.ic_crown), L("房主", "Host"), tint = Color(0xFFFFD24A), modifier = Modifier.size(17.dp))
                            }
                            if (isMe) {
                                Spacer(Modifier.width(6.dp))
                                Box(Modifier.clip(RoundedCornerShape(6.dp)).background(GrassGreen.copy(alpha = 0.2f)).padding(horizontal = 6.dp, vertical = 1.dp)) {
                                    Text(L("我", "Me"), fontSize = 10.sp, color = GrassGreen)
                                }
                            }
                        }
                        val useDomain = player.useDomain && !player.virtualDomain.isNullOrBlank()
                        val ipShow = if (useDomain) L("域名: ${player.virtualDomain}", "Domain: ${player.virtualDomain}") else "IP: ${player.virtualIp ?: L("等待中…", "Waiting...")}"
                        val ipCopy = (if (useDomain) player.virtualDomain else player.virtualIp).orEmpty()
                        Column {
                            Text(
                                ipShow, fontSize = 12.sp, color = GrassGreen.copy(alpha = 0.85f),
                                modifier = Modifier.clickable(enabled = ipCopy.isNotBlank()) {
                                    clipboard.setText(AnnotatedString(ipCopy))
                                    android.widget.Toast.makeText(ctx, L("已复制", "Copied"), android.widget.Toast.LENGTH_SHORT).show()
                                },
                            )
                            if (!isMe) {
                                val lat = state.playerLatencies[player.id]
                                val loss = state.playerLossRates[player.id]
                                // 优先显示延迟（探测到有效延迟即说明可达）；仅当延迟超时且有丢包时才显示丢包
                                if (lat != null && lat >= 0) {
                                    Spacer(Modifier.width(8.dp))
                                    val (latText, latColor) = when {
                                        lat < 100 -> "${lat}ms" to GrassGreen
                                        lat < 250 -> "${lat}ms" to Color(0xFFFFD24A)
                                        else -> "${lat}ms" to Color(0xFFFA8C16)
                                    }
                                    Box(Modifier.clip(RoundedCornerShape(6.dp)).background(latColor.copy(alpha = 0.18f)).padding(horizontal = 6.dp, vertical = 1.dp)) {
                                        Text(latText, fontSize = 10.sp, color = latColor)
                                    }
                                } else if (loss != null && loss in 1..99) {
                                    Spacer(Modifier.width(8.dp))
                                    Box(Modifier.clip(RoundedCornerShape(6.dp)).background(DangerRed.copy(alpha = 0.18f)).padding(horizontal = 6.dp, vertical = 1.dp)) {
                                        Text(L("丢包${loss}%", "Loss ${loss}%"), fontSize = 10.sp, color = DangerRed)
                                    }
                                } else if (lat != null) {
                                    Spacer(Modifier.width(8.dp))
                                    Box(Modifier.clip(RoundedCornerShape(6.dp)).background(DangerRed.copy(alpha = 0.18f)).padding(horizontal = 6.dp, vertical = 1.dp)) {
                                        Text(L("超时", "Timeout"), fontSize = 10.sp, color = DangerRed)
                                    }
                                }
                            }
                        }
                    }
                    // 一键禁音该玩家（仅对他人）
                    if (!isMe) {
                        val fav = state.favoritePlayers.contains(player.name)
                        CircleIconButton(if (fav) Icons.Rounded.Star else Icons.Rounded.StarBorder, if (fav) L("取消收藏队友", "Unfavorite") else L("收藏队友", "Favorite"), tint = if (fav) Color(0xFFFFD24A) else TextPrimary.copy(alpha = 0.85f)) {
                            repository.toggleFavoritePlayer(player.name)
                            android.widget.Toast.makeText(ctx, if (fav) L("已取消收藏 ${player.name}", "Unfavorited ${player.name}") else L("已收藏队友 ${player.name}", "Favorited ${player.name}"), android.widget.Toast.LENGTH_SHORT).show()
                        }
                        Spacer(Modifier.width(6.dp))
                        val muted = (state.playerVolumes[player.id] ?: 0.5f) <= 0f
                        CircleIconButton(if (muted) Icons.Rounded.VolumeOff else Icons.Rounded.VolumeUp, if (muted) L("取消禁音", "Unmute") else L("禁音该玩家", "Mute player")) {
                            repository.setPlayerVolume(player.id, if (muted) 1f else 0f)
                        }
                        Spacer(Modifier.width(6.dp))
                        // 远程控制对方设备
                        CircleIconButton(Icons.Rounded.SettingsRemote, L("远程控制对方设备", "Remote control this device")) {
                            if (state.remoteControllingPeer != null || state.remoteControlActiveBy != null) {
                                android.widget.Toast.makeText(ctx, L("已有进行中的远程控制会话", "A remote control session is already active"), android.widget.Toast.LENGTH_SHORT).show()
                            } else {
                                FeatureGate.run(ctx, "remote", L("远程控制须知", "Remote Control Notice")) {
                                    repository.requestRemoteControl(player.id, player.name)
                                    android.widget.Toast.makeText(ctx, L("已发送远程控制请求，等待对方接受…", "Request sent, waiting for the other side to accept..."), android.widget.Toast.LENGTH_SHORT).show()
                                }
                            }
                        }
                        Spacer(Modifier.width(6.dp))
                    }
                }
                if (!isMe) {
                    Spacer(Modifier.height(6.dp))
                    val vol = state.playerVolumes[player.id] ?: 0.5f
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Rounded.VolumeUp, null, tint = TextPrimary.copy(alpha = 0.5f), modifier = Modifier.size(16.dp))
                        Slider(
                            value = vol, onValueChange = { repository.setPlayerVolume(player.id, it) }, valueRange = 0f..1f,
                            modifier = Modifier.weight(1f).padding(horizontal = 8.dp),
                            colors = SliderDefaults.colors(thumbColor = GrassGreen, activeTrackColor = GrassGreen, inactiveTrackColor = PanelHigh),
                        )
                        Text("${(vol * 100).toInt()}%", fontSize = 11.sp, color = TextPrimary.copy(alpha = 0.5f))
                    }
                }
                if (iAmHost && !isMe) {
                    val muted = state.mutedPlayers.contains(player.id)
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        HostActionChip(if (muted) L("解除禁言", "Unmute") else L("禁言", "Mute"), Icons.Rounded.MicOff, false, Modifier.weight(1f)) {
                            repository.setPlayerMuted(player.id, !muted)
                            android.widget.Toast.makeText(ctx, if (muted) L("已解除禁言 ${player.name}", "Unmuted ${player.name}") else L("已禁言 ${player.name}", "Muted ${player.name}"), android.widget.Toast.LENGTH_SHORT).show()
                        }
                        HostActionChip(L("设为房主", "Make Host"), Icons.Rounded.MilitaryTech, false, Modifier.weight(1f)) {
                            transferTarget = player.id to player.name
                        }
                        HostActionChip(L("踢出", "Kick"), Icons.Rounded.Close, true, Modifier.weight(1f)) {
                            kickTarget = player.id to player.name
                        }
                    }
                }
            }
        }
        item { Spacer(Modifier.height(8.dp)) }
    }
}

// ============================ 聊天 ============================
@Composable
private fun ChatTab(state: MctierUiState, repository: MctierRepository) {
    var input by remember { mutableStateOf(androidx.compose.ui.text.input.TextFieldValue("")) }
    var showEmoji by remember { mutableStateOf(false) }
    var emojiCat by remember { mutableStateOf(0) }
    var replyTo by remember { mutableStateOf<ChatMessage?>(null) }
    val listState = rememberLazyListState()
    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        if (uri != null) repository.sendImageChat(uri)
    }
    // @提及自动补全：检测光标前是否正在输入 @名字（@ 后无空格）
    val mentionQuery: String? = remember(input) {
        val pos = input.selection.start.coerceIn(0, input.text.length)
        val before = input.text.substring(0, pos)
        val at = before.lastIndexOf('@')
        if (at < 0) null
        else {
            val frag = before.substring(at + 1)
            if (frag.contains(' ') || frag.contains('\n')) null else frag
        }
    }
    val mentionCandidates = remember(mentionQuery, state.players) {
        if (mentionQuery == null) emptyList()
        else state.players.map { it.name }.filter { it.isNotBlank() && (mentionQuery.isEmpty() || it.contains(mentionQuery, ignoreCase = true)) }.distinct().take(6)
    }
    fun applyMention(name: String) {
        val pos = input.selection.start.coerceIn(0, input.text.length)
        val before = input.text.substring(0, pos)
        val after = input.text.substring(pos)
        val at = before.lastIndexOf('@')
        if (at < 0) return
        val newBefore = before.substring(0, at) + "@" + name + " "
        val newText = newBefore + after
        input = androidx.compose.ui.text.input.TextFieldValue(newText, androidx.compose.ui.text.TextRange(newBefore.length))
    }
    fun doSend() {
        val text = input.text.trim()
        if (text.isEmpty()) return
        val r = replyTo
        val content = if (r != null) {
            val quoted = if (r.type == "image") L("[图片]", "[Image]") else (r.content.lineSequence().firstOrNull()?.take(40) ?: "")
            "> @${r.playerName} $quoted\n$text"
        } else text
        repository.sendChat(content)
        input = androidx.compose.ui.text.input.TextFieldValue("")
        replyTo = null
    }
    val isAtBottom by remember {
        derivedStateOf {
            val info = listState.layoutInfo
            val last = info.visibleItemsInfo.lastOrNull()?.index ?: 0
            info.totalItemsCount == 0 || last >= info.totalItemsCount - 1
        }
    }
    var hasNew by remember { mutableStateOf(false) }
    var prevCount by remember { mutableStateOf(0) }
    val chatScope = rememberCoroutineScope()
    // 标记进入/离开聊天室界面：在聊天室内收到消息不播放提示音
    DisposableEffect(Unit) {
        repository.setInChatRoom(true)
        onDispose { repository.setInChatRoom(false) }
    }
    LaunchedEffect(state.chatMessages.size) {
        val count = state.chatMessages.size
        if (count > 0) {
            // 自己发的消息：无条件滚到底，且绝不提示"新消息"
            val isSelfLatest = state.chatMessages.lastOrNull()?.mine == true
            // 否则：判断"新消息到来之前"用户是否在底部
            val lastVisible = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1
            val wasAtBottom = prevCount == 0 || lastVisible >= prevCount - 1
            if (isSelfLatest || wasAtBottom) {
                runCatching { listState.animateScrollToItem(count - 1) }
                hasNew = false
            } else {
                hasNew = true
            }
        }
        prevCount = count
    }
    LaunchedEffect(isAtBottom) { if (isAtBottom) hasNew = false }
    Column(Modifier.fillMaxSize().imePadding()) {
        Box(Modifier.weight(1f)) {
        LazyColumn(Modifier.fillMaxSize(), state = listState, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(state.chatMessages, key = { it.id }) { ChatBubble(it, repository, Modifier.animateItem(), onQuote = { m -> replyTo = m }) }
        }
        // 悬浮"回到底部/新消息"按钮：仅当不在底部时显示，不打断查看历史
        if (!isAtBottom) {
            Box(
                Modifier.align(Alignment.BottomEnd).padding(12.dp).clip(RoundedCornerShape(20.dp))
                    .background(if (hasNew) GrassGreen else PanelHigh)
                    .clickable { chatScope.launch { runCatching { listState.animateScrollToItem(maxOf(0, state.chatMessages.size - 1)) } } }
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                contentAlignment = Alignment.Center,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Rounded.ArrowDownward, null, tint = TextPrimary, modifier = Modifier.size(16.dp))
                    if (hasNew) { Spacer(Modifier.width(4.dp)); Text(L("新消息", "New messages"), fontSize = 12.sp, color = TextPrimary) }
                }
            }
        }
        }
        Spacer(Modifier.height(8.dp))
        // @提及候选
        AnimatedVisibility(visible = mentionCandidates.isNotEmpty()) {
            Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(bottom = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                mentionCandidates.forEach { name ->
                    Box(
                        Modifier.clip(RoundedCornerShape(16.dp)).background(GrassGreen.copy(alpha = 0.2f))
                            .clickable { applyMention(name) }.padding(horizontal = 12.dp, vertical = 6.dp),
                    ) { Text("@$name", color = GrassGreen, fontSize = 13.sp) }
                }
            }
        }
        // 引用回复预览
        AnimatedVisibility(visible = replyTo != null) {
            replyTo?.let { r ->
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(PanelHigh).padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.width(3.dp).height(32.dp).clip(RoundedCornerShape(2.dp)).background(GrassGreen))
                    Spacer(Modifier.width(8.dp))
                    Column(Modifier.weight(1f)) {
                        Text(L("回复 ${r.playerName}", "Reply to ${r.playerName}"), fontSize = 11.sp, color = GrassGreen)
                        Text(if (r.type == "image") L("[图片]", "[Image]") else r.content, fontSize = 12.sp, color = TextPrimary.copy(alpha = 0.7f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    Icon(Icons.Rounded.Close, L("取消引用", "Cancel quote"), tint = TextPrimary.copy(alpha = 0.6f), modifier = Modifier.size(18.dp).clickable { replyTo = null })
                }
            }
        }
        // 表情面板
        AnimatedVisibility(visible = showEmoji) {
            val emojiCats = remember(appLang) {
                listOf(
                    L("表情", "Smileys") to listOf("😀", "😁", "😂", "🤣", "😊", "😍", "😘", "😎", "🤩", "🥳", "😅", "😇", "🙂", "😉", "😏", "😴", "😭", "😱"),
                    L("手势", "Gestures") to listOf("👍", "👎", "👌", "✌️", "🤝", "🙏", "💪", "👏", "🤗", "🙌", "👋", "🤙", "🤞", "👊", "✋", "🫶", "🤛", "🤜"),
                    L("符号", "Symbols") to listOf("❤️", "💔", "✨", "🔥", "💯", "⭐", "🌟", "💢", "💥", "💦", "💤", "✅", "❌", "❓", "❗", "➕", "💕", "💙"),
                    L("活动", "Activities") to listOf("🎮", "🎉", "🎁", "🍻", "☕", "🚀", "🏆", "🎯", "🎲", "🎵", "💩", "🤡", "👀", "🐶", "🐱", "🌈", "⚽", "🏀"),
                )
            }
            Column(Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
                // 分类标签页
                Row(
                    Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(bottom = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    emojiCats.forEachIndexed { idx, (name, _) ->
                        val active = idx == emojiCat
                        Box(
                            Modifier.clip(RoundedCornerShape(14.dp))
                                .background(if (active) GrassGreen else PanelHigh)
                                .clickable { emojiCat = idx }
                                .padding(horizontal = 14.dp, vertical = 6.dp),
                        ) { Text(name, color = TextPrimary, fontSize = 13.sp, fontWeight = if (active) FontWeight.Bold else FontWeight.Normal) }
                    }
                }
                FlowRowChips(
                    emojiCats[emojiCat.coerceIn(0, emojiCats.size - 1)].second,
                    big = true,
                ) { emoji -> input = androidx.compose.ui.text.input.TextFieldValue(input.text + emoji, androidx.compose.ui.text.TextRange(input.text.length + emoji.length)) }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(
                Modifier.size(46.dp).clip(CircleShape).background(if (showEmoji) GrassGreen else PanelHigh).clickable { showEmoji = !showEmoji },
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Rounded.EmojiEmotions, L("表情", "Emoji"), tint = TextPrimary) }
            Box(
                Modifier.size(46.dp).clip(CircleShape).background(PanelHigh).clickable { imagePicker.launch("image/*") },
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Rounded.Photo, L("发送图片", "Send image"), tint = TextPrimary) }
            OutlinedTextField(
                value = input, onValueChange = { input = it }, modifier = Modifier.weight(1f),
                placeholder = { Text(L("发送消息", "Send a message")) }, maxLines = 4, shape = RoundedCornerShape(14.dp), colors = fieldColors(),
            )
            Box(
                Modifier.size(46.dp).clip(CircleShape).background(if (input.text.isBlank()) PanelHigh else GrassGreen)
                    .clickable(enabled = input.text.isNotBlank()) { doSend() },
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.AutoMirrored.Rounded.Send, L("发送", "Send"), tint = if (input.text.isBlank()) TextPrimary.copy(alpha = 0.4f) else TextPrimary) }
        }
        Spacer(Modifier.height(6.dp))
    }
}

private fun buildMentionText(content: String, baseColor: Color): AnnotatedString = buildAnnotatedString {
    val regex = Regex("@([^\\s@]{1,20})")
    var last = 0
    regex.findAll(content).forEach { m ->
        if (m.range.first > last) withStyle(SpanStyle(color = baseColor)) { append(content.substring(last, m.range.first)) }
        withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(m.value) }
        last = m.range.last + 1
    }
    if (last < content.length) withStyle(SpanStyle(color = baseColor)) { append(content.substring(last)) }
}

private fun formatChatClock(timestamp: Long): String =
    if (timestamp > 0) java.text.SimpleDateFormat("HH:mm", java.util.Locale.getDefault()).format(java.util.Date(timestamp)) else "--:--"

/** 聊天消息首字符圆形头像（与玩家列表统一风格） */
@Composable
private fun ChatAvatar(message: ChatMessage) {
    val ch = (message.playerName.ifBlank { if (message.mine) "我" else "?" })
        .let { Character.toString(it[0]) }.uppercase()
    Box(
        Modifier.size(34.dp).clip(CircleShape)
            .background(if (message.mine) GrassGreen.copy(alpha = 0.85f) else PanelHigh),
        contentAlignment = Alignment.Center,
    ) { Text(ch, fontWeight = FontWeight.Bold, color = TextPrimary, fontSize = 15.sp) }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ChatBubble(message: ChatMessage, repository: MctierRepository, modifier: Modifier = Modifier, onQuote: (ChatMessage) -> Unit = {}) {
    Row(
        horizontalArrangement = if (message.mine) Arrangement.End else Arrangement.Start,
        verticalAlignment = Alignment.Top,
        modifier = modifier.fillMaxWidth(),
    ) {
        if (!message.mine) { ChatAvatar(message); Spacer(Modifier.width(8.dp)) }
        Column(horizontalAlignment = if (message.mine) Alignment.End else Alignment.Start, modifier = Modifier.weight(1f, fill = false)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = if (message.mine) Arrangement.End else Arrangement.Start,
                modifier = Modifier.padding(start = 4.dp, end = 4.dp, bottom = 3.dp),
            ) {
                Text(
                    if (message.mine) L("我", "Me") else message.playerName.ifBlank { L("玩家", "Player") },
                    fontSize = 12.sp,
                    color = if (message.mine) TextPrimary.copy(alpha = 0.5f) else GrassGreen,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            val shape = RoundedCornerShape(
                topStart = 14.dp, topEnd = 14.dp,
                bottomStart = if (message.mine) 14.dp else 4.dp,
                bottomEnd = if (message.mine) 4.dp else 14.dp,
            )
            if (message.type == "image" && message.imageBase64 != null) {
                val bitmap = remember(message.id) {
                    runCatching {
                        val raw = message.imageBase64.substringAfter("base64,", message.imageBase64)
                        val bytes = android.util.Base64.decode(raw, android.util.Base64.DEFAULT)
                        android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                    }.getOrNull()
                }
                if (bitmap != null) {
                    var showZoom by remember(message.id) { mutableStateOf(false) }
                    Image(
                        bitmap = bitmap.asImageBitmap(),
                        contentDescription = L("图片", "Image"),
                        modifier = Modifier.clip(shape).heightIn(max = 240.dp)
                            .combinedClickable(onClick = { showZoom = true }, onLongClick = { onQuote(message) }),
                    )
                    if (showZoom) {
                        Dialog(
                            onDismissRequest = { showZoom = false },
                            properties = DialogProperties(usePlatformDefaultWidth = false),
                        ) {
                            var scale by remember { mutableStateOf(1f) }
                            var offsetX by remember { mutableStateOf(0f) }
                            var offsetY by remember { mutableStateOf(0f) }
                            val tState = rememberTransformableState { zoomChange, panChange, _ ->
                                scale = (scale * zoomChange).coerceIn(1f, 5f)
                                offsetX += panChange.x
                                offsetY += panChange.y
                            }
                            Box(
                                Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.95f))
                                    .clickable { showZoom = false },
                                contentAlignment = Alignment.Center,
                            ) {
                                Image(
                                    bitmap = bitmap.asImageBitmap(),
                                    contentDescription = L("图片放大", "Zoom image"),
                                    modifier = Modifier.fillMaxSize()
                                        .graphicsLayer(
                                            scaleX = scale, scaleY = scale,
                                            translationX = offsetX, translationY = offsetY,
                                        )
                                        .transformable(tState),
                                )
                                CircleIconButton(
                                    Icons.Rounded.Close, L("关闭", "Close"),
                                    modifier = Modifier.align(Alignment.TopEnd).padding(16.dp),
                                ) { showZoom = false }
                                val dlCtx = LocalContext.current
                                CircleIconButton(
                                    Icons.Rounded.Download, L("保存到相册", "Save to gallery"),
                                    modifier = Modifier.align(Alignment.TopStart).padding(16.dp),
                                ) {
                                    repository.saveChatImageToGallery(message.imageBase64) { ok ->
                                        android.widget.Toast.makeText(dlCtx, if (ok) L("已保存到相册 Pictures/MCTier", "Saved to Pictures/MCTier") else L("保存失败", "Save failed"), android.widget.Toast.LENGTH_SHORT).show()
                                    }
                                }
                            }
                        }
                    }
                } else {
                    Box(Modifier.clip(shape).background(PanelHigh).padding(14.dp)) { Text(L("[图片加载失败]", "[Image failed]"), color = TextPrimary.copy(alpha = 0.7f)) }
                }
            } else {
                // 解析引用回复：内容以 "> @名字 摘要\n实际内容" 开头
                val isQuote = message.content.startsWith("> ")
                val quoteLine = if (isQuote) message.content.substringBefore('\n').removePrefix("> ") else ""
                val bodyText = if (isQuote) message.content.substringAfter('\n', "") else message.content
                Box(
                    Modifier.clip(shape).background(if (message.mine) GrassGreen else PanelHigh)
                        .combinedClickable(onClick = {}, onLongClick = { onQuote(message) })
                        .padding(horizontal = 14.dp, vertical = 10.dp),
                ) {
                    Column {
                        if (isQuote && quoteLine.isNotBlank()) {
                            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 6.dp)) {
                                Box(Modifier.width(3.dp).height(16.dp).clip(RoundedCornerShape(2.dp)).background(if (message.mine) Color(0xFF06210A) else GrassGreen))
                                Spacer(Modifier.width(6.dp))
                                Text(quoteLine, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                                    color = if (message.mine) Color(0xFF06210A).copy(alpha = 0.7f) else TextPrimary.copy(alpha = 0.6f))
                            }
                        }
                        Text(buildMentionText(bodyText, if (message.mine) Color(0xFF06210A) else TextPrimary.copy(alpha = 0.92f)), fontSize = 15.sp)
                    }
                }
            }
            // 发送时间（气泡底部）
            Text(formatChatClock(message.timestamp), fontSize = 10.sp, color = TextPrimary.copy(alpha = 0.32f),
                modifier = Modifier.padding(start = 4.dp, end = 4.dp, top = 2.dp))
        }
        if (message.mine) { Spacer(Modifier.width(8.dp)); ChatAvatar(message) }
    }
}

// ============================ 文件 ============================
@Composable
private fun FilesTab(state: MctierUiState, repository: MctierRepository) {
    val context = LocalContext.current
    var name by remember { mutableStateOf("${state.settings.playerName}-Android共享") }
    var password by remember { mutableStateOf("") }
    var browsing by remember { mutableStateOf<RemoteShareEntry?>(null) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri: Uri? ->
        if (uri != null) {
            context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            repository.addSharedFolder(uri, name, password)
            android.widget.Toast.makeText(context, L("已开始共享该文件夹", "Started sharing the folder"), android.widget.Toast.LENGTH_SHORT).show()
        }
    }
    val current = browsing
    // 大厅内的共享实时自动刷新(对齐桌面端，无需手动点刷新)
    LaunchedEffect(Unit) {
        while (true) {
            repository.refreshRemoteShares()
            kotlinx.coroutines.delay(15000)
        }
    }
    if (current != null) {
        RemoteBrowser(current, repository) { browsing = null }
        return
    }
    LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            SectionCard {
                Text(L("共享我的文件夹", "Share My Folder"), fontWeight = FontWeight.Bold, color = TextPrimary)
                Spacer(Modifier.height(4.dp))
                Text(L("同大厅的电脑端可浏览并下载你共享的文件夹", "Desktop members in the lobby can browse and download your shared folder"), fontSize = 12.sp, color = TextPrimary.copy(alpha = 0.5f))
                Spacer(Modifier.height(14.dp))
                MctierField(name, { name = it }, L("共享名称", "Share name"))
                Spacer(Modifier.height(10.dp))
                MctierField(password, { password = it }, L("访问密码（可留空）", "Access password (optional)"))
                Spacer(Modifier.height(14.dp))
                PrimaryButton(L("选择文件夹并共享", "Select a folder to share"), icon = Icons.Rounded.Add) {
                    FeatureGate.run(context, "folder", L("文件夹共享须知", "Folder Sharing Notice")) { launcher.launch(null) }
                }
            }
        }
        items(state.sharedFolders, key = { it.id }) { SharedFolderRow(it, repository) }
        if (state.downloadedFiles.isNotEmpty()) {
            item {
                SectionCard {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Rounded.Download, null, tint = GrassGreen, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text(L("已下载文件（保存路径）", "Downloaded files (save path)"), fontWeight = FontWeight.Bold, color = TextPrimary, modifier = Modifier.weight(1f))
                        TextButton(onClick = { repository.clearDownloadedFiles() }) { Text(L("清空", "Clear"), color = DangerRed, fontSize = 12.sp) }
                    }
                    Spacer(Modifier.height(8.dp))
                    val clipboard = LocalClipboardManager.current
                    val ctx = LocalContext.current
                    state.downloadedFiles.forEach { path ->
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(path.substringAfterLast('/'), color = TextPrimary, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(path, color = TextPrimary.copy(alpha = 0.5f), fontSize = 11.sp)
                            }
                            CircleIconButton(Icons.Rounded.ContentCopy, L("复制路径", "Copy path")) {
                                clipboard.setText(AnnotatedString(path))
                                android.widget.Toast.makeText(ctx, L("已复制完整路径", "Full path copied"), android.widget.Toast.LENGTH_SHORT).show()
                            }
                        }
                    }
                }
            }
        }
        item {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 4.dp)) {
                Text(L("大厅内的共享", "Shares in lobby"), fontWeight = FontWeight.Bold, color = TextPrimary, modifier = Modifier.weight(1f))
                CircleIconButton(Icons.Rounded.Refresh, L("刷新", "Refresh")) { repository.refreshRemoteShares() }
            }
        }
        if (state.remoteShares.isEmpty()) {
            item { Text(L("暂无其他玩家的共享，点刷新试试", "No shares from others yet, tap refresh"), fontSize = 12.sp, color = TextPrimary.copy(alpha = 0.45f)) }
        }
        items(state.remoteShares, key = { it.shareId }) { entry ->
            SectionCard(padding = 12.dp) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clickable { browsing = entry }) {
                    Box(Modifier.size(38.dp).clip(RoundedCornerShape(10.dp)).background(GrassGreen.copy(alpha = 0.18f)), contentAlignment = Alignment.Center) {
                        Icon(Icons.Rounded.Folder, null, tint = GrassGreen)
                    }
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(entry.shareName, fontWeight = FontWeight.SemiBold, color = TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(L("来自 ${entry.ownerName}${if (entry.hasPassword) " · 需密码" else ""}", "From ${entry.ownerName}${if (entry.hasPassword) " · password" else ""}"), fontSize = 12.sp, color = TextPrimary.copy(alpha = 0.5f))
                    }
                    Icon(Icons.AutoMirrored.Rounded.Send, L("浏览", "Browse"), tint = TextPrimary.copy(alpha = 0.5f), modifier = Modifier.size(18.dp))
                }
            }
        }
        item { Spacer(Modifier.height(8.dp)) }
    }
}

@Composable
private fun SharedFolderRow(folder: SharedFolder, repository: MctierRepository) {
    SectionCard(padding = 12.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(38.dp).clip(RoundedCornerShape(10.dp)).background(DirtBrown.copy(alpha = 0.2f)), contentAlignment = Alignment.Center) {
                Icon(Icons.Rounded.Folder, null, tint = DirtBrown)
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(folder.name, fontWeight = FontWeight.SemiBold, color = TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(if (folder.password != null) L("已加密 · 端口 14539", "Encrypted - port 14539") else L("公开 · 端口 14539", "Public - port 14539"), fontSize = 12.sp, color = TextPrimary.copy(alpha = 0.5f))
            }
            IconButton(onClick = { repository.removeSharedFolder(folder.id) }) { Icon(Icons.Rounded.Close, L("移除", "Remove"), tint = DangerRed) }
        }
    }
}

@Composable
private fun RemoteBrowser(entry: RemoteShareEntry, repository: MctierRepository, onBack: () -> Unit) {
    val context = LocalContext.current
    var path by remember { mutableStateOf("") }
    var files by remember { mutableStateOf<List<RemoteFileInfo>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var password by remember { mutableStateOf("") }
    var loadKey by remember { mutableIntStateOf(0) }
    val selectedPaths = remember { mutableStateListOf<String>() }

    LaunchedEffect(path, loadKey) {
        selectedPaths.clear()
        loading = true; error = null
        repository.browseRemoteFiles(entry, path, password.ifBlank { null },
            onResult = { files = it; loading = false },
            onError = { error = it; loading = false; files = emptyList() })
    }
    Column(Modifier.fillMaxSize()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            CircleIconButton(Icons.AutoMirrored.Rounded.ArrowBack, L("返回", "Back")) {
                if (path.isBlank()) onBack() else path = path.substringBeforeLast('/', "")
            }
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(entry.shareName, fontWeight = FontWeight.Bold, color = TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(if (path.isBlank()) "/" else "/$path", fontSize = 12.sp, color = TextPrimary.copy(alpha = 0.5f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        if (entry.hasPassword) {
            Spacer(Modifier.height(8.dp))
            MctierField(password, { password = it }, L("访问密码", "Access password"))
            Spacer(Modifier.height(4.dp))
            PrimaryButton(L("确认密码并刷新", "Confirm and refresh")) { loadKey++ }
        }
        Spacer(Modifier.height(10.dp))
        val selectedFiles = files.filter { !it.isDir && it.path in selectedPaths }
        if (selectedFiles.isNotEmpty()) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                Text(L("已选 ${selectedFiles.size} 个文件", "${selectedFiles.size} selected"), color = TextPrimary.copy(alpha = 0.75f), fontSize = 12.sp, modifier = Modifier.weight(1f))
                TextButton(onClick = { selectedPaths.clear() }) { Text(L("清空", "Clear"), color = TextPrimary.copy(alpha = 0.65f)) }
                TextButton(onClick = {
                    repository.downloadRemoteFiles(entry, selectedFiles, password.ifBlank { null },
                        onResult = { p -> android.widget.Toast.makeText(context, L("已下载到 $p", "Downloaded to $p"), android.widget.Toast.LENGTH_LONG).show() },
                        onError = { e -> android.widget.Toast.makeText(context, e, android.widget.Toast.LENGTH_SHORT).show() })
                }) { Text(L("下载选中", "Download selected"), color = GrassGreen, fontWeight = FontWeight.SemiBold) }
            }
            Spacer(Modifier.height(8.dp))
        }
        when {
            loading -> Box(Modifier.fillMaxWidth().padding(top = 30.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = GrassGreen) }
            error != null -> Text(if (error!!.contains(L("密码错误", "Wrong password"))) error!! else "加载失败：$error", color = DangerRed)
            files.isEmpty() -> Text(L("此目录为空", "This folder is empty"), color = TextPrimary.copy(alpha = 0.45f))
            else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(files, key = { it.path }) { file ->
                    val dlState by repository.state.collectAsState()
                    val downloadKey = repository.downloadKey(entry, file)
                    val pct = dlState.downloadProgress[downloadKey]
                    val selected = file.path in selectedPaths
                    SectionCard(padding = 12.dp) {
                      Column {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            if (!file.isDir) {
                                Checkbox(
                                    checked = selected,
                                    onCheckedChange = { checked ->
                                        if (checked) {
                                            if (file.path !in selectedPaths) selectedPaths.add(file.path)
                                        } else {
                                            selectedPaths.remove(file.path)
                                        }
                                    },
                                )
                                Spacer(Modifier.width(4.dp))
                            }
                            Icon(if (file.isDir) Icons.Rounded.Folder else Icons.Rounded.Description, null, tint = if (file.isDir) DirtBrown else GrassGreen)
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f).then(if (file.isDir) Modifier.clickable { path = file.path } else Modifier)) {
                                Text(file.name, color = TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(if (file.isDir) L("文件夹", "Folder") else formatSize(file.size), fontSize = 12.sp, color = TextPrimary.copy(alpha = 0.5f))
                            }
                            if (!file.isDir) {
                                if (pct != null) {
                                    IconButton(onClick = {
                                        repository.cancelRemoteDownload(entry, file)
                                        android.widget.Toast.makeText(context, L("已取消下载", "Download canceled"), android.widget.Toast.LENGTH_SHORT).show()
                                    }) { Icon(Icons.Rounded.Close, L("取消下载", "Cancel download"), tint = DangerRed) }
                                    Text(if (pct >= 0) "$pct%" else L("下载中", "Downloading"), fontSize = 12.sp, color = GrassGreen)
                                } else {
                                    IconButton(onClick = {
                                        repository.downloadRemoteFile(entry, file, password.ifBlank { null },
                                            onResult = { p -> android.widget.Toast.makeText(context, L("已下载到 $p", "Downloaded to $p"), android.widget.Toast.LENGTH_LONG).show() },
                                            onError = { e -> android.widget.Toast.makeText(context, L("下载失败：$e", "Download failed: $e"), android.widget.Toast.LENGTH_SHORT).show() })
                                    }) { Icon(Icons.Rounded.Download, L("下载", "Download"), tint = GrassGreen) }
                                }
                            }
                        }
                        if (pct != null) {
                            Spacer(Modifier.height(8.dp))
                            if (pct >= 0) {
                                LinearProgressIndicator(
                                    progress = { pct / 100f },
                                    modifier = Modifier.fillMaxWidth().height(4.dp).clip(RoundedCornerShape(2.dp)),
                                    color = GrassGreen, trackColor = PanelHigh,
                                )
                            } else {
                                LinearProgressIndicator(
                                    modifier = Modifier.fillMaxWidth().height(4.dp).clip(RoundedCornerShape(2.dp)),
                                    color = GrassGreen, trackColor = PanelHigh,
                                )
                            }
                        }
                      }
                    }
                }
                item { Spacer(Modifier.height(8.dp)) }
            }
        }
    }
}

private fun formatSize(size: Long): String = when {
    size >= 1024L * 1024 * 1024 -> "%.1f GB".format(size / 1024.0 / 1024 / 1024)
    size >= 1024L * 1024 -> "%.1f MB".format(size / 1024.0 / 1024)
    size >= 1024 -> "%.1f KB".format(size / 1024.0)
    else -> "$size B"
}

// ============================ 屏幕共享 ============================
@Composable
private fun ScreenTab(state: MctierUiState, repository: MctierRepository) {
    val context = LocalContext.current
    var requirePassword by remember { mutableStateOf(false) }
    var password by remember { mutableStateOf("") }
    val viewingId = state.viewingShareId
    if (viewingId != null) {
        ScreenViewer(state, repository, viewingId)
        return
    }
    val iAmSharing = state.screenShares.any { it.playerId == state.playerId }
    val mpLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == android.app.Activity.RESULT_OK && result.data != null) {
            repository.startScreenCapture(result.data!!, requirePassword, password)
        }
    }
    LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            SectionCard {
                Text(L("屏幕共享", "Screen Sharing"), fontWeight = FontWeight.Bold, color = TextPrimary)
                Spacer(Modifier.height(10.dp))
                if (iAmSharing) {
                    Text(L("你正在共享自己的屏幕", "You are sharing your screen"), color = GrassGreen)
                    Spacer(Modifier.height(12.dp))
                    Button(
                        onClick = { repository.stopScreenCapture() },
                        modifier = Modifier.fillMaxWidth().height(48.dp), shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = DangerRed),
                    ) { Text(L("停止共享", "Stop Sharing")) }
                } else {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(L("需要观看密码", "Viewing password required"), color = TextPrimary.copy(alpha = 0.85f), modifier = Modifier.weight(1f))
                        Switch(requirePassword, { requirePassword = it }, colors = switchColors())
                    }
                    if (requirePassword) {
                        Spacer(Modifier.height(8.dp))
                        MctierField(password, { password = it }, L("观看密码", "Viewing password"))
                    }
                    Spacer(Modifier.height(14.dp))
                    PrimaryButton(L("共享我的屏幕", "Share my screen")) {
                        FeatureGate.run(context, "screen", L("屏幕共享须知", "Screen Sharing Notice")) {
                            val mpm = context.getSystemService(android.content.Context.MEDIA_PROJECTION_SERVICE) as android.media.projection.MediaProjectionManager
                            mpLauncher.launch(mpm.createScreenCaptureIntent())
                        }
                    }
                    Spacer(Modifier.height(6.dp))
                }
            }
        }
        if (state.screenShares.any { it.playerId != state.playerId }) {
            item { Text(L("可观看的共享", "Available screens"), fontSize = 13.sp, color = TextPrimary.copy(alpha = 0.6f)) }
        }
        items(state.screenShares.filter { it.playerId != state.playerId }, key = { it.id }) { share ->
            var pwd by remember(share.id) { mutableStateOf("") }
            SectionCard(padding = 14.dp) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Rounded.ScreenShare, null, tint = GrassGreen)
                    Spacer(Modifier.width(10.dp))
                    Text("${share.playerName} 的屏幕${if (share.requirePassword) "（需密码）" else ""}", color = TextPrimary.copy(alpha = 0.9f), modifier = Modifier.weight(1f))
                }
                if (share.requirePassword) {
                    Spacer(Modifier.height(8.dp))
                    MctierField(pwd, { pwd = it }, L("观看密码", "Viewing password"))
                }
                Spacer(Modifier.height(10.dp))
                PrimaryButton(L("观看", "Watch")) { repository.startViewingScreen(share, pwd.ifBlank { null }) }
            }
        }
        item { Spacer(Modifier.height(8.dp)) }
    }
}

@Composable
private fun ScreenViewer(state: MctierUiState, repository: MctierRepository, shareId: String) {
    val controller = repository.screenController
    val share = state.screenShares.firstOrNull { it.id == shareId }
    var remoteTrack by remember(shareId) { mutableStateOf<VideoTrack?>(null) }
    var frameRendered by remember(shareId) { mutableStateOf(false) }
    var fullscreen by remember { mutableStateOf(false) }
    var shareFrameW by remember(shareId) { mutableStateOf(0) }
    var shareFrameH by remember(shareId) { mutableStateOf(0) }
    val mainHandler = remember { android.os.Handler(android.os.Looper.getMainLooper()) }

    // 统一通过回调接收远端轨道，供内嵌与全屏渲染器共同使用
    DisposableEffect(shareId, controller) {
        controller?.onRemoteVideoTrack = { track ->
            mainHandler.post {
                remoteTrack = track
                if (track == null) frameRendered = false
            }
        }
        onDispose { repository.screenController?.onRemoteVideoTrack = null }
    }

    Column(Modifier.fillMaxSize()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            CircleIconButton(Icons.AutoMirrored.Rounded.ArrowBack, L("停止观看", "Stop watching")) { repository.stopViewingScreen() }
            Spacer(Modifier.width(10.dp))
            Text(L("正在观看 ${share?.playerName ?: ""} 的屏幕", "Watching ${share?.playerName ?: ""}'s screen"), color = TextPrimary, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            CircleIconButton(Icons.Rounded.Fullscreen, L("横屏全屏", "Landscape fullscreen")) { fullscreen = true }
        }
        Spacer(Modifier.height(12.dp))
        if (controller == null) {
            Text(L("屏幕共享未就绪", "Screen share not ready"), color = DangerRed)
        } else {
            Box(
                Modifier.fillMaxWidth().heightIn(min = 220.dp).clip(RoundedCornerShape(14.dp)).background(Color.Black),
                contentAlignment = Alignment.Center,
            ) {
                ScreenRenderSurface(
                    controller = controller,
                    track = remoteTrack,
                    onFirstFrame = { frameRendered = true },
                    onFrameSize = { w, h -> shareFrameW = w; shareFrameH = h },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 220.dp, max = 460.dp),
                )
                if (!frameRendered) Text(L("等待画面…", "Waiting for video..."), color = TextPrimary.copy(alpha = 0.4f))
            }
            Spacer(Modifier.height(8.dp))
            Text(L("提示：点右上角全屏按钮可横屏放大查看，看电脑画面更清晰", "Tip: tap fullscreen at the top right for a clearer landscape view"), fontSize = 11.sp, color = TextPrimary.copy(alpha = 0.45f))
            Spacer(Modifier.height(10.dp))
            Button(
                onClick = { repository.stopViewingScreen() },
                modifier = Modifier.fillMaxWidth().height(48.dp),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(containerColor = DangerRed),
            ) { Text(L("停止观看", "Stop watching")) }
        }
    }

    if (fullscreen && controller != null) {
        val context = LocalContext.current
        val activity = context as? android.app.Activity
        // 进入全屏时强制横屏 + 隐藏系统状态栏/导航栏，退出时恢复
        DisposableEffect(Unit) {
            val original = activity?.requestedOrientation ?: android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            // 根据对方屏幕宽高比自动选择横屏/竖屏，画面铺满更完整
            activity?.requestedOrientation = if (shareFrameW > 0 && shareFrameH in 1 until shareFrameW)
                android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            else
                android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
            val win = activity?.window
            val insetsController = win?.let { androidx.core.view.WindowCompat.getInsetsController(it, it.decorView) }
            insetsController?.let {
                it.systemBarsBehavior = androidx.core.view.WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                it.hide(androidx.core.view.WindowInsetsCompat.Type.systemBars())
            }
            onDispose {
                activity?.requestedOrientation = original
                insetsController?.show(androidx.core.view.WindowInsetsCompat.Type.systemBars())
            }
        }
        Dialog(
            onDismissRequest = { fullscreen = false },
            properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnClickOutside = false),
        ) {
            Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
                ScreenRenderSurface(
                    controller = controller,
                    track = remoteTrack,
                    onFirstFrame = {},
                    modifier = Modifier.fillMaxSize(),
                )
                CircleIconButton(
                    Icons.Rounded.FullscreenExit,
                    L("退出全屏", "Exit fullscreen"),
                    modifier = Modifier.align(Alignment.TopEnd).padding(16.dp),
                ) { fullscreen = false }
            }
        }
    }
}

/** 屏幕渲染表面：创建 SurfaceViewRenderer，监听首帧，并把远端轨道作为 sink 接入 */
@Composable
private fun ScreenRenderSurface(
    controller: top.pmh13.mctier.network.ScreenShareController,
    track: VideoTrack?,
    onFirstFrame: () -> Unit,
    onFrameSize: (Int, Int) -> Unit = { _, _ -> },
    modifier: Modifier = Modifier,
) {
    val rendererRef = remember { arrayOfNulls<SurfaceViewRenderer>(1) }
    AndroidView(
        factory = { ctx ->
            SurfaceViewRenderer(ctx).apply {
                init(controller.eglBase.eglBaseContext, object : RendererCommon.RendererEvents {
                    override fun onFirstFrameRendered() {
                        android.os.Handler(android.os.Looper.getMainLooper()).post { onFirstFrame() }
                    }
                    override fun onFrameResolutionChanged(p0: Int, p1: Int, p2: Int) {
                        android.os.Handler(android.os.Looper.getMainLooper()).post {
                            if (p2 % 180 == 0) onFrameSize(p0, p1) else onFrameSize(p1, p0)
                        }
                    }
                })
                setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FIT)
                setEnableHardwareScaler(true)
                rendererRef[0] = this
                track?.let { runCatching { it.addSink(this) } }
            }
        },
        update = { view ->
            // 轨道到达/变化时接入 sink
            track?.let { runCatching { it.addSink(view) } }
        },
        modifier = modifier,
    )
    DisposableEffect(track) {
        onDispose {
            rendererRef[0]?.let { r -> track?.let { runCatching { it.removeSink(r) } } }
        }
    }
}

// ============================ 设置面板 ============================
@Composable
private fun SettingsPanel(state: MctierUiState, repository: MctierRepository) {
    val settings = state.settings
    val onChange: (UserSettings) -> Unit = repository::updateSettings
    SectionCard {
        Text(L("设置", "Settings"), fontWeight = FontWeight.Bold, color = TextPrimary)
        Spacer(Modifier.height(14.dp))
        MctierField(settings.playerName, {
            val name = it.replace(Regex("\\s+"), "")
            if (name.length <= 8) onChange(settings.copy(playerName = name))
        }, L("玩家名称（最多8字）", "Player Name (max 8)"))
        Spacer(Modifier.height(12.dp))
        Text(L("EasyTier 节点", "EasyTier Node"), fontSize = 13.sp, color = TextPrimary.copy(alpha = 0.7f))
        Spacer(Modifier.height(8.dp))
        val allNodes = BuiltinNodes.map { Triple(it.name, it.address, false) } +
            state.customNodes.map { Triple(it.name, it.address, true) }
        allNodes.forEach { (nodeName, nodeAddr, isCustom) ->
            val selected = settings.preferredServer == nodeAddr
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp).clip(RoundedCornerShape(10.dp))
                    .background(if (selected) GrassGreen.copy(alpha = 0.16f) else PanelHigh.copy(alpha = 0.3f))
                    .border(1.dp, if (selected) GrassGreen.copy(alpha = 0.5f) else Color.Transparent, RoundedCornerShape(10.dp))
                    .clickable { onChange(settings.copy(preferredServer = nodeAddr)) }
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier.size(16.dp).clip(CircleShape).background(if (selected) GrassGreen else Color.Transparent)
                        .border(1.5.dp, if (selected) GrassGreen else TextPrimary.copy(alpha = 0.4f), CircleShape),
                )
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(if (isCustom) nodeName else nodeDisplayName(nodeName), color = TextPrimary, fontSize = 14.sp, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal)
                        if (isCustom) {
                            Spacer(Modifier.width(6.dp))
                            Box(Modifier.clip(RoundedCornerShape(6.dp)).background(GrassGreen.copy(alpha = 0.2f)).padding(horizontal = 5.dp, vertical = 1.dp)) {
                                Text(L("自定义", "Custom"), fontSize = 9.sp, color = GrassGreen)
                            }
                        }
                    }
                    Text(nodeAddr, color = TextPrimary.copy(alpha = 0.45f), fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                if (isCustom) {
                    IconButton(onClick = { repository.removeCustomNode(nodeAddr) }) {
                        Icon(Icons.Rounded.Close, L("删除", "Delete"), tint = DangerRed, modifier = Modifier.size(16.dp))
                    }
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        var newNodeName by remember { mutableStateOf("") }
        var newNodeAddr by remember { mutableStateOf("") }
        MctierField(newNodeName, { newNodeName = it }, L("新增节点名称", "New node name"))
        Spacer(Modifier.height(6.dp))
        MctierField(newNodeAddr, { newNodeAddr = it }, L("节点地址(tcp/udp/ws/wss://)", "Node address (tcp/udp/ws/wss://)"))
        Spacer(Modifier.height(8.dp))
        PrimaryButton(L("添加自定义节点", "Add custom node"), icon = Icons.Rounded.Add, enabled = newNodeName.isNotBlank() && newNodeAddr.isNotBlank()) {
            repository.addCustomNode(newNodeName, newNodeAddr); newNodeName = ""; newNodeAddr = ""
        }
        Spacer(Modifier.height(12.dp))
        MctierField(settings.signalingServer, { onChange(settings.copy(signalingServer = it)) }, L("信令服务器", "Signaling server"))
        Spacer(Modifier.height(12.dp))
        SwitchRow(L("使用虚拟域名", "Use virtual domain"), settings.useDomain) { onChange(settings.copy(useDomain = it)) }
        if (settings.useDomain) {
            Spacer(Modifier.height(8.dp))
            MctierField(settings.virtualDomain, { onChange(settings.copy(virtualDomain = it)) }, L("虚拟域名", "Virtual domain"))
        }
        Spacer(Modifier.height(4.dp))
        SwitchRow(L("使用出口节点", "Use exit node"), settings.enableExitNode) { onChange(settings.copy(enableExitNode = it)) }
        SwitchRow(L("作为出口节点", "As exit node"), settings.enableAsExitNode) { onChange(settings.copy(enableAsExitNode = it)) }
        Spacer(Modifier.height(8.dp))
        var advancedOpen by remember { mutableStateOf(false) }
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).clickable { advancedOpen = !advancedOpen }.padding(vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(L("高级网络配置", "Advanced network config"), color = TextPrimary.copy(alpha = 0.85f), modifier = Modifier.weight(1f))
            Text(if (advancedOpen) L("收起", "Collapse") else L("展开", "Expand"), color = GrassGreen, fontSize = 13.sp)
        }
        if (advancedOpen) {
            MctierField(settings.mtu.toString(), { v -> onChange(settings.copy(mtu = v.filter { it.isDigit() }.toIntOrNull() ?: settings.mtu)) }, L("MTU（默认 1420）", "MTU (default 1420)"))
            Spacer(Modifier.height(8.dp))
            SwitchRow(L("延迟优先", "Latency first"), settings.latencyFirst) { onChange(settings.copy(latencyFirst = it)) }
            Spacer(Modifier.height(8.dp))
            MctierField(settings.proxyCidrs, { onChange(settings.copy(proxyCidrs = it)) }, L("代理网段(每行一个 CIDR)", "Proxy CIDRs (one per line)"))
            Spacer(Modifier.height(8.dp))
            MctierField(settings.exitNodes, { onChange(settings.copy(exitNodes = it)) }, L("出口节点 IP(每行一个)", "Exit node IPs (one per line)"))
            Spacer(Modifier.height(10.dp))
            Text(L("性能与协议", "Performance & Protocol"), fontSize = 12.sp, color = GrassGreen)
            Spacer(Modifier.height(4.dp))
            SwitchRow(L("多线程", "Multi-thread"), settings.multiThread) { onChange(settings.copy(multiThread = it)) }
            SwitchRow(L("启用 smoltcp 用户态协议栈", "Enable smoltcp stack"), settings.useSmoltcp) { onChange(settings.copy(useSmoltcp = it)) }
            SwitchRow(L("启用 KCP 代理", "Enable KCP proxy"), settings.enableKcpProxy) { onChange(settings.copy(enableKcpProxy = it)) }
            SwitchRow(L("启用 QUIC 代理", "Enable QUIC proxy"), settings.enableQuicProxy) { onChange(settings.copy(enableQuicProxy = it)) }
            SwitchRow(L("启用 Zstd 压缩", "Enable Zstd compression"), settings.compressionZstd) { onChange(settings.copy(compressionZstd = it)) }
            Spacer(Modifier.height(10.dp))
            Text(L("P2P 与中继", "P2P & Relay"), fontSize = 12.sp, color = GrassGreen)
            Spacer(Modifier.height(4.dp))
            SwitchRow(L("禁用 P2P(仅走中继)", "Disable P2P (relay only)"), settings.disableP2p) { onChange(settings.copy(disableP2p = it)) }
            SwitchRow(L("禁用 UDP 打洞", "Disable UDP hole punching"), settings.disableUdpHolePunching) { onChange(settings.copy(disableUdpHolePunching = it)) }
            SwitchRow(L("转发所有对等节点 RPC", "Relay all peer RPC"), settings.relayAllPeerRpc) { onChange(settings.copy(relayAllPeerRpc = it)) }
            SwitchRow(L("私有模式(拒绝陌生网络中继)", "Private mode (reject unknown relays)"), settings.privateMode) { onChange(settings.copy(privateMode = it)) }
        }
        Spacer(Modifier.height(8.dp))
        SwitchRow(L("启动时自动进入大厅", "Auto-join lobby on start"), settings.autoLobbyEnabled) { onChange(settings.copy(autoLobbyEnabled = it)) }
        if (settings.autoLobbyEnabled) {
            Spacer(Modifier.height(8.dp))
            MctierField(settings.autoLobbyName, { onChange(settings.copy(autoLobbyName = it)) }, L("自动大厅名称", "Auto lobby name"))
            Spacer(Modifier.height(8.dp))
            MctierField(settings.autoLobbyPassword, { onChange(settings.copy(autoLobbyPassword = it)) }, L("自动大厅密码", "Auto lobby password"))
        }
        Spacer(Modifier.height(16.dp))
        BackgroundKeepAliveSection()
        Spacer(Modifier.height(16.dp))
        NotificationSettingsSection(settings, onChange, repository::previewSound)
        Spacer(Modifier.height(16.dp))
        DanmakuSettingsSection(settings, onChange)
        Spacer(Modifier.height(16.dp))
        VoiceChangerSection(settings, onChange)
        Spacer(Modifier.height(16.dp))
        ThemeSettingsSection(settings, onChange)
        Spacer(Modifier.height(16.dp))
        ComplianceLinksSection()
        Spacer(Modifier.height(16.dp))
        UpdateSection()
    }
}

@Composable
private fun BackgroundKeepAliveSection() {
    val ctx = LocalContext.current
    fun isIgnoringBattery(): Boolean = runCatching {
        val pm = ctx.getSystemService(android.content.Context.POWER_SERVICE) as android.os.PowerManager
        pm.isIgnoringBatteryOptimizations(ctx.packageName)
    }.getOrDefault(false)
    var ignoring by remember { mutableStateOf(isIgnoringBattery()) }

    // 定时轮询：从系统电池设置返回后自动刷新（比仅依赖生命周期回调更可靠，部分机型 ON_RESUME 不稳定）
    LaunchedEffect(Unit) {
        while (true) {
            val now = isIgnoringBattery()
            if (now != ignoring) ignoring = now
            kotlinx.coroutines.delay(1000)
        }
    }

    Text(L("后台保活", "Background Keep-alive"), fontSize = 13.sp, color = TextPrimary.copy(alpha = 0.7f))
    Spacer(Modifier.height(4.dp))
    Text(
        L(
            "为保证挂后台（如玩游戏时）语音、聊天、弹幕、远程控制不被系统杀掉，强烈建议：\n1. 允许 MCTier 忽略电池优化；\n2. 在系统「应用设置 → 省电策略/耗电管理」中把 MCTier 设为「无限制」；\n3. 在最近任务中给 MCTier 加锁，防止被一键清理。",
            "To keep voice, chat, danmaku and remote control alive in the background (e.g. while gaming), it's strongly recommended to:\n1. Allow MCTier to ignore battery optimization;\n2. Set MCTier's power policy to \"No restrictions\" in system App settings;\n3. Lock MCTier in Recents so it isn't cleared.",
        ),
        fontSize = 11.sp, color = TextPrimary.copy(alpha = 0.5f), lineHeight = 16.sp,
    )
    Spacer(Modifier.height(8.dp))
    // 状态提示
    Row(verticalAlignment = Alignment.CenterVertically) {
        val (dotColor, statusText) = if (ignoring) GrassGreen to L("已加入电池优化白名单", "Added to battery whitelist")
            else Color(0xFFF59E0B) to L("未加入电池优化白名单（建议开启）", "Not in battery whitelist (recommended)")
        Box(Modifier.size(8.dp).clip(CircleShape).background(dotColor))
        Spacer(Modifier.width(6.dp))
        Text(statusText, fontSize = 12.sp, color = dotColor)
    }
    Spacer(Modifier.height(4.dp))
    Text(
        L("注：此状态仅反映系统「电池优化白名单」。厂商的「省电策略 → 无限制」是另一项独立设置，系统接口无法自动检测，请按下方按钮手动设置。", "Note: this status only reflects the system battery-optimization whitelist. The vendor \"power policy → No restrictions\" is a separate setting that the system API cannot auto-detect; please set it manually via the button below."),
        fontSize = 10.sp, color = TextPrimary.copy(alpha = 0.4f), lineHeight = 14.sp,
    )
    Spacer(Modifier.height(8.dp))
    if (!ignoring) {
        Box(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(GrassGreen.copy(alpha = 0.16f))
                .clickable {
                    runCatching {
                        @android.annotation.SuppressLint("BatteryLife")
                        val intent = Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                            data = android.net.Uri.parse("package:${ctx.packageName}")
                        }
                        ctx.startActivity(intent)
                    }.onFailure {
                        runCatching { ctx.startActivity(Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
                    }
                }
                .padding(vertical = 11.dp),
            contentAlignment = Alignment.Center,
        ) { Text(L("允许忽略电池优化", "Allow ignoring battery optimization"), color = GrassGreen, fontWeight = FontWeight.SemiBold) }
        Spacer(Modifier.height(8.dp))
    }
    Box(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(PanelHigh.copy(alpha = 0.5f))
            .clickable {
                ignoring = isIgnoringBattery()
                // 打开本应用的系统设置页，便于用户设置「省电策略 → 无限制」
                runCatching {
                    ctx.startActivity(
                        Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                            data = android.net.Uri.parse("package:${ctx.packageName}")
                        },
                    )
                }
            }
            .padding(vertical = 11.dp),
        contentAlignment = Alignment.Center,
    ) { Text(L("打开应用设置（设为「无限制」省电策略）", "Open App Settings (set power policy to \"No restrictions\")"), color = TextPrimary, fontWeight = FontWeight.SemiBold) }
}

@Composable
private fun NotificationSettingsSection(settings: UserSettings, onChange: (UserSettings) -> Unit, onPreview: (String) -> Unit) {
    val ctx = LocalContext.current
    Text(L("提示音", "Sounds"), fontSize = 13.sp, color = TextPrimary.copy(alpha = 0.7f))
    Spacer(Modifier.height(8.dp))
    Text(L("音量", "Volume"), fontSize = 12.sp, color = TextPrimary.copy(alpha = 0.6f))
    Slider(
        value = settings.soundVolume,
        onValueChange = { onChange(settings.copy(soundVolume = it)) },
        valueRange = 0f..1f,
        colors = SliderDefaults.colors(thumbColor = GrassGreen, activeTrackColor = GrassGreen),
    )
    Spacer(Modifier.height(4.dp))
    SoundPickerRow(L("新消息提示音", "New message sound"), settings.customSoundMsg,
        muted = settings.soundMutedMsg,
        onMuteChange = { onChange(settings.copy(soundMutedMsg = it)) },
        onPick = { onChange(settings.copy(customSoundMsg = it)) },
        onReset = { onChange(settings.copy(customSoundMsg = "")) },
        onPreview = { onPreview("message") })
    SoundPickerRow(L("玩家加入提示音", "Join sound"), settings.customSoundJoin,
        muted = settings.soundMutedJoin,
        onMuteChange = { onChange(settings.copy(soundMutedJoin = it)) },
        onPick = { onChange(settings.copy(customSoundJoin = it)) },
        onReset = { onChange(settings.copy(customSoundJoin = "")) },
        onPreview = { onPreview("join") })
    SoundPickerRow(L("玩家离开提示音", "Leave sound"), settings.customSoundLeave,
        muted = settings.soundMutedLeave,
        onMuteChange = { onChange(settings.copy(soundMutedLeave = it)) },
        onPick = { onChange(settings.copy(customSoundLeave = it)) },
        onReset = { onChange(settings.copy(customSoundLeave = "")) },
        onPreview = { onPreview("leave") })
    Spacer(Modifier.height(12.dp))
    Text(L("消息免打扰", "Do Not Disturb"), fontSize = 13.sp, color = TextPrimary.copy(alpha = 0.7f))
    Spacer(Modifier.height(4.dp))
    SwitchRow(L("启用免打扰时段", "Enable Do Not Disturb period"), settings.dndEnabled) { onChange(settings.copy(dndEnabled = it)) }
    if (settings.dndEnabled) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(L("时段", "Period"), color = TextPrimary.copy(alpha = 0.85f), modifier = Modifier.weight(1f))
            TimeChip(settings.dndStartMinutes) { picked -> onChange(settings.copy(dndStartMinutes = picked)) }
            Text(L("  至  ", "  to  "), color = TextPrimary.copy(alpha = 0.6f), fontSize = 13.sp)
            TimeChip(settings.dndEndMinutes) { picked -> onChange(settings.copy(dndEndMinutes = picked)) }
        }
        Text(L("免打扰时段内不播放任何提示音", "No sounds during the Do Not Disturb period"), fontSize = 11.sp, color = TextPrimary.copy(alpha = 0.45f))
    }
}

@Composable
private fun VoiceChangerSection(settings: UserSettings, onChange: (UserSettings) -> Unit, showTitle: Boolean = true) {
    val vcCtx = LocalContext.current
    val presets = listOf(
        "none" to L("原声", "Original"),
        "uncle" to L("大叔", "Uncle"),
        "male" to L("男声", "Male"),
        "female" to L("女声", "Female"),
        "loli" to L("萝莉", "Loli"),
        "chipmunk" to L("花栗鼠", "Chipmunk"),
        "robot" to L("机器人", "Robot"),
        "telephone" to L("电话音", "Telephone"),
    )
    if (showTitle) {
        Text(L("变声器", "Voice Changer"), fontSize = 13.sp, color = TextPrimary.copy(alpha = 0.7f))
        Spacer(Modifier.height(4.dp))
        Text(
            L("选择音色，开麦即生效；可在大厅动态设置中实时切换", "Pick a voice; applies live when mic is on, switchable in lobby settings"),
            fontSize = 11.sp, color = TextPrimary.copy(alpha = 0.45f),
        )
        Spacer(Modifier.height(8.dp))
    }
    FlowRowChips(
        presets.map { it.second },
        big = false,
        selectedLabel = presets.firstOrNull { it.first == settings.voicePreset }?.second,
    ) { label ->
        val id = presets.firstOrNull { it.second == label }?.first ?: "none"
        if (id == "none") {
            onChange(settings.copy(voicePreset = id))
        } else {
            FeatureGate.run(vcCtx, "voice", L("变声器须知", "Voice Changer Notice")) {
                onChange(settings.copy(voicePreset = id))
            }
        }
    }
    Spacer(Modifier.height(10.dp))
    VoiceAuditionButton(settings)
    Spacer(Modifier.height(8.dp))
    Text(
        L(
            "风险提示：变声功能仅供娱乐与正常社交使用，严禁用于电信网络诈骗、冒充他人身份或任何欺骗、骚扰行为，违者自负法律责任。",
            "Notice: the voice changer is for entertainment and normal social use only. Using it for telecom fraud, impersonation, deception or harassment is strictly prohibited; violators bear legal liability.",
        ),
        fontSize = 11.sp, color = DangerRed.copy(alpha = 0.75f), lineHeight = 16.sp,
    )
}

@Composable
private fun VoiceAuditionButton(settings: UserSettings) {
    val ctx = LocalContext.current
    var auditioning by remember { mutableStateOf(top.pmh13.mctier.network.VoiceAuditioner.isRunning) }
    val permLauncher = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) {
            top.pmh13.mctier.network.VoiceAuditioner.start(settings.voicePreset)
            auditioning = true
        } else {
            android.widget.Toast.makeText(ctx, L("需要麦克风权限才能试听", "Microphone permission is required to audition"), android.widget.Toast.LENGTH_SHORT).show()
        }
    }
    // 离开界面时停止试听，释放麦克风
    DisposableEffect(Unit) {
        onDispose { top.pmh13.mctier.network.VoiceAuditioner.stop() }
    }
    Box(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp))
            .background(if (auditioning) DangerRed.copy(alpha = 0.18f) else GrassGreen.copy(alpha = 0.16f))
            .clickable {
                if (auditioning) {
                    top.pmh13.mctier.network.VoiceAuditioner.stop()
                    auditioning = false
                } else {
                    val granted = androidx.core.content.ContextCompat.checkSelfPermission(
                        ctx, android.Manifest.permission.RECORD_AUDIO,
                    ) == android.content.pm.PackageManager.PERMISSION_GRANTED
                    if (granted) {
                        top.pmh13.mctier.network.VoiceAuditioner.start(settings.voicePreset)
                        auditioning = true
                        android.widget.Toast.makeText(ctx, L("试听已开启：请说话即可实时听到变声效果", "Audition on: speak now to hear the effect in real time"), android.widget.Toast.LENGTH_SHORT).show()
                    } else {
                        permLauncher.launch(android.Manifest.permission.RECORD_AUDIO)
                    }
                }
            }
            .padding(vertical = 11.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            if (auditioning) L("停止试听", "Stop audition") else L("试听变声", "Audition voice"),
            color = if (auditioning) DangerRed else GrassGreen,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

@Composable
private fun DanmakuSettingsSection(settings: UserSettings, onChange: (UserSettings) -> Unit) {
    val ctx = LocalContext.current
    var hasPerm by remember { mutableStateOf(DanmakuOverlay.hasPermission(ctx)) }
    var showColorDialog by remember { mutableStateOf(false) }
    if (showColorDialog) {
        DanmakuColorPickerDialog(
            initial = runCatching { android.graphics.Color.parseColor(settings.danmakuColor) }.getOrDefault(android.graphics.Color.WHITE),
            onDismiss = { showColorDialog = false },
            onConfirm = { hex -> onChange(settings.copy(danmakuColor = hex)); showColorDialog = false },
        )
    }
    Text(L("消息弹幕", "Message Danmaku"), fontSize = 13.sp, color = TextPrimary.copy(alpha = 0.7f))
    Spacer(Modifier.height(4.dp))
    Text(
        L("开启后聊天消息会以弹幕形式从屏幕顶部飘过，玩游戏时也能看到（需悬浮窗权限）", "When enabled, chat messages float across the top of the screen even while gaming (needs overlay permission)"),
        fontSize = 11.sp, color = TextPrimary.copy(alpha = 0.45f), lineHeight = 15.sp,
    )
    Spacer(Modifier.height(8.dp))
    if (!hasPerm) {
        Box(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(GrassGreen.copy(alpha = 0.16f))
                .clickable {
                    runCatching { ctx.startActivity(DanmakuOverlay.requestPermissionIntent(ctx)) }
                }
                .padding(horizontal = 12.dp, vertical = 10.dp),
            contentAlignment = Alignment.Center,
        ) { Text(L("授予悬浮窗权限", "Grant overlay permission"), color = GrassGreen, fontWeight = FontWeight.SemiBold) }
        Spacer(Modifier.height(8.dp))
    }
    SwitchRow(L("启用消息弹幕", "Enable Danmaku"), settings.danmakuEnabled) {
        hasPerm = DanmakuOverlay.hasPermission(ctx)
        if (it && !hasPerm) {
            runCatching { ctx.startActivity(DanmakuOverlay.requestPermissionIntent(ctx)) }
        }
        onChange(settings.copy(danmakuEnabled = it))
    }
    Spacer(Modifier.height(8.dp))
    Text(L("字号", "Font Size") + ": ${settings.danmakuFontSize}sp", fontSize = 12.sp, color = TextPrimary.copy(alpha = 0.6f))
    Slider(
        value = settings.danmakuFontSize.toFloat(),
        onValueChange = { onChange(settings.copy(danmakuFontSize = it.toInt())) },
        valueRange = 14f..40f,
        colors = SliderDefaults.colors(thumbColor = GrassGreen, activeTrackColor = GrassGreen),
    )
    Text(L("滚动速度", "Speed") + ": ${settings.danmakuSpeed}", fontSize = 12.sp, color = TextPrimary.copy(alpha = 0.6f))
    Slider(
        value = settings.danmakuSpeed.toFloat(),
        onValueChange = { onChange(settings.copy(danmakuSpeed = it.toInt())) },
        valueRange = 60f..300f,
        colors = SliderDefaults.colors(thumbColor = GrassGreen, activeTrackColor = GrassGreen),
    )
    Text(L("不透明度", "Opacity") + ": ${(settings.danmakuOpacity * 100).toInt()}%", fontSize = 12.sp, color = TextPrimary.copy(alpha = 0.6f))
    Slider(
        value = settings.danmakuOpacity,
        onValueChange = { onChange(settings.copy(danmakuOpacity = it)) },
        valueRange = 0.2f..1f,
        colors = SliderDefaults.colors(thumbColor = GrassGreen, activeTrackColor = GrassGreen),
    )
    Text(L("弹幕轨道数", "Tracks") + ": ${settings.danmakuTracks}", fontSize = 12.sp, color = TextPrimary.copy(alpha = 0.6f))
    Slider(
        value = settings.danmakuTracks.toFloat(),
        onValueChange = { onChange(settings.copy(danmakuTracks = it.toInt())) },
        valueRange = 1f..8f,
        colors = SliderDefaults.colors(thumbColor = GrassGreen, activeTrackColor = GrassGreen),
    )
    Spacer(Modifier.height(8.dp))
    Text(L("弹幕颜色", "Danmaku Color"), fontSize = 12.sp, color = TextPrimary.copy(alpha = 0.6f))
    Spacer(Modifier.height(6.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        listOf("#FFFFFF", "#52C41A", "#1890FF", "#FAAD14", "#FF4D4F", "#EB2F96").forEach { hex ->
            val selected = settings.danmakuColor.equals(hex, ignoreCase = true)
            Box(
                Modifier.size(28.dp).clip(RoundedCornerShape(50))
                    .background(Color(android.graphics.Color.parseColor(hex)))
                    .border(
                        width = if (selected) 3.dp else 1.dp,
                        color = if (selected) TextPrimary else TextPrimary.copy(alpha = 0.25f),
                        shape = RoundedCornerShape(50),
                    )
                    .clickable { onChange(settings.copy(danmakuColor = hex)) },
            )
        }
        // 彩色（每条随机）
        val rainbowSelected = settings.danmakuColor.equals("rainbow", ignoreCase = true)
        Box(
            Modifier.size(28.dp).clip(RoundedCornerShape(50))
                .background(
                    Brush.sweepGradient(
                        listOf(
                            Color(0xFFFF4D4F), Color(0xFFFAAD14), Color(0xFF52C41A),
                            Color(0xFF1890FF), Color(0xFFEB2F96), Color(0xFFFF4D4F),
                        ),
                    ),
                )
                .border(
                    width = if (rainbowSelected) 3.dp else 1.dp,
                    color = if (rainbowSelected) TextPrimary else TextPrimary.copy(alpha = 0.25f),
                    shape = RoundedCornerShape(50),
                )
                .clickable { onChange(settings.copy(danmakuColor = "rainbow")) },
        )
        // 自定义颜色（打开取色器）
        val presetColors = listOf("#FFFFFF", "#52C41A", "#1890FF", "#FAAD14", "#FF4D4F", "#EB2F96", "rainbow")
        val isCustom = presetColors.none { it.equals(settings.danmakuColor, ignoreCase = true) }
        val customDisplay = runCatching { Color(android.graphics.Color.parseColor(settings.danmakuColor)) }.getOrDefault(PanelHigh)
        Box(
            Modifier.size(28.dp).clip(RoundedCornerShape(50))
                .background(if (isCustom) customDisplay else PanelHigh)
                .border(
                    width = if (isCustom) 3.dp else 1.dp,
                    color = if (isCustom) TextPrimary else TextPrimary.copy(alpha = 0.25f),
                    shape = RoundedCornerShape(50),
                )
                .clickable { showColorDialog = true },
            contentAlignment = Alignment.Center,
        ) {
            if (!isCustom) Text("+", color = TextPrimary.copy(alpha = 0.7f), fontSize = 16.sp, fontWeight = FontWeight.Bold)
        }
    }
    Spacer(Modifier.height(8.dp))
    Box(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(PanelHigh.copy(alpha = 0.5f))
            .clickable {
                hasPerm = DanmakuOverlay.hasPermission(ctx)
                if (!hasPerm) { runCatching { ctx.startActivity(DanmakuOverlay.requestPermissionIntent(ctx)) }; return@clickable }
                val isRainbow = settings.danmakuColor.equals("rainbow", true)
                val colorInt = runCatching { android.graphics.Color.parseColor(settings.danmakuColor) }.getOrDefault(android.graphics.Color.WHITE)
                DanmakuOverlay.applyConfig(ctx, true, settings.danmakuFontSize.toFloat(), settings.danmakuSpeed.toFloat(), settings.danmakuOpacity, settings.danmakuTracks, colorInt, isRainbow)
                DanmakuOverlay.push(L("这是一条弹幕预览 🎮", "This is a danmaku preview 🎮"), colorInt)
                if (!settings.danmakuEnabled) {
                    android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({ DanmakuOverlay.hide() }, 6000)
                }
            }
            .padding(vertical = 11.dp),
        contentAlignment = Alignment.Center,
    ) { Text(L("预览弹幕", "Preview danmaku"), color = TextPrimary, fontWeight = FontWeight.SemiBold) }
}

@Composable
private fun DanmakuColorPickerDialog(initial: Int, onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var r by remember { mutableStateOf(android.graphics.Color.red(initial).toFloat()) }
    var g by remember { mutableStateOf(android.graphics.Color.green(initial).toFloat()) }
    var b by remember { mutableStateOf(android.graphics.Color.blue(initial).toFloat()) }
    val current = Color(r.toInt(), g.toInt(), b.toInt())
    fun hex(): String = String.format("#%02X%02X%02X", r.toInt(), g.toInt(), b.toInt())
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            androidx.compose.material3.TextButton(onClick = { onConfirm(hex()) }) {
                Text(L("确定", "OK"), color = GrassGreen, fontWeight = FontWeight.SemiBold)
            }
        },
        dismissButton = {
            androidx.compose.material3.TextButton(onClick = onDismiss) {
                Text(L("取消", "Cancel"), color = TextPrimary.copy(alpha = 0.7f))
            }
        },
        title = { Text(L("自定义弹幕颜色", "Custom Danmaku Color"), color = TextPrimary, fontWeight = FontWeight.Bold) },
        text = {
            Column {
                Box(
                    Modifier.fillMaxWidth().height(48.dp).clip(RoundedCornerShape(10.dp)).background(current)
                        .border(1.dp, TextPrimary.copy(alpha = 0.25f), RoundedCornerShape(10.dp)),
                    contentAlignment = Alignment.Center,
                ) { Text(hex(), color = if ((r + g + b) / 3 > 140) Color.Black else Color.White, fontWeight = FontWeight.Bold) }
                Spacer(Modifier.height(12.dp))
                Text("R: ${r.toInt()}", fontSize = 12.sp, color = Color(0xFFFF6B6B))
                Slider(value = r, onValueChange = { r = it }, valueRange = 0f..255f,
                    colors = SliderDefaults.colors(thumbColor = Color(0xFFFF4D4F), activeTrackColor = Color(0xFFFF4D4F)))
                Text("G: ${g.toInt()}", fontSize = 12.sp, color = Color(0xFF52C41A))
                Slider(value = g, onValueChange = { g = it }, valueRange = 0f..255f,
                    colors = SliderDefaults.colors(thumbColor = Color(0xFF52C41A), activeTrackColor = Color(0xFF52C41A)))
                Text("B: ${b.toInt()}", fontSize = 12.sp, color = Color(0xFF1890FF))
                Slider(value = b, onValueChange = { b = it }, valueRange = 0f..255f,
                    colors = SliderDefaults.colors(thumbColor = Color(0xFF1890FF), activeTrackColor = Color(0xFF1890FF)))
            }
        },
        containerColor = PanelHigh,
    )
}

@Composable
private fun SoundPickerRow(label: String, current: String, muted: Boolean, onMuteChange: (Boolean) -> Unit, onPick: (String) -> Unit, onReset: () -> Unit, onPreview: () -> Unit) {
    val ctx = LocalContext.current
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri != null) {
            runCatching {
                ctx.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            onPick(uri.toString())
            android.widget.Toast.makeText(ctx, L("已设置自定义提示音", "Custom sound set"), android.widget.Toast.LENGTH_SHORT).show()
        }
    }
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp)) {
        Column(Modifier.weight(1f)) {
            Text(label, color = TextPrimary.copy(alpha = 0.85f), fontSize = 14.sp)
            Text(if (current.isBlank()) L("默认音", "Default") else L("自定义", "Custom"), fontSize = 11.sp,
                color = if (current.isBlank()) TextPrimary.copy(alpha = 0.45f) else GrassGreen)
        }
        IconButton(onClick = onPreview, modifier = Modifier.size(36.dp)) {
            Icon(Icons.Rounded.PlayArrow, L("试听", "Preview"), tint = GrassGreen, modifier = Modifier.size(18.dp))
        }
        TextButton(onClick = { picker.launch(arrayOf("audio/*")) }) {
            Text(L("选择", "Select"), color = GrassGreen, fontSize = 13.sp)
        }
        if (current.isNotBlank()) {
            TextButton(onClick = onReset) {
                Text(L("恢复默认", "Reset"), color = TextPrimary.copy(alpha = 0.6f), fontSize = 13.sp)
            }
        }
        Switch(
            checked = !muted,
            onCheckedChange = { onMuteChange(!it) },
            colors = SwitchDefaults.colors(checkedThumbColor = Color.White, checkedTrackColor = GrassGreen),
        )
    }
}

@Composable
private fun TimeChip(minutes: Int, onPicked: (Int) -> Unit) {
    val ctx = LocalContext.current
    val h = minutes / 60
    val m = minutes % 60
    Box(
        Modifier.clip(RoundedCornerShape(8.dp)).background(PanelHigh.copy(alpha = 0.4f))
            .clickable {
                android.app.TimePickerDialog(ctx, { _, hh, mm -> onPicked(hh * 60 + mm) }, h, m, true).show()
            }
            .padding(horizontal = 12.dp, vertical = 6.dp),
    ) {
        Text(String.format("%02d:%02d", h, m), color = TextPrimary, fontSize = 14.sp)
    }
}

@Composable
private fun ThemeSettingsSection(settings: UserSettings, onChange: (UserSettings) -> Unit) {
    Text(L("主题与配色", "Theme & Colors"), fontSize = 13.sp, color = TextPrimary.copy(alpha = 0.7f))
    Spacer(Modifier.height(8.dp))
    // 语言切换
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(L("语言", "Language"), color = TextPrimary.copy(alpha = 0.85f), modifier = Modifier.weight(1f))
        listOf("zh" to L("简体中文", "Simplified Chinese"), "en" to "English").forEach { (code, label) ->
            val sel = (settings.language.ifBlank { appLang }) == code
            Box(
                Modifier.padding(start = 8.dp).clip(RoundedCornerShape(8.dp))
                    .background(if (sel) GrassGreen.copy(alpha = 0.2f) else PanelHigh.copy(alpha = 0.4f))
                    .border(1.dp, if (sel) GrassGreen else Color.Transparent, RoundedCornerShape(8.dp))
                    .clickable { onChange(settings.copy(language = code)) }
                    .padding(horizontal = 12.dp, vertical = 6.dp),
            ) { Text(label, color = if (sel) GrassGreen else TextPrimary.copy(alpha = 0.7f), fontSize = 13.sp) }
        }
    }
    Spacer(Modifier.height(10.dp))
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(L("外观", "Appearance"), color = TextPrimary.copy(alpha = 0.85f), modifier = Modifier.weight(1f))
        listOf("dark" to L("深色", "Dark"), "light" to L("浅色", "Light")).forEach { (mode, label) ->
            val sel = settings.themeMode == mode
            Box(
                Modifier.padding(start = 8.dp).clip(RoundedCornerShape(8.dp))
                    .background(if (sel) GrassGreen.copy(alpha = 0.2f) else PanelHigh.copy(alpha = 0.4f))
                    .border(1.dp, if (sel) GrassGreen else Color.Transparent, RoundedCornerShape(8.dp))
                    .clickable { onChange(settings.copy(themeMode = mode)) }
                    .padding(horizontal = 14.dp, vertical = 6.dp),
            ) { Text(label, color = if (sel) GrassGreen else TextPrimary.copy(alpha = 0.7f), fontSize = 13.sp) }
        }
    }
    Spacer(Modifier.height(10.dp))
    Text(L("主色调", "Accent Color"), fontSize = 12.sp, color = TextPrimary.copy(alpha = 0.6f))
    Spacer(Modifier.height(6.dp))
    val presets = listOf("" to Color(0xFF52C41A), "#3B82F6" to Color(0xFF3B82F6), "#A855F7" to Color(0xFFA855F7),
        "#F59E0B" to Color(0xFFF59E0B), "#EF4444" to Color(0xFFEF4444), "#06B6D4" to Color(0xFF06B6D4))
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        presets.forEach { (hex, color) ->
            val sel = settings.themePrimary == hex
            Box(
                Modifier.size(34.dp).clip(CircleShape).background(color)
                    .border(if (sel) 3.dp else 1.dp, if (sel) TextPrimary else TextPrimary.copy(alpha = 0.3f), CircleShape)
                    .clickable { onChange(settings.copy(themePrimary = hex)) },
                contentAlignment = Alignment.Center,
            ) {
                if (hex.isBlank()) Text(L("默认", "Default"), fontSize = 8.sp, color = TextPrimary)
            }
        }
    }
}

@Composable
private fun UpdateSection() {
    val context = LocalContext.current
    val updater = remember { UpdateChecker(context) }
    var status by remember { mutableStateOf("") }
    var checking by remember { mutableStateOf(false) }
    var progress by remember { mutableIntStateOf(-1) }
    val main = remember { android.os.Handler(android.os.Looper.getMainLooper()) }

    Text(L("版本与更新", "Version & Updates"), fontSize = 13.sp, color = TextPrimary.copy(alpha = 0.7f))
    Spacer(Modifier.height(8.dp))
    PrimaryButton(
        text = when {
            progress in 0..100 -> "下载中 $progress%"
            checking -> L("检查中…", "Checking...")
            else -> L("检查更新（客户端内升级）", "Check for updates")
        },
        enabled = !checking && progress !in 0..100,
    ) {
        checking = true
        status = ""
        updater.check { hasUpdate, latest ->
            main.post {
                checking = false
                if (hasUpdate) {
                    status = L("发现新版本 $latest，开始下载…", "New version $latest found, downloading...")
                    progress = 0
                    updater.downloadAndInstall(
                        onProgress = { p -> main.post { progress = p } },
                        onError = { e -> main.post { progress = -1; status = L("更新失败：$e", "Update failed: $e") } },
                    )
                } else {
                    status = L("已是最新版本", "Up to date")
                }
            }
        }
    }
    if (status.isNotBlank()) {
        Spacer(Modifier.height(6.dp))
        Text(status, fontSize = 12.sp, color = TextPrimary.copy(alpha = 0.6f))
    }
}

@Composable
private fun SwitchRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp)) {
        Text(label, color = TextPrimary.copy(alpha = 0.85f), modifier = Modifier.weight(1f))
        Switch(checked, onChange, colors = switchColors())
    }
}

// ============================ 通用组件 ============================
@Composable
private fun QuickAccess(label: String, icon: ImageVector, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Column(
        modifier = modifier.clip(RoundedCornerShape(16.dp)).background(Panel).border(1.dp, Hairline, RoundedCornerShape(16.dp))
            .clickable(onClick = onClick).padding(vertical = 14.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(icon, label, tint = GrassGreen, modifier = Modifier.size(24.dp))
        Spacer(Modifier.height(6.dp))
        Text(label, fontSize = 12.sp, color = TextPrimary.copy(alpha = 0.85f))
    }
}

@Composable
private fun SectionCard(padding: Dp = 18.dp, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Panel),
        shape = RoundedCornerShape(18.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, Hairline),
    ) {
        Column(Modifier.padding(padding)) { content() }
    }
}

@Composable
private fun MctierField(value: String, onValueChange: (String) -> Unit, label: String, enabled: Boolean = true, isPassword: Boolean = false) {
    var visible by remember { mutableStateOf(false) }
    OutlinedTextField(
        value = value, onValueChange = onValueChange, label = { Text(label) },
        modifier = Modifier.fillMaxWidth(), singleLine = true, enabled = enabled,
        shape = RoundedCornerShape(14.dp),
        keyboardOptions = KeyboardOptions(keyboardType = if (isPassword) KeyboardType.Password else KeyboardType.Text),
        visualTransformation = if (isPassword && !visible) PasswordVisualTransformation() else VisualTransformation.None,
        trailingIcon = if (isPassword) {
            {
                IconButton(onClick = { visible = !visible }) {
                    Icon(
                        if (visible) Icons.Rounded.Visibility else Icons.Rounded.VisibilityOff,
                        if (visible) L("隐藏密码", "Hide password") else L("显示密码", "Show password"),
                        tint = TextPrimary.copy(alpha = 0.6f),
                    )
                }
            }
        } else null,
        colors = fieldColors(),
    )
}

@Composable
private fun PrimaryButton(text: String, enabled: Boolean = true, icon: ImageVector? = null, onClick: () -> Unit) {
    Button(
        onClick = onClick, enabled = enabled,
        modifier = Modifier.fillMaxWidth().height(52.dp), shape = RoundedCornerShape(14.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = GrassGreen, contentColor = TextPrimary,
            disabledContainerColor = PanelHigh, disabledContentColor = TextPrimary.copy(alpha = 0.4f),
        ),
    ) {
        if (icon != null) { Icon(icon, null, modifier = Modifier.size(20.dp)); Spacer(Modifier.width(8.dp)) }
        Text(text, fontWeight = FontWeight.Bold, fontSize = 16.sp)
    }
}

// ============================ 独立设置界面 + 关于 ============================
@Composable
private fun SettingsScreen(state: MctierUiState, repository: MctierRepository, onBack: () -> Unit) {
    var showAbout by remember { mutableStateOf(false) }
    var showStats by remember { mutableStateOf(false) }
    if (showAbout) {
        BackHandler { showAbout = false }
        AboutScreen { showAbout = false }
        return
    }
    if (showStats) {
        BackHandler { showStats = false }
        StatsScreen(repository) { showStats = false }
        return
    }
    Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(horizontal = 18.dp)) {
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            CircleIconButton(Icons.AutoMirrored.Rounded.ArrowBack, L("返回", "Back"), onClick = onBack)
            Spacer(Modifier.width(12.dp))
            Text(L("设置", "Settings"), fontSize = 20.sp, fontWeight = FontWeight.Bold, color = TextPrimary)
        }
        Spacer(Modifier.height(12.dp))
        LazyColumn(verticalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.weight(1f)) {
            item { SettingsPanel(state, repository) }
            item {
                SectionCard {
                    Row(
                        Modifier.fillMaxWidth().clickable { showStats = true },
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(Modifier.size(28.dp).clip(RoundedCornerShape(8.dp)).background(GrassGreen.copy(alpha = 0.16f)), contentAlignment = Alignment.Center) {
                            Icon(Icons.Rounded.BarChart, null, tint = GrassGreen, modifier = Modifier.size(18.dp))
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(L("数据统计", "Statistics"), color = TextPrimary, fontWeight = FontWeight.SemiBold)
                            Text(L("联机时长、活跃时段、常玩伙伴排行（仅本地保存）", "Online time, active periods, top partners (local only)"), fontSize = 11.sp, color = TextPrimary.copy(alpha = 0.5f))
                        }
                        Text(L("查看", "View"), color = GrassGreen, fontSize = 13.sp)
                    }
                }
            }
            item {
                SectionCard {
                    Row(
                        Modifier.fillMaxWidth().clickable { showAbout = true },
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Image(painterResource(R.drawable.mctier_logo), L("关于", "About"), modifier = Modifier.size(28.dp))
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(L("关于软件", "About"), color = TextPrimary, fontWeight = FontWeight.SemiBold)
                            Text(L("版本、开发者、开源仓库与赞助支持", "Version, developer, repos and sponsorship"), fontSize = 11.sp, color = TextPrimary.copy(alpha = 0.5f))
                        }
                        Text(L("查看", "View"), color = GrassGreen, fontSize = 13.sp)
                    }
                }
            }
            item { Spacer(Modifier.height(20.dp)) }
        }
    }
}

@Composable
private fun StatsScreen(repository: MctierRepository, onBack: () -> Unit) {
    val stats = remember { repository.getStats() }
    fun fmtDur(ms: Long): String {
        val totalMin = ms / 60000
        val h = totalMin / 60; val m = totalMin % 60
        return if (h > 0) "$h 小时 $m 分钟" else "$m 分钟"
    }
    fun fmtDate(ts: Long): String = if (ts > 0) java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.getDefault()).format(java.util.Date(ts)) else "—"
    Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(horizontal = 18.dp)) {
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            CircleIconButton(Icons.AutoMirrored.Rounded.ArrowBack, L("返回", "Back"), onClick = onBack)
            Spacer(Modifier.width(12.dp))
            Text(L("数据统计", "Statistics"), fontSize = 20.sp, fontWeight = FontWeight.Bold, color = TextPrimary, modifier = Modifier.weight(1f))
            if (stats.hasData) TextButton(onClick = { repository.clearStats(); onBack() }) { Text(L("清除", "Clear"), color = DangerRed, fontSize = 13.sp) }
        }
        Spacer(Modifier.height(12.dp))
        if (!stats.hasData) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(L("还没有足够的数据可以统计哦~", "Not enough data to show statistics yet~"), color = TextPrimary.copy(alpha = 0.5f))
            }
            return@Column
        }
        LazyColumn(verticalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.weight(1f)) {
            item {
                SectionCard {
                    Text(L("累计联机时长", "Total Online Time"), fontSize = 12.sp, color = TextPrimary.copy(alpha = 0.6f))
                    Text(fmtDur(stats.totalOnlineMs), fontSize = 22.sp, fontWeight = FontWeight.Bold, color = GrassGreen)
                    Spacer(Modifier.height(12.dp))
                    Row {
                        StatCell(L("加入次数", "Joins"), "${stats.joinCount}", Modifier.weight(1f))
                        StatCell(L("作为房主", "As Host"), "${stats.hostCount}", Modifier.weight(1f))
                        StatCell(L("作为成员", "As Member"), "${stats.memberCount}", Modifier.weight(1f))
                    }
                    Spacer(Modifier.height(10.dp))
                    Row {
                        StatCell(L("最长单次", "Longest"), fmtDur(stats.maxSessionMs), Modifier.weight(1f))
                        StatCell(L("平均单次", "Average"), fmtDur(stats.avgSessionMs), Modifier.weight(1f))
                    }
                    Spacer(Modifier.height(10.dp))
                    Row {
                        StatCell(L("伙伴总数", "Partners"), "${stats.uniquePartners}", Modifier.weight(1f))
                        StatCell(L("已用天数", "Days Used"), "${stats.usedDays}", Modifier.weight(1f))
                    }
                }
            }
            item {
                SectionCard {
                    Text(L("活跃时段", "Active Periods"), fontWeight = FontWeight.Bold, color = TextPrimary)
                    Spacer(Modifier.height(10.dp))
                    val maxB = (stats.buckets.maxOrNull() ?: 1).coerceAtLeast(1)
                    Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth().height(130.dp)) {
                        val labels = listOf(L("凌晨", "Night"), L("上午", "Morning"), L("下午", "Noon"), L("晚上", "Evening"))
                        stats.buckets.forEachIndexed { i, v ->
                            Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Bottom) {
                                Text("$v", fontSize = 11.sp, color = TextPrimary.copy(alpha = 0.5f))
                                Spacer(Modifier.height(2.dp))
                                Box(Modifier.fillMaxWidth(0.55f).height((64 * v / maxB).dp.coerceAtLeast(4.dp)).clip(RoundedCornerShape(6.dp, 6.dp, 0.dp, 0.dp)).background(if (i == stats.mostActiveBucket) GrassGreen else Color(0xFF1668DC)))
                                Spacer(Modifier.height(5.dp))
                                Text(labels[i], fontSize = 11.sp, maxLines = 1, color = if (i == stats.mostActiveBucket) GrassGreen else TextPrimary.copy(alpha = 0.6f))
                            }
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    Text(L("首次使用：", "First use: ") + fmtDate(stats.firstUseTs) + "    " + L("最近联机：", "Last online: ") + fmtDate(stats.lastOnlineTs), fontSize = 12.sp, color = TextPrimary.copy(alpha = 0.55f))
                }
            }
            item {
                SectionCard {
                    Text(L("常玩伙伴排行", "Top Partners"), fontWeight = FontWeight.Bold, color = TextPrimary)
                    Spacer(Modifier.height(8.dp))
                    if (stats.partners.isEmpty()) Text(L("还没有一起玩过的伙伴", "No partners yet"), fontSize = 12.sp, color = TextPrimary.copy(alpha = 0.45f))
                    else stats.partners.take(10).forEachIndexed { idx, p ->
                        Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(20.dp).clip(CircleShape).background(GrassGreen), contentAlignment = Alignment.Center) {
                                Text("${idx + 1}", fontSize = 11.sp, color = Color(0xFFFFFFFF), fontWeight = FontWeight.Bold)
                            }
                            Spacer(Modifier.width(10.dp))
                            Text(p.name, color = TextPrimary, modifier = Modifier.weight(1f))
                            Text("${p.count} 次", fontSize = 12.sp, color = TextPrimary.copy(alpha = 0.5f))
                        }
                    }
                }
            }
            item {
                val sessions = remember { repository.getSessions() }
                SectionCard {
                    Text(L("开黑记录", "Session History"), fontWeight = FontWeight.Bold, color = TextPrimary)
                    Spacer(Modifier.height(8.dp))
                    if (sessions.isEmpty()) {
                        Text(L("暂无开黑记录", "No sessions yet"), fontSize = 12.sp, color = TextPrimary.copy(alpha = 0.45f))
                    } else {
                        sessions.take(12).forEach { s ->
                            Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(fmtDate(s.start), color = TextPrimary, fontSize = 13.sp)
                                    Text(if (s.isHost) L("房主", "Host") else L("成员", "Member"), fontSize = 11.sp, color = TextPrimary.copy(alpha = 0.5f))
                                }
                                Text(fmtDur(s.durationMs), fontSize = 13.sp, color = GrassGreen, fontWeight = FontWeight.SemiBold)
                            }
                        }
                    }
                }
            }
            item { Spacer(Modifier.height(20.dp)) }
        }
    }
}

@Composable
private fun StatCell(label: String, value: String, modifier: Modifier = Modifier) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, fontSize = 15.sp, fontWeight = FontWeight.Bold, color = TextPrimary)
        Text(label, fontSize = 11.sp, color = TextPrimary.copy(alpha = 0.55f))
    }
}

@Composable
private fun AboutScreen(onBack: () -> Unit) {
    val ctx = LocalContext.current
    var showSponsor by remember { mutableStateOf(false) }
    var enlargedSponsor by remember { mutableStateOf<Int?>(null) }
    fun open(url: String) { runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } }
    Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(horizontal = 18.dp)) {
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            CircleIconButton(Icons.AutoMirrored.Rounded.ArrowBack, L("返回", "Back"), onClick = onBack)
            Spacer(Modifier.width(12.dp))
            Text(L("关于软件", "About"), fontSize = 20.sp, fontWeight = FontWeight.Bold, color = TextPrimary)
        }
        Spacer(Modifier.height(12.dp))
        LazyColumn(verticalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.weight(1f)) {
            item {
                SectionCard {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Image(painterResource(R.drawable.mctier_logo), "MCTier", modifier = Modifier.size(52.dp).clip(RoundedCornerShape(14.dp)))
                        Spacer(Modifier.width(14.dp))
                        Column(Modifier.weight(1f)) {
                            Text("MCTier", fontWeight = FontWeight.Bold, color = TextPrimary, fontSize = 20.sp)
                            Text(L("版本 v$AppClientVersion · Android", "Version v$AppClientVersion · Android"), fontSize = 12.sp, color = TextPrimary.copy(alpha = 0.55f))
                            Text(L("虚拟局域网通用联机工具", "Universal virtual LAN networking tool"), fontSize = 12.sp, color = GrassGreen)
                        }
                    }
                }
            }
            item {
                SectionCard {
                    Text(L("软件简介", "About"), fontWeight = FontWeight.Bold, color = TextPrimary)
                    Spacer(Modifier.height(8.dp))
                    Text(L("MCTier 基于 EasyTier 虚拟组网，让你和好友像在同一局域网内一样联机 Minecraft，支持语音、聊天、文件共享与屏幕共享，并与电脑端完全互通。", "MCTier uses EasyTier virtual networking so you and your friends can play Minecraft as if on the same LAN, with voice, chat, file and screen sharing, fully interoperable with the desktop client."), fontSize = 13.sp, color = TextPrimary.copy(alpha = 0.8f), lineHeight = 20.sp)
                }
            }
            item {
                SectionCard {
                    Text(L("开发者：青云制作_彭明航", "Developer: Qingyun_PengMinghang"), fontWeight = FontWeight.Bold, color = TextPrimary)
                    Spacer(Modifier.height(12.dp))
                    AboutLinkLogoRow(L("MCTier 官网", "MCTier Website"), "mctier.pmhs.top", R.drawable.mctier_logo) { open("https://mctier.pmhs.top") }
                    Spacer(Modifier.height(8.dp))
                    AboutLinkVectorRow(L("GitHub 开源仓库", "GitHub Repository"), "github.com/pmh1314520/MCTier", R.drawable.ic_github) { open("https://github.com/pmh1314520/MCTier") }
                    Spacer(Modifier.height(8.dp))
                    AboutLinkVectorRow(L("Gitee 开源仓库", "Gitee Repository"), "gitee.com/peng-minghang/mctier", R.drawable.ic_gitee) { open("https://gitee.com/peng-minghang/mctier") }
                }
            }
            item {
                SectionCard {
                    Text(L("支持开发者", "Support the developer"), fontWeight = FontWeight.Bold, color = TextPrimary)
                    Spacer(Modifier.height(8.dp))
                    Text(L("如果 MCTier 对你有帮助，欢迎赞助支持作者持续开发", "If MCTier helps you, please consider sponsoring continued development"), fontSize = 13.sp, color = TextPrimary.copy(alpha = 0.8f))
                    Spacer(Modifier.height(12.dp))
                    PrimaryButton(L("赞助支持", "Sponsor")) { showSponsor = true }
                }
            }
            item { Spacer(Modifier.height(20.dp)) }
        }
    }
    if (showSponsor) {
        AlertDialog(
            onDismissRequest = { showSponsor = false },
            containerColor = Panel,
            title = { Text(L("赞助支持开发者", "Sponsor the developer"), color = TextPrimary, fontWeight = FontWeight.Bold) },
            text = {
                Column {
                    Text(L("点击二维码可放大查看", "Tap the QR code to enlarge"), fontSize = 12.sp, color = TextPrimary.copy(alpha = 0.6f))
                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        SponsorQr(
                            res = R.drawable.sponsor_alipay,
                            label = L("支付宝", "Alipay"),
                            modifier = Modifier.weight(1f),
                            onClick = { enlargedSponsor = R.drawable.sponsor_alipay },
                        )
                        SponsorQr(
                            res = R.drawable.sponsor_wechat,
                            label = L("微信", "WeChat"),
                            modifier = Modifier.weight(1f),
                            onClick = { enlargedSponsor = R.drawable.sponsor_wechat },
                        )
                    }
                }
            },
            confirmButton = { TextButton(onClick = { showSponsor = false }) { Text(L("关闭", "Close"), color = GrassGreen) } },
        )
    }
    enlargedSponsor?.let { res ->
        Dialog(onDismissRequest = { enlargedSponsor = null }) {
            Box(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp))
                    .clickable { enlargedSponsor = null },
                contentAlignment = Alignment.Center,
            ) {
                Image(
                    painterResource(res),
                    null,
                    modifier = Modifier.fillMaxWidth().aspectRatio(1f),
                    contentScale = ContentScale.Fit,
                )
            }
        }
    }
}

@Composable
private fun AboutLinkVectorRow(title: String, sub: String, drawableRes: Int, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(PanelHigh).clickable(onClick = onClick).padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Image(painterResource(drawableRes), null, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(title, color = TextPrimary, fontSize = 14.sp)
            Text(sub, color = TextPrimary.copy(alpha = 0.45f), fontSize = 11.sp)
        }
        Text(L("打开", "Open"), color = GrassGreen, fontSize = 13.sp)
    }
}

// 官网行：左侧使用 MCTier Logo
@Composable
private fun AboutLinkLogoRow(title: String, sub: String, drawableRes: Int, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(PanelHigh).clickable(onClick = onClick).padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Image(painterResource(drawableRes), null, modifier = Modifier.size(22.dp).clip(RoundedCornerShape(6.dp)))
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(title, color = TextPrimary, fontSize = 14.sp)
            Text(sub, color = TextPrimary.copy(alpha = 0.45f), fontSize = 11.sp)
        }
        Text(L("打开", "Open"), color = GrassGreen, fontSize = 13.sp)
    }
}

// 赞助二维码：统一为正方形，保证两个模块对称美观，点击可放大
@Composable
private fun SponsorQr(res: Int, label: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(10.dp))
                .clickable(onClick = onClick),
            contentAlignment = Alignment.Center,
        ) {
            Image(
                painterResource(res),
                label,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Fit,
            )
        }
        Spacer(Modifier.height(6.dp))
        Text(label, fontSize = 12.sp, color = TextPrimary.copy(alpha = 0.7f))
    }
}
@Composable
private fun HomeActionButton(label: String, icon: ImageVector, modifier: Modifier = Modifier, tint: Color = GrassGreen, onClick: () -> Unit) {
    Column(
        modifier = modifier.clip(RoundedCornerShape(14.dp)).background(PanelHigh).clickable(onClick = onClick)
            .padding(vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(icon, label, tint = tint, modifier = Modifier.size(22.dp))
        Spacer(Modifier.height(6.dp))
        Text(label, fontSize = 12.sp, color = TextPrimary.copy(alpha = 0.85f))
    }
}

// 随机大厅名称：与桌面端一致（形容词+的+名词+0~999）
private val LOBBY_ADJ = listOf(
    "快乐", "欢乐", "神秘", "梦幻", "传奇", "史诗", "超级", "极限",
    "无敌", "王者", "至尊", "荣耀", "辉煌", "璀璨", "闪耀", "炫酷",
    "疯狂", "狂野", "激情", "热血", "勇敢", "无畏", "坚韧", "强大",
    "幸运", "吉祥", "福星", "瑞雪", "春风", "夏日", "秋月", "冬雪",
)
private val LOBBY_NOUN = listOf(
    "冒险", "探险", "旅程", "征途", "远征", "奇遇", "传说", "神话",
    "世界", "王国", "帝国", "领域", "天堂", "乐园", "家园", "基地",
    "联盟", "公会", "战队", "军团", "部落", "氏族", "家族", "团队",
    "小队", "组织", "势力", "阵营", "派系", "集团", "协会", "社团",
)
private val LOBBY_ADJ_EN = listOf(
    "Happy", "Joyful", "Mystic", "Dreamy", "Legendary", "Epic", "Super", "Extreme",
    "Invincible", "Royal", "Supreme", "Glorious", "Brilliant", "Shining", "Radiant", "Cool",
    "Crazy", "Wild", "Passionate", "Fiery", "Brave", "Fearless", "Tough", "Mighty",
    "Lucky", "Auspicious", "Stellar", "Snowy", "Spring", "Summer", "Autumn", "Winter",
)
private val LOBBY_NOUN_EN = listOf(
    "Adventure", "Expedition", "Journey", "Quest", "Voyage", "Odyssey", "Legend", "Myth",
    "World", "Kingdom", "Empire", "Realm", "Paradise", "Haven", "Homeland", "Base",
    "Alliance", "Guild", "Squad", "Legion", "Tribe", "Clan", "Family", "Team",
    "Crew", "Order", "Faction", "Camp", "Party", "Group", "Society", "Club",
)
private fun randomLobbyName(): String =
    if (appLang == "en") "${LOBBY_ADJ_EN.random()}${LOBBY_NOUN_EN.random()}${(0..999).random()}"
    else "${LOBBY_ADJ.random()}的${LOBBY_NOUN.random()}${(0..999).random()}"

// 内置节点名英文显示映射（数据层保持中文标识，仅渲染时翻译）
private fun nodeDisplayName(name: String): String = if (appLang == "en") when (name) {
    "MCTier 官方服务器" -> "MCTier Official Server"
    "海波节点" -> "Haibo Node"
    "唯爱节点" -> "Weiai Node"
    "明月清风节点" -> "Mingyue Qingfeng Node"
    else -> name
} else name

// 校验规则与桌面端完全一致
private fun isValidLobbyName(n: String): Boolean {
    val t = n.trim()
    if (t.length < 4 || t.length > 32) return false
    val hasAlnum = t.any { it in 'a'..'z' || it in 'A'..'Z' || it in '0'..'9' || it in '\u4e00'..'\u9fa5' }
    if (!hasAlnum) return false
    return t.all { it in 'a'..'z' || it in 'A'..'Z' || it in '0'..'9' || it == '_' || it == '-' || it == ' ' || it in '\u4e00'..'\u9fa5' }
}

private fun isValidLobbyPassword(p: String): Boolean {
    val t = p.trim()
    if (t.length < 8 || t.length > 32) return false
    val hasLetter = t.any { it in 'a'..'z' || it in 'A'..'Z' }
    val hasDigit = t.any { it in '0'..'9' }
    return hasLetter && hasDigit
}

// 随机密码：与桌面端一致（12位，含大小写字母和数字，至少各一个）
private fun randomPassword(): String {
    val lowercase = "abcdefghijklmnopqrstuvwxyz"
    val uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    val digits = "0123456789"
    val all = lowercase + uppercase + digits
    val sb = StringBuilder()
    sb.append(lowercase.random())
    sb.append(uppercase.random())
    sb.append(digits.random())
    repeat(9) { sb.append(all.random()) }
    return sb.toString().toList().shuffled().joinToString("")
}

@Composable
private fun NodeSelector(state: MctierUiState, repository: MctierRepository, enabled: Boolean) {
    val all = BuiltinNodes.map { it.name to it.address } + state.customNodes.map { it.name to it.address }
    val current = state.settings.preferredServer
    val currentName = all.firstOrNull { it.second == current }?.first?.let { nodeDisplayName(it) } ?: L("自定义节点", "Custom node")
    var expanded by remember { mutableStateOf(false) }
    Box {
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(PanelHigh)
                .clickable(enabled = enabled) { expanded = true }
                .padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(L("服务器节点", "Server node"), fontSize = 11.sp, color = TextPrimary.copy(alpha = 0.5f))
                Text(currentName, color = TextPrimary, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Icon(Icons.Rounded.ArrowDropDown, L("选择节点", "Select node"), tint = TextPrimary.copy(alpha = 0.7f))
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            all.forEach { (name, addr) ->
                DropdownMenuItem(
                    text = {
                        Column {
                            Text(nodeDisplayName(name), color = if (addr == current) GrassGreen else TextPrimary)
                            Text(addr, fontSize = 11.sp, color = TextPrimary.copy(alpha = 0.45f))
                        }
                    },
                    onClick = {
                        repository.updateSettings(state.settings.copy(preferredServer = addr))
                        expanded = false
                    },
                )
            }
        }
    }
}

@Composable
private fun CircleIconButton(icon: ImageVector, desc: String, modifier: Modifier = Modifier, tint: Color = TextPrimary.copy(alpha = 0.85f), onClick: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.84f else 1f, label = "circleScale")
    Box(
        modifier.size(42.dp).graphicsLayer { scaleX = scale; scaleY = scale }
            .clip(CircleShape).background(PanelHigh)
            .clickable(interactionSource = interaction, indication = null, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, desc, tint = tint, modifier = Modifier.size(20.dp)) }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FlowRowChips(items: List<String>, big: Boolean = false, selectedLabel: String? = null, onClick: (String) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        items.forEach { item ->
            val selected = selectedLabel != null && item == selectedLabel
            Box(
                Modifier.clip(RoundedCornerShape(10.dp))
                    .background(if (selected) GrassGreen else PanelHigh)
                    .clickable { onClick(item) }
                    .padding(horizontal = if (big) 10.dp else 12.dp, vertical = if (big) 6.dp else 8.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    item,
                    fontSize = if (big) 20.sp else 13.sp,
                    color = TextPrimary,
                    fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                )
            }
        }
    }
}

@Composable
private fun ToggleChip(text: String, active: Boolean, icon: ImageVector, modifier: Modifier = Modifier, onClick: () -> Unit) {    Row(
        modifier = modifier.clip(RoundedCornerShape(12.dp)).background(if (active) GrassGreen.copy(alpha = 0.18f) else PanelHigh)
            .border(1.dp, if (active) GrassGreen.copy(alpha = 0.5f) else Color.Transparent, RoundedCornerShape(12.dp))
            .clickable(onClick = onClick).padding(horizontal = 10.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center,
    ) {
        Icon(icon, null, tint = if (active) GrassGreen else TextPrimary.copy(alpha = 0.6f), modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(6.dp))
        Text(text, fontSize = 13.sp, color = if (active) GrassGreen else TextPrimary.copy(alpha = 0.7f), maxLines = 1)
    }
}

@Composable
private fun HostActionChip(text: String, icon: ImageVector, danger: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val tint = if (danger) DangerRed else DirtBrown
    Row(
        modifier = modifier.clip(RoundedCornerShape(10.dp)).background(tint.copy(alpha = 0.16f)).clickable(onClick = onClick).padding(vertical = 8.dp),
        horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = tint, modifier = Modifier.size(15.dp))
        Spacer(Modifier.width(4.dp))
        Text(text, fontSize = 11.sp, color = tint, maxLines = 1)
    }
}

@Composable
private fun fieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = GrassGreen,
    unfocusedBorderColor = Hairline,
    focusedLabelColor = GrassGreen,
    unfocusedLabelColor = TextPrimary.copy(alpha = 0.5f),
    focusedTextColor = TextPrimary,
    unfocusedTextColor = TextPrimary,
    focusedPlaceholderColor = TextPrimary.copy(alpha = 0.4f),
    unfocusedPlaceholderColor = TextPrimary.copy(alpha = 0.4f),
    cursorColor = GrassGreen,
    focusedContainerColor = PanelHigh.copy(alpha = 0.4f),
    unfocusedContainerColor = PanelHigh.copy(alpha = 0.25f),
)

@Composable
private fun switchColors() = SwitchDefaults.colors(
    checkedThumbColor = TextPrimary,
    checkedTrackColor = GrassGreen,
    uncheckedThumbColor = TextPrimary.copy(alpha = 0.85f),
    uncheckedTrackColor = PanelHigh,
    uncheckedBorderColor = Color.Transparent,
)
