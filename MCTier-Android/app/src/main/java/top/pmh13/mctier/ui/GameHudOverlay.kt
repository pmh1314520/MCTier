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
 *
 * 交互：
 * - 窗口为 WRAP_CONTENT（仅卡片大小），卡片以外的所有区域触摸都照常穿透给背后的
 *   任意应用 / 桌面 / 系统界面，不受影响。
 * - 长按卡片任意位置即可拖动整张 HUD 到任意位置，松手记忆位置（带轻微震动反馈）。
 * - 注意：要支持"长按拖动"，卡片本身必须可接收触摸，因此卡片那一小块区域的点击
 *   不会穿透（这是 Android 悬浮窗的硬限制：同一区域无法既穿透又响应长按）。卡片很小，
 *   仅占屏幕一角，其余区域完全不挡。
 * - 透明度、整体尺寸（等比缩放）可在设置中调整。
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
    @Volatile private var dragging = false

    private const val PREF = "mctier_hud"
    private const val KEY_X = "hud_x"
    private const val KEY_Y = "hud_y"

    fun hasPermission(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(ctx)

    /** HUD 浮层窗口当前是否已显示 */
    fun hasContainer(): Boolean = container != null

    /** 卡片背景（alpha 跟随用户设置，ds=已含缩放的密度）。拖动时高亮提示。 */
    private fun bgDrawable(ds: Float): GradientDrawable {
        val a = (opacity.coerceIn(0.2f, 1f) * 255f).toInt()
        return GradientDrawable().apply {
            cornerRadius = 14f * ds
            setColor(Color.argb(a, 16, 18, 24))
            if (dragging) {
                setStroke((2f * ds).toInt().coerceAtLeast(2), Color.argb(255, 124, 207, 0))
            } else {
                setStroke((1f * ds).toInt().coerceAtLeast(1), Color.argb((a * 0.38f).toInt(), 124, 207, 0))
            }
        }
    }

    /** 更新卡片背景与内边距（透明度/缩放/拖动状态变更时调用） */
    private fun applyContainerMetrics() {
        val c = container ?: return
        val ctx = appCtx ?: return
        val ds = ctx.resources.displayMetrics.density * scale
        c.background = bgDrawable(ds)
        c.setPadding((12 * ds).toInt(), (10 * ds).toInt(), (12 * ds).toInt(), (10 * ds).toInt())
    }

    /** 实时调整透明度 */
    fun applyOpacity(v: Float) {
        opacity = v.coerceIn(0.2f, 1f)
        container?.post { applyContainerMetrics() }
    }

    /** 实时调整整体尺寸（等比缩放） */
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
        // 窗口为 WRAP_CONTENT(仅卡片大小)且带 FLAG_NOT_TOUCH_MODAL：卡片以外区域的触摸照常
        // 穿透给背后任意应用/系统界面；仅卡片本身可触摸以支持长按拖动。
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        )
        params.gravity = Gravity.TOP or Gravity.START
        val prefs = appCtx!!.getSharedPreferences(PREF, Context.MODE_PRIVATE)
        val defX = (dm.widthPixels - 240 * ds).toInt().coerceAtLeast((8 * d).toInt())
        val defY = (60 * d).toInt()
        params.x = prefs.getInt(KEY_X, defX)
        params.y = prefs.getInt(KEY_Y, defY)
        attachDrag(root, params)
        runCatching { manager.addView(root, params) }
        wm = manager
        container = root
        lp = params
        renderRows(emptyList())
    }

    /** 长按卡片进入拖动，移动手指即可把 HUD 拖到任意位置，松手记忆位置 */
    private fun attachDrag(root: View, params: WindowManager.LayoutParams) {
        val ctx = appCtx ?: return
        val touchSlop = ViewConfiguration.get(ctx).scaledTouchSlop
        val handler = Handler(Looper.getMainLooper())
        var startX = 0
        var startY = 0
        var startRawX = 0f
        var startRawY = 0f
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
                        applyContainerMetrics() // 高亮边框提示进入拖动
                    }
                    handler.postDelayed(longPress!!, 350)
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - startRawX
                    val dy = e.rawY - startRawY
                    if (!dragging && (kotlin.math.abs(dx) > touchSlop || kotlin.math.abs(dy) > touchSlop)) {
                        // 长按未触发就滑动 → 取消长按（避免误触拖动）
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
                        dragging = false
                        applyContainerMetrics() // 取消高亮
                    }
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
        dragging = false
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
