package top.pmh13.mctier.ui

import android.content.ContentValues
import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.provider.Settings
import android.util.Base64
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.view.animation.LinearInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import java.io.File

/**
 * 安卓系统级弹幕覆盖层。
 * 使用 SYSTEM_ALERT_WINDOW 悬浮窗在所有应用之上显示从右向左飘过的聊天弹幕。
 *
 * 交互：
 * - 点击飘动的弹幕 → 暂停定在原地，并在其下方弹出操作按钮（文本=复制内容，图片=下载图片）；
 * - 点击空白处 → 取消定住，弹幕继续飘动；
 * - 支持图片消息弹幕（缩略图），点击后可一键下载原图到相册。
 *
 * 穿透策略：覆盖层只占据屏幕顶部弹幕区域（含按钮空间）。无弹幕时整窗设为不可触摸（完全穿透，
 * 不影响游戏）；有弹幕飘动时该顶部条可点击；点击条以外区域（含下方游戏区）的触摸照常传给后面的应用。
 */
object DanmakuOverlay {
    @Volatile var enabled = false
    var fontSizeSp = 20f
    var speedDp = 130f
    var alphaValue = 0.9f
    var tracks = 4
    var colorValue = Color.WHITE
    var rainbow = false

    private var wm: WindowManager? = null
    private var container: DanmakuContainer? = null
    private var appCtx: Context? = null
    private val trackFreeAt = LongArray(16)

    // 当前被定住的弹幕视图（点击暂停）及其操作按钮
    private var pinnedView: View? = null
    private var actionView: View? = null
    // 当前窗口是否可触摸（无弹幕时不可触摸=完全穿透）
    private var touchable = false

