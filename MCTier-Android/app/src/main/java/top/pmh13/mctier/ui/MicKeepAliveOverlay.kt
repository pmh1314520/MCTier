package top.pmh13.mctier.ui

import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.WindowManager

/**
 * 麦克风后台保活悬浮窗（用户无感）。
 *
 * 背景：Android 12+ 对“后台麦克风采集”有限制——App 切到后台后，如果前台没有任何可见窗口，
 * 系统会在数秒内切断 RECORD_AUDIO 的“使用中”授权，导致语音通话突然听不到/采不到声音。
 *
 * 方案：当 App 处于后台且正在语音大厅时，于所有界面之上叠加一个 1×1、近乎全透明、
 * 不可触摸、不抢焦点的系统悬浮窗。它让 App 进程始终拥有“可见窗口”，从而被系统视为
 * 前台可感知状态，使麦克风采集持续存活。窗口只有 1 像素且几乎完全透明，并且 FLAG_NOT_TOUCHABLE
 * 保证所有触摸照常穿透，用户完全无感（看不见、不挡操作）。回到前台或离开大厅时自动移除。
 *
 * 需要悬浮窗权限（SYSTEM_ALERT_WINDOW），与弹幕/HUD 共用同一授权。
 */
object MicKeepAliveOverlay {
    private val main = Handler(Looper.getMainLooper())
    private var wm: WindowManager? = null
    private var view: View? = null

    fun hasPermission(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(ctx)

    /** 显示保活悬浮窗（幂等，主线程执行） */
    fun show(ctx: Context) {
        val appCtx = ctx.applicationContext
        main.post { showInternal(appCtx) }
    }

    /** 移除保活悬浮窗（幂等，主线程执行） */
    fun hide() {
        main.post { hideInternal() }
    }

    private fun showInternal(appCtx: Context) {
        if (view != null) return
        if (!hasPermission(appCtx)) return
        val manager = appCtx.getSystemService(Context.WINDOW_SERVICE) as? WindowManager ?: return
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else
            @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE
        val params = WindowManager.LayoutParams(
            1, 1, type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = 0
            y = 0
            // 保留极小不透明度，确保窗口被系统视为“可见”从而可靠保活；1 像素下肉眼完全不可见
            alpha = 0.01f
        }
        val v = View(appCtx).apply { setBackgroundColor(Color.TRANSPARENT) }
        runCatching { manager.addView(v, params) }
            .onSuccess { wm = manager; view = v }
    }

    private fun hideInternal() {
        val v = view
        val m = wm
        if (v != null && m != null) runCatching { m.removeView(v) }
        view = null
        wm = null
    }
}
