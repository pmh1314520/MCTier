package top.pmh13.mctier.ui

import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView

/**
 * 安卓游戏内 HUD 悬浮层（SYSTEM_ALERT_WINDOW）。
 * 在所有应用之上显示一张小卡片：每位队友的延迟与「谁在说话」（绿点）。
 * - 透明度、整体尺寸（等比缩放）可在设置中调整；
 * - 长按卡片可拖动到任意位置，松手后记忆该位置。
 * 卡片以外的区域触摸照常穿透给游戏，不影响操作。
 */
object GameHudOverlay {
    data class HudRow(val name: String, val latencyMs: Long?, val speaking: Boolean, val self: Boolean)

    @Volatile var enabled = false
    @Volatile var opacity = 0.85f
    @Volatile var scale = 1f
    private var wm: WindowManager? = null
    private var container: LinearLayout? = null
    private var appCtx: Context? = null
    private var lp: WindowManager.LayoutParams? = null
    private var lastRows: List<HudRow> = emptyList()

    private const val PREF = "mctier_hud"
    private const val KEY_X = "hud_x"
    private const val KEY_Y = "hud_y"

    fun hasPermission(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(ctx)

    /** 根据当前 opacity 生成卡片背景（alpha 跟随用户设置，ds=已含缩放的密度） */
    private fun bgDrawable(ds: Float): GradientDrawable {
        val a = (opacity.coerceIn(0.2f, 1f) * 255f).toInt()
        return GradientDrawable().apply {
            cornerRadius = 14f * ds
            setColor(Color.argb(a, 16, 18, 24))
            setStroke((1f * ds).toInt().coerceAtLeast(1), Color.argb((a * 0.38f).toInt(), 124, 207, 0))
        }
    }

    /** 更新卡片背景与内边距（透明度/缩放变更时调用） */
    private fun applyContainerMetrics() {
        val c = container ?: return
        val ctx = appCtx ?: return
        val ds = ctx.resources.displayMetrics.density * scale
        c.background = bgDrawable(ds)
        c.setPadding((12 * ds).toInt(), (10 * ds).toInt(), (12 * ds).toInt(), (10 * ds).toInt())
    }

    /** 实时调整透明度：更新已显示卡片，无需重建窗口 */
    fun applyOpacity(v: Float) {
        opacity = v.coerceIn(0.2f, 1f)
        container?.post { applyContainerMetrics() }
    }

    /** 实时调整整体尺寸（等比缩放）：更新已显示卡片 */
    fun applyScale(v: Float) {
        scale = v.coerceIn(0.6f, 1.8f)
        container?.post { applyContainerMetrics(); renderRows(lastRows) }
    }

    fun show(ctx: Context) {
        if (!hasPermission(ctx)) return
        appCtx = ctx.applicationContext
        if (container != null) return
        val manager = appCtx!!.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val dm = appCtx!!.resources.displayMetrics
        val d = dm.density
        val ds = d * scale
        val root = LinearLayout(appCtx!!).apply {
            orientation = LinearLayout.VERTICAL
            background = bgDrawable(ds)
            setPadding((12 * ds).toInt(), (10 * ds).toInt(), (12 * ds).toInt(), (10 * ds).toInt())
        }
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else
            @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE
        // 注意：不再使用 FLAG_NOT_TOUCHABLE —— 需要接收触摸以支持长按拖动。
        // 窗口为 WRAP_CONTENT，仅卡片本身大小，卡片以外区域触摸仍穿透给游戏。
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        )
        params.gravity = Gravity.TOP or Gravity.START
        val prefs = appCtx!!.getSharedPreferences(PREF, Context.MODE_PRIVATE)
        val defX = (dm.widthPixels - 220 * ds).toInt().coerceAtLeast((8 * d).toInt())
        val defY = (60 * d).toInt()
        params.x = prefs.getInt(KEY_X, defX)
        params.y = prefs.getInt(KEY_Y, defY)
        attachDrag(root, params)
        runCatching { manager.addView(root, params) }
        wm = manager
        container = root
        lp = params
        // 初始标题
        renderRows(emptyList())
    }