    fun hasPermission(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(ctx)

    /** 应用配置；若启用且有权限则确保覆盖层已显示，否则移除 */
    fun applyConfig(ctx: Context, enabled: Boolean, fontSizeSp: Float, speedDp: Float, alpha: Float, tracks: Int, colorInt: Int = Color.WHITE, rainbow: Boolean = false) {
        this.enabled = enabled
        this.fontSizeSp = fontSizeSp
        this.speedDp = speedDp
        this.alphaValue = alpha
        this.tracks = tracks.coerceIn(1, 12)
        this.colorValue = colorInt
        this.rainbow = rainbow
        if (enabled && hasPermission(ctx)) {
            show(ctx)
            updateWindowMetrics()
        } else if (!enabled) {
            hide()
        }
    }

    /** 生成明亮鲜艳的随机颜色（彩色模式：每条弹幕颜色不同） */
    private fun randomBrightColor(): Int {
        val hsv = floatArrayOf((Math.random() * 360).toFloat(), 0.85f, 0.98f)
        return Color.HSVToColor(hsv)
    }

    private fun density(): Float = (appCtx ?: container?.context)?.resources?.displayMetrics?.density ?: 2.5f

    /** 顶部安全间距：状态栏高度 + 额外留白，避免最顶部弹幕被系统状态栏遮挡而点不到 */
    private fun topInsetPx(): Int {
        val d = density()
        val ctx = appCtx ?: container?.context ?: return (40 * d).toInt()
        val resId = ctx.resources.getIdentifier("status_bar_height", "dimen", "android")
        val sb = if (resId > 0) ctx.resources.getDimensionPixelSize(resId) else (26 * d).toInt()
        return sb + (12 * d).toInt()
    }

    /** 弹幕顶部条高度（含轨道与按钮空间），单位 px */
    private fun stripHeightPx(): Int {
        val d = density()
        val lineH = fontSizeSp * 1.95f * d
        return (topInsetPx() + tracks.coerceIn(1, 12) * lineH + 64f * d).toInt()
    }

    private fun baseFlags(): Int =
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
            WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH or
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL

    private fun overlayType(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else
            @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE

    fun show(ctx: Context) {
        if (!hasPermission(ctx)) return
        appCtx = ctx.applicationContext
        if (container != null) return
        val manager = appCtx!!.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val fl = DanmakuContainer(appCtx!!)
        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            stripHeightPx(),
            overlayType(),
            // 初始无弹幕：不可触摸=完全穿透
            baseFlags() or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
            PixelFormat.TRANSLUCENT,
        )
        lp.gravity = Gravity.TOP or Gravity.START
        runCatching { manager.addView(fl, lp) }
        wm = manager
        container = fl
        touchable = false
    }

    fun hide() {
        dismissPinned(resume = false)
        val c = container
        val m = wm
        if (c != null && m != null) runCatching { m.removeView(c) }
        container = null
        wm = null
        touchable = false
    }

    /** 更新窗口尺寸（轨道/字号变化或旋转后调用） */
    private fun updateWindowMetrics() {
        val c = container ?: return
        val m = wm ?: return
        val lp = c.layoutParams as? WindowManager.LayoutParams ?: return
        lp.height = stripHeightPx()
        runCatching { m.updateViewLayout(c, lp) }
    }

    /** 切换窗口是否可触摸：无弹幕时不可触摸（完全穿透），有弹幕/定住时可触摸 */
    private fun setTouchable(value: Boolean) {
        if (touchable == value) return
        val c = container ?: return
        val m = wm ?: return
        val lp = c.layoutParams as? WindowManager.LayoutParams ?: return
        lp.flags = if (value) baseFlags() else (baseFlags() or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE)
        runCatching { m.updateViewLayout(c, lp) }
        touchable = value
    }

    /** 屏幕上是否还有正在飘动/定住的弹幕；据此决定是否保持可触摸 */
    private fun refreshTouchable() {
        val c = container ?: return
        val hasBullets = (0 until c.childCount).any { c.getChildAt(it) is BulletView }
        setTouchable(hasBullets || pinnedView != null)
    }

    /** 推送一条文本弹幕。copyText 为点击后可复制的原始消息内容 */
    fun push(text: String, color: Int = colorValue, copyText: String? = null) {
        if (!enabled || text.isBlank()) return
        val c = container ?: return
        val ctx = appCtx ?: return
        val finalColor = if (rainbow) randomBrightColor() else color
        c.post {
            val tv = TextView(ctx).apply {
                this.text = text
                setTextColor(finalColor)
                textSize = fontSizeSp
                maxLines = 1
                setShadowLayer(6f, 0f, 1f, Color.argb(220, 0, 0, 0))
                setTypeface(typeface, android.graphics.Typeface.BOLD)
            }
            tv.measure(View.MeasureSpec.UNSPECIFIED, View.MeasureSpec.UNSPECIFIED)
            launchBullet(BulletView(ctx, tv, isImage = false, copyText = copyText, imageData = null), tv.measuredWidth.coerceAtLeast(1))
        }
    }

    /** 推送一条图片弹幕。dataUrl 为 data:image/...;base64,xxx */
    fun pushImage(label: String, dataUrl: String, color: Int = colorValue) {
        if (!enabled) return
        val c = container ?: return
        val ctx = appCtx ?: return
        val finalColor = if (rainbow) randomBrightColor() else color
        c.post {
            val bytes = decodeDataUrl(dataUrl)
            if (bytes == null) { push(label, finalColor, null); return@post }
            val bmp = runCatching { BitmapFactory.decodeByteArray(bytes, 0, bytes.size) }.getOrNull()
            if (bmp == null) { push(label, finalColor, null); return@post }
            val d = density()
            // 缩略图大小适中：高度贴合轨道行高，宽度按比例但限制最大值，既能看清又不过度遮挡
            val targetH = (fontSizeSp * 1.55f * d).toInt().coerceIn((26 * d).toInt(), (54 * d).toInt())
            val ratio = bmp.width.toFloat() / bmp.height.toFloat().coerceAtLeast(1f)
            val maxW = (fontSizeSp * 3.6f * d).toInt()
            val targetW = (targetH * ratio).toInt().coerceIn((targetH * 0.4f).toInt(), maxW)
            // 名字 + 缩略图 横向排布，让用户知道是谁发的图
            val row = android.widget.LinearLayout(ctx).apply {
                orientation = android.widget.LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
            }
            val nameTv = TextView(ctx).apply {
                text = label
                setTextColor(finalColor)
                textSize = fontSizeSp
                maxLines = 1
                setShadowLayer(6f, 0f, 1f, Color.argb(220, 0, 0, 0))
                setTypeface(typeface, android.graphics.Typeface.BOLD)
            }
            val iv = ImageView(ctx).apply {
                setImageBitmap(bmp)
                scaleType = ImageView.ScaleType.FIT_CENTER
            }
            row.addView(nameTv, android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT,
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT,
            ))
            row.addView(iv, android.widget.LinearLayout.LayoutParams(targetW, targetH).apply {
                leftMargin = (6 * d).toInt()
            })
            row.measure(View.MeasureSpec.UNSPECIFIED, View.MeasureSpec.UNSPECIFIED)
            val totalW = row.measuredWidth.coerceAtLeast(targetW)
            launchBullet(BulletView(ctx, row, isImage = true, copyText = null, imageData = dataUrl), totalW)
        }
    }

