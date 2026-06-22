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
 *
 * 触摸策略（关键）：
 * - 内容卡片窗口带 FLAG_NOT_TOUCHABLE —— 触摸完全穿透到背后的任何应用 / 桌面 / 系统界面，
 *   绝不拦截用户对下层 UI 的点击。
 * - 另设一个很小的「拖动手柄」窗口（可触摸），拖动它即可把整个 HUD 移到任意位置，松手记忆。
 *   这是 Android 上同时实现「内容区完全穿透」与「可拖动」的唯一可行方式
 *   （同一窗口区域无法既穿透又响应拖动）。
 * - 透明度、整体尺寸（等比缩放）可在设置中调整。
 */
object GameHudOverlay {
    data class HudRow(val name: String, val latencyMs: Long?, val speaking: Boolean, val self: Boolean)

    @Volatile var enabled = false
    @Volatile var opacity = 0.85f
    @Volatile var scale = 1f
    private var wm: WindowManager? = null
    private var container: LinearLayout? = null
    private var handle: TextView? = null
    private var contentLp: WindowManager.LayoutParams? = null
    private var handleLp: WindowManager.LayoutParams? = null
    private var appCtx: Context? = null
    private var lastRows: List<HudRow> = emptyList()

    private const val PREF = "mctier_hud"
    private const val KEY_X = "hud_x"
    private const val KEY_Y = "hud_y"

    fun hasPermission(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(ctx)

    /** HUD 浮层窗口当前是否已显示 */
    fun hasContainer(): Boolean = container != null

    /** 内容卡片背景（alpha 跟随用户设置，ds=已含缩放的密度） */
    private fun bgDrawable(ds: Float): GradientDrawable {
        val a = (opacity.coerceIn(0.2f, 1f) * 255f).toInt()
        return GradientDrawable().apply {
            cornerRadius = 14f * ds
            setColor(Color.argb(a, 16, 18, 24))
            setStroke((1f * ds).toInt().coerceAtLeast(1), Color.argb((a * 0.38f).toInt(), 124, 207, 0))
        }
    }

    private fun gripSizePx(d: Float): Int = (26 * d * scale).toInt().coerceAtLeast((20 * d).toInt())

    /** 更新内容卡片背景与内边距（透明度/缩放变更时调用） */
    private fun applyContainerMetrics() {
        val c = container ?: return
        val ctx = appCtx ?: return
        val ds = ctx.resources.displayMetrics.density * scale
        c.background = bgDrawable(ds)
        // 左上角留出手柄位置，避免手柄遮住标题文字
        val gs = gripSizePx(ctx.resources.displayMetrics.density)
        c.setPadding((12 * ds).toInt(), (10 * ds).toInt() + gs / 2, (12 * ds).toInt(), (10 * ds).toInt())
    }

    /** 实时调整透明度 */
    fun applyOpacity(v: Float) {
        opacity = v.coerceIn(0.2f, 1f)
        container?.post { applyContainerMetrics() }
    }

    /** 实时调整整体尺寸（等比缩放） */
    fun applyScale(v: Float) {
        scale = v.coerceIn(0.6f, 1.8f)
        val ctx = appCtx
        container?.post {
            applyContainerMetrics()
            renderRows(lastRows)
            // 同步手柄尺寸
            val h = handle
            val hlp = handleLp
            if (ctx != null && h != null && hlp != null) {
                val gs = gripSizePx(ctx.resources.displayMetrics.density)
                hlp.width = gs; hlp.height = gs
                h.textSize = 12f * scale
                runCatching { wm?.updateViewLayout(h, hlp) }
            }
        }
    }

    fun show(ctx: Context) {
        if (!hasPermission(ctx)) return
        appCtx = ctx.applicationContext
        if (container != null) return
        val manager = appCtx!!.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val dm = appCtx!!.resources.displayMetrics
        val d = dm.density
        val ds = d * scale
        val gs = gripSizePx(d)

        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else
            @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE

        // —— 内容卡片窗口：FLAG_NOT_TOUCHABLE，触摸完全穿透到背后任何界面 ——
        val root = LinearLayout(appCtx!!).apply {
            orientation = LinearLayout.VERTICAL
            background = bgDrawable(ds)
            setPadding((12 * ds).toInt(), (10 * ds).toInt() + gs / 2, (12 * ds).toInt(), (10 * ds).toInt())
        }
        val contentParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
            PixelFormat.TRANSLUCENT,
        )
        contentParams.gravity = Gravity.TOP or Gravity.START
        val prefs = appCtx!!.getSharedPreferences(PREF, Context.MODE_PRIVATE)
        val defX = (dm.widthPixels - 240 * ds).toInt().coerceAtLeast((8 * d).toInt())
        val defY = (60 * d).toInt()
        contentParams.x = prefs.getInt(KEY_X, defX)
        contentParams.y = prefs.getInt(KEY_Y, defY)
        runCatching { manager.addView(root, contentParams) }

        // —— 拖动手柄窗口：可触摸的小绿块，拖动它移动整个 HUD ——
        val grip = TextView(appCtx!!).apply {
            text = "✛"
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            textSize = 12f * scale
            setTypeface(typeface, Typeface.BOLD)
            background = GradientDrawable().apply {
                cornerRadius = 8f * ds
                setColor(Color.argb(235, 90, 150, 0))
                setStroke((1f * d).toInt().coerceAtLeast(1), Color.argb(255, 180, 240, 80))
            }
        }
        val handleParams = WindowManager.LayoutParams(
            gs, gs, type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        )
        handleParams.gravity = Gravity.TOP or Gravity.START
        handleParams.x = contentParams.x
        handleParams.y = contentParams.y
        attachDrag(grip, contentParams, handleParams, root)
        runCatching { manager.addView(grip, handleParams) }

        wm = manager
        container = root
        handle = grip
        contentLp = contentParams
        handleLp = handleParams
        renderRows(emptyList())
    }

    /** 拖动手柄：按住拖动即可把整个 HUD（内容+手柄）移到任意位置，松手记忆位置 */
    private fun attachDrag(grip: View, contentP: WindowManager.LayoutParams, handleP: WindowManager.LayoutParams, content: View) {
        val ctx = appCtx ?: return
        val touchSlop = ViewConfiguration.get(ctx).scaledTouchSlop
        var startCx = 0
        var startCy = 0
        var startRawX = 0f
        var startRawY = 0f
        var moved = false
        grip.setOnTouchListener { v, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    startCx = contentP.x; startCy = contentP.y
                    startRawX = e.rawX; startRawY = e.rawY
                    moved = false
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (e.rawX - startRawX).toInt()
                    val dy = (e.rawY - startRawY).toInt()
                    if (!moved && (kotlin.math.abs(dx) > touchSlop || kotlin.math.abs(dy) > touchSlop)) moved = true
                    if (moved) {
                        contentP.x = startCx + dx
                        contentP.y = startCy + dy
                        handleP.x = contentP.x
                        handleP.y = contentP.y
                        runCatching { wm?.updateViewLayout(content, contentP) }
                        runCatching { wm?.updateViewLayout(v, handleP) }
                    }
                    true
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    if (moved) {
                        runCatching {
                            ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit()
                                .putInt(KEY_X, contentP.x).putInt(KEY_Y, contentP.y).apply()
                        }
                    }
                    moved = false
                    true
                }
                else -> false
            }
        }
    }

    fun hide() {
        val m = wm
        container?.let { c -> if (m != null) runCatching { m.removeView(c) } }
        handle?.let { h -> if (m != null) runCatching { m.removeView(h) } }
        container = null
        handle = null
        wm = null
        contentLp = null
        handleLp = null
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