    /** 长按进入拖动模式，移动手指即可把 HUD 拖到任意位置，松手记忆位置 */
    private fun attachDrag(root: View, params: WindowManager.LayoutParams) {
        val ctx = appCtx ?: return
        val touchSlop = ViewConfiguration.get(ctx).scaledTouchSlop
        val handler = Handler(Looper.getMainLooper())
        var startX = 0
        var startY = 0
        var startRawX = 0f
        var startRawY = 0f
        var dragging = false
        var longPress: Runnable? = null
        root.setOnTouchListener { v, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    startX = params.x; startY = params.y
                    startRawX = e.rawX; startRawY = e.rawY
                    dragging = false
                    longPress = Runnable {
                        dragging = true
                        runCatching { v.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS) }
                    }
                    handler.postDelayed(longPress!!, 250)
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - startRawX
                    val dy = e.rawY - startRawY
                    if (!dragging && (kotlin.math.abs(dx) > touchSlop || kotlin.math.abs(dy) > touchSlop)) {
                        // 长按未触发前就滑动 → 取消长按（不进入拖动，避免误触）
                        longPress?.let { handler.removeCallbacks(it) }
                    }
                    if (dragging) {
                        params.x = (startX + dx).toInt()
                        params.y = (startY + dy).toInt()
                        runCatching { wm?.updateViewLayout(v, params) }
                    }
                    true
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    longPress?.let { handler.removeCallbacks(it) }
                    if (dragging) {
                        runCatching {
                            ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit()
                                .putInt(KEY_X, params.x).putInt(KEY_Y, params.y).apply()
                        }
                    }
                    dragging = false
                    true
                }
                else -> false
            }
        }
    }

    fun hide() {
        val c = container
        val m = wm
        if (c != null && m != null) runCatching { m.removeView(c) }
        container = null
        wm = null
        lp = null
    }

    /** 更新 HUD 行（在主线程执行） */
    fun update(rows: List<HudRow>) {
        val c = container ?: return
        c.post { renderRows(rows) }
    }

    private fun renderRows(rows: List<HudRow>) {
        val c = container ?: return
        val ctx = appCtx ?: return
        lastRows = rows
        val d = ctx.resources.displayMetrics.density
        val ds = d * scale
        c.removeAllViews()
        // 标题
        c.addView(TextView(ctx).apply {
            text = "MCTier · " + L("大厅状态", "Lobby")
            setTextColor(Color.parseColor("#7CCF00"))
            textSize = 12f * scale
            setTypeface(typeface, Typeface.BOLD)
            setPadding(0, 0, 0, (6 * ds).toInt())
        })
        if (rows.isEmpty()) {
            c.addView(TextView(ctx).apply {
                text = L("暂无队友数据", "No teammates yet")
                setTextColor(Color.argb(150, 255, 255, 255))
                textSize = 12f * scale
            })
            return
        }
        for (r in rows) {
            val row = LinearLayout(ctx).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(0, (3 * ds).toInt(), 0, (3 * ds).toInt())
            }
            // 说话指示点
            row.addView(View(ctx).apply {
                background = GradientDrawable().apply {
                    shape = GradientDrawable.OVAL
                    setColor(if (r.speaking) Color.parseColor("#7CCF00") else Color.argb(64, 255, 255, 255))
                }
                layoutParams = LinearLayout.LayoutParams((8 * ds).toInt(), (8 * ds).toInt()).apply { rightMargin = (8 * ds).toInt() }
            })
            // 名字
            row.addView(TextView(ctx).apply {
                text = r.name + if (r.self) L("（我）", " (me)") else ""
                setTextColor(Color.WHITE)
                textSize = 13f * scale
                setTypeface(typeface, Typeface.BOLD)
                maxLines = 1
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { rightMargin = (10 * ds).toInt() }
            })
            // 延迟
            row.addView(TextView(ctx).apply {
                if (r.self) {
                    text = "—"; setTextColor(Color.parseColor("#9AA0A6"))
                } else {
                    val lat = r.latencyMs
                    text = if (lat == null) L("离线", "off") else "${lat}ms"
                    setTextColor(
                        when {
                            lat == null -> Color.parseColor("#FF5A5A")
                            lat < 80 -> Color.parseColor("#7CCF00")
                            lat < 200 -> Color.parseColor("#FFCC00")
                            else -> Color.parseColor("#FF8A3D")
                        },
                    )
                }
                textSize = 12f * scale
                setTypeface(typeface, Typeface.BOLD)
            })
            c.addView(row)
        }
    }

    fun requestPermissionIntent(ctx: Context): android.content.Intent =
        android.content.Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            android.net.Uri.parse("package:${ctx.packageName}"),
        )
}