    /** 把一条弹幕加入容器并启动从右到左的动画 */
    private fun launchBullet(bullet: BulletView, contentWidth: Int) {
        val c = container ?: return
        val ctx = appCtx ?: return
        val d = density()
        val sw = ctx.resources.displayMetrics.widthPixels
        bullet.alpha = alphaValue
        val lineH = fontSizeSp * 1.95f * d
        val now = System.currentTimeMillis()
        val nTracks = tracks.coerceIn(1, 12)
        var track = 0
        var earliest = Long.MAX_VALUE
        for (i in 0 until nTracks) {
            if (trackFreeAt[i] <= now) { track = i; break }
            if (trackFreeAt[i] < earliest) { earliest = trackFreeAt[i]; track = i }
        }
        val speedPx = (speedDp * d).coerceAtLeast(40f)
        val tw = contentWidth.coerceAtLeast(1)
        val distance = sw + tw
        val dur = (distance / speedPx * 1000f).toLong().coerceIn(2000L, 20000L)
        val releaseDelay = ((tw + 40) / speedPx * 1000f).toLong()
        trackFreeAt[track] = now + releaseDelay
        val topPx = (topInsetPx() + track * lineH).toInt()
        val lp = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
        ).apply { topMargin = topPx; leftMargin = 0 }
        c.addView(bullet, lp)
        bullet.translationX = sw.toFloat()
        val anim = android.animation.ObjectAnimator.ofFloat(bullet, "translationX", sw.toFloat(), -tw.toFloat())
        anim.duration = dur
        anim.interpolator = LinearInterpolator()
        anim.addListener(object : android.animation.AnimatorListenerAdapter() {
            override fun onAnimationEnd(animation: android.animation.Animator) {
                if (pinnedView === bullet) return
                runCatching { c.removeView(bullet) }
                refreshTouchable()
            }
        })
        bullet.animator = anim
        bullet.setOnClickListener { pinBullet(bullet) }
        anim.start()
        setTouchable(true)
    }

    /** 定住一条弹幕：暂停动画并在下方弹出操作按钮 */
    private fun pinBullet(bullet: BulletView) {
        val c = container ?: return
        // 先取消之前定住的
        if (pinnedView != null && pinnedView !== bullet) dismissPinned(resume = true)
        bullet.animator?.pause()
        pinnedView = bullet
        bullet.bringToFront()
        setTouchable(true)

        val ctx = c.context
        val d = density()
        val btnLabel = if (bullet.isImage) L("下载图片", "Download") else L("复制内容", "Copy")
        val btn = makeActionButton(ctx, btnLabel) {
            if (bullet.isImage) downloadImage(bullet.imageData) else copyText(bullet.copyText ?: "")
            dismissPinned(resume = true)
        }
        // 放在弹幕正下方
        val top = (bullet.layoutParams as? FrameLayout.LayoutParams)?.topMargin ?: 0
        val left = bullet.translationX.toInt().coerceAtLeast(0)
        val lp = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
        ).apply {
            topMargin = top + bullet.height + (6 * d).toInt()
            leftMargin = left
        }
        c.addView(btn, lp)
        btn.bringToFront()
        actionView = btn
    }

    /** 取消定住：移除按钮，可选恢复动画 */
    private fun dismissPinned(resume: Boolean) {
        val c = container
        val av = actionView
        if (c != null && av != null) runCatching { c.removeView(av) }
        actionView = null
        val pv = pinnedView as? BulletView
        pinnedView = null
        if (pv != null) {
            if (resume) {
                runCatching { pv.animator?.resume() }
            } else {
                runCatching { pv.animator?.cancel() }
                if (c != null) runCatching { c.removeView(pv) }
            }
        }
        refreshTouchable()
    }

    /** 构造一个圆角操作按钮 */
    private fun makeActionButton(ctx: Context, label: String, onClick: () -> Unit): View {
        val d = density()
        return TextView(ctx).apply {
            text = label
            setTextColor(Color.WHITE)
            textSize = 13f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            val padH = (14 * d).toInt()
            val padV = (8 * d).toInt()
            setPadding(padH, padV, padH, padV)
            background = android.graphics.drawable.GradientDrawable().apply {
                cornerRadius = 10 * d
                setColor(Color.parseColor("#7CCF00"))
            }
            isClickable = true
            setOnClickListener { onClick() }
        }
    }

    /** 复制文本到剪贴板 */
    private fun copyText(text: String) {
        val ctx = appCtx ?: return
        runCatching {
            val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
            cm.setPrimaryClip(android.content.ClipData.newPlainText("MCTier", text))
            toast(L("已复制消息内容", "Message content copied"))
        }
    }

    /** 下载图片到相册 */
    private fun downloadImage(dataUrl: String?) {
        val ctx = appCtx ?: return
        val bytes = dataUrl?.let { decodeDataUrl(it) }
        if (bytes == null) { toast(L("图片下载失败", "Image download failed")); return }
        val ok = saveImageToGallery(ctx, bytes)
        toast(if (ok) L("图片已保存到相册", "Image saved to gallery") else L("图片下载失败", "Image download failed"))
    }

    private fun toast(msg: String) {
        val ctx = appCtx ?: return
        runCatching { Toast.makeText(ctx, msg, Toast.LENGTH_SHORT).show() }
    }

    /** 解析 data URL 为字节数组 */
    private fun decodeDataUrl(dataUrl: String): ByteArray? {
        val idx = dataUrl.indexOf(',')
        val b64 = if (idx >= 0) dataUrl.substring(idx + 1) else dataUrl
        return runCatching { Base64.decode(b64, Base64.DEFAULT) }.getOrNull()
    }

    /** 保存图片字节到相册（Pictures/MCTier） */
    private fun saveImageToGallery(ctx: Context, bytes: ByteArray): Boolean {
        val name = "MCTier_弹幕图片_${System.currentTimeMillis()}.jpg"
        return runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val values = ContentValues().apply {
                    put(MediaStore.Images.Media.DISPLAY_NAME, name)
                    put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
                    put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/MCTier")
                }
                val uri = ctx.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
                    ?: return false
                ctx.contentResolver.openOutputStream(uri)?.use { it.write(bytes) } ?: return false
                true
            } else {
                @Suppress("DEPRECATION")
                val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "MCTier")
                dir.mkdirs()
                val f = File(dir, name)
                f.writeBytes(bytes)
                runCatching {
                    android.media.MediaScannerConnection.scanFile(ctx, arrayOf(f.absolutePath), arrayOf("image/jpeg"), null)
                }
                true
            }
        }.getOrDefault(false)
    }

    /** 跳转到系统悬浮窗授权页 */
    fun requestPermissionIntent(ctx: Context): android.content.Intent =
        android.content.Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            android.net.Uri.parse("package:${ctx.packageName}"),
        )

    /** 弹幕视图：包裹文本/图片内容，持有动画与元数据 */
    private class BulletView(
        ctx: Context,
        content: View,
        val isImage: Boolean,
        val copyText: String?,
        val imageData: String?,
    ) : FrameLayout(ctx) {
        var animator: android.animation.ObjectAnimator? = null
        init {
            isClickable = true
            addView(
                content,
                LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT),
            )
        }
    }

    /** 覆盖层容器：处理空白/窗口外点击以取消定住 */
    private class DanmakuContainer(ctx: Context) : FrameLayout(ctx) {
        override fun onTouchEvent(ev: MotionEvent): Boolean {
            when (ev.actionMasked) {
                MotionEvent.ACTION_OUTSIDE -> {
                    if (pinnedView != null) dismissPinned(resume = true)
                    return false
                }
                MotionEvent.ACTION_DOWN -> {
                    if (pinnedView != null) { dismissPinned(resume = true); return true }
                    return false
                }
            }
            return false
        }
    }
}
