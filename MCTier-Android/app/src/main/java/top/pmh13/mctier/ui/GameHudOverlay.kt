package top.pmh13.mctier.ui

import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.provider.Settings
import android.view.Gravity
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
    @Volatile var movable = false // 是否处于"调整位置"模式（可触摸拖动）；否则完全穿透不挡操作
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

    /** HUD 浮层窗口当前是否已显示 */
    fun hasContainer(): Boolean = container != null

    /** 窗口触摸标志：非调整模式下加 FLAG_NOT_TOUCHABLE 让触摸完全穿透到背后应用 */
    private fun windowFlags(movableMode: Boolean): Int {
        var f = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
        if (!movableMode) f = f or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
        return f
    }

    /** 根据当前 opacity 生成卡片背景（alpha 跟随用户设置，ds=已含缩放的密度） */
    private fun bgDrawable(ds: Float): GradientDrawable {
        val a = (opacity.coerceIn(0.2f, 1f) * 255f).toInt()
        return GradientDrawable().apply {
            cornerRadius = 14f * ds
            setColor(Color.argb(a, 16, 18, 24))
            // 调整位置模式下用更亮更粗的绿色描边提示"可拖动"
            if (movable) {
                setStroke((2f * ds).toInt().coerceAtLeast(2), Color.argb(255, 124, 207, 0))
            } else {
                setStroke((1f * ds).toInt().coerceAtLeast(1), Color.argb((a * 0.38f).toInt(), 124, 207, 0))
            }
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
        // 默认 FLAG_NOT_TOUCHABLE：触摸完全穿透给背后应用，单击不会被 HUD 拦截。
        // 仅当进入"调整位置"模式(movable)时才接收触摸以拖动。窗口为 WRAP_CONTENT(仅卡片大小)。
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            type,
            windowFlags(movable),
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

    /**
     * 调整位置模式下的触摸处理：
     * - 按住拖动 → 移动 HUD，松手记忆位置；
     * - 轻点（未移动）→ 退出调整模式并锁定回穿透，方便用户定位完成后立刻恢复"不挡操作"。
     * 非调整模式下窗口带 FLAG_NOT_TOUCHABLE，本监听不会触发，触摸直接穿透。
     */
    private fun attachDrag(root: View, params: WindowManager.LayoutParams) {
        val ctx = appCtx ?: return
        val touchSlop = ViewConfiguration.get(ctx).scaledTouchSlop
        var startX = 0
        var startY = 0
        var startRawX = 0f
        var startRawY = 0f
        var moved = false
        root.setOnTouchListener { v, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    startX = params.x; startY = params.y
                    startRawX = e.rawX; startRawY = e.rawY
                    moved = false
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - startRawX
                    val dy = e.rawY - startRawY
                    if (!moved && (kotlin.math.abs(dx) > touchSlop || kotlin.math.abs(dy) > touchSlop)) {
                        moved = true
                    }
                    if (moved) {
                        params.x = (startX + dx).toInt()
                        params.y = (startY + dy).toInt()
                        runCatching { wm?.updateViewLayout(v, params) }
                    }
                    true
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    if (moved) {
                        runCatching {
                            ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit()
                                .putInt(KEY_X, params.x).putInt(KEY_Y, params.y).apply()
                        }
                    } else if (e.actionMasked == MotionEvent.ACTION_UP) {
                        // 轻点未拖动：定位完成，锁定回穿透模式
                        setMovableMode(false)
                    }
                    moved = false
                    true
                }
                else -> false
            }
        }
    }

    /** 进入/退出"调整位置"模式。调整模式下 HUD 可拖动且高亮提示，非调整模式完全穿透不挡操作。 */
    fun setMovableMode(enable: Boolean) {
        movable = enable
        val c = container ?: return
        val params = lp ?: return
        c.post {
            params.flags = windowFlags(movable)
            runCatching { wm?.updateViewLayout(c, params) }
            applyContainerMetrics()
            renderRows(lastRows)
        }
    }

    fun hide() {
        val c = container
        val m = wm
        if (c != null && m != null) runCatching { m.removeView(c) }
        container = null
        wm = null
        lp = null
        movable = false
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
        // 调整位置模式提示
        if (movable) {
            c.addView(TextView(ctx).apply {
                text = L("拖动到合适位置，轻点锁定", "Drag to position, tap to lock")
                setTextColor(Color.parseColor("#FFD24A"))
                textSize = 10f * scale
                setPadding(0, 0, 0, (6 * ds).toInt())
            })
        }
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
