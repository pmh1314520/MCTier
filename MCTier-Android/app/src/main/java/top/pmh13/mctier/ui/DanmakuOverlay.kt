package top.pmh13.mctier.ui

import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.animation.LinearInterpolator
import android.widget.FrameLayout
import android.widget.TextView

/**
 * 安卓系统级弹幕覆盖层。
 * 使用 SYSTEM_ALERT_WINDOW 悬浮窗在所有应用之上显示从右向左飘过的聊天弹幕，
 * 即使在玩游戏（其它 App 前台）时也能看到。鼠标/触摸完全穿透，不影响操作。
 *
 * 横竖屏自适应：覆盖层为全屏 MATCH_PARENT，随屏幕旋转；每条弹幕按当前屏幕宽度与
 * 轨道数实时计算飞行距离与位置，因此横屏/竖屏都从屏幕右侧合适位置飘入。
 */
object DanmakuOverlay {
    @Volatile var enabled = false
    var fontSizeSp = 20f
    var speedDp = 130f
    var alphaValue = 0.9f
    var tracks = 4

    private var wm: WindowManager? = null
    private var container: FrameLayout? = null
    private var appCtx: Context? = null
    private val trackFreeAt = LongArray(16)

    fun hasPermission(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(ctx)

    /** 应用配置；若启用且有权限则确保覆盖层已显示，否则移除 */
    fun applyConfig(ctx: Context, enabled: Boolean, fontSizeSp: Float, speedDp: Float, alpha: Float, tracks: Int) {
        this.enabled = enabled
        this.fontSizeSp = fontSizeSp
        this.speedDp = speedDp
        this.alphaValue = alpha
        this.tracks = tracks.coerceIn(1, 12)
        if (enabled && hasPermission(ctx)) show(ctx) else if (!enabled) hide()
    }

    fun show(ctx: Context) {
        if (!hasPermission(ctx)) return
        appCtx = ctx.applicationContext
        if (container != null) return
        val manager = appCtx!!.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val fl = FrameLayout(appCtx!!)
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else
            @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE
        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        )
        lp.gravity = Gravity.TOP or Gravity.START
        runCatching { manager.addView(fl, lp) }
        wm = manager
        container = fl
    }

    fun hide() {
        val c = container
        val m = wm
        if (c != null && m != null) runCatching { m.removeView(c) }
        container = null
        wm = null
    }

    /** 推送一条弹幕（在主线程执行） */
    fun push(text: String, color: Int = Color.WHITE) {
        if (!enabled || text.isBlank()) return
        val c = container ?: return
        val ctx = appCtx ?: return
        c.post {
            val density = ctx.resources.displayMetrics.density
            val sw = ctx.resources.displayMetrics.widthPixels
            val tv = TextView(ctx).apply {
                this.text = text
                setTextColor(color)
                textSize = fontSizeSp
                alpha = alphaValue
                maxLines = 1
                setShadowLayer(6f, 0f, 1f, Color.argb(220, 0, 0, 0))
                setTypeface(typeface, android.graphics.Typeface.BOLD)
            }
            tv.measure(View.MeasureSpec.UNSPECIFIED, View.MeasureSpec.UNSPECIFIED)
            val tw = tv.measuredWidth.coerceAtLeast(1)
            val lineH = (fontSizeSp * 1.7f * density)
            val now = System.currentTimeMillis()
            val nTracks = tracks.coerceIn(1, 12)
            var track = 0
            var earliest = Long.MAX_VALUE
            for (i in 0 until nTracks) {
                if (trackFreeAt[i] <= now) { track = i; break }
                if (trackFreeAt[i] < earliest) { earliest = trackFreeAt[i]; track = i }
            }
            val speedPx = (speedDp * density).coerceAtLeast(40f)
            val distance = sw + tw
            val dur = (distance / speedPx * 1000f).toLong().coerceIn(2000L, 20000L)
            val releaseDelay = ((tw + 40) / speedPx * 1000f).toLong()
            trackFreeAt[track] = now + releaseDelay
            val topPx = (12 * density + track * lineH).toInt()
            val lp = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = topPx; leftMargin = 0 }
            c.addView(tv, lp)
            tv.translationX = sw.toFloat()
            tv.animate()
                .translationX(-tw.toFloat())
                .setDuration(dur)
                .setInterpolator(LinearInterpolator())
                .withEndAction { runCatching { c.removeView(tv) } }
                .start()
        }
    }

    /** 跳转到系统悬浮窗授权页 */
    fun requestPermissionIntent(ctx: Context): android.content.Intent =
        android.content.Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            android.net.Uri.parse("package:${ctx.packageName}"),
        )
}
