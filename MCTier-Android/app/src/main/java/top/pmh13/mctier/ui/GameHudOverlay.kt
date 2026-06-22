package top.pmh13.mctier.ui

import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView

/**
 * 安卓游戏内 HUD 悬浮层（SYSTEM_ALERT_WINDOW）。
 * 在所有应用之上、屏幕右上角显示一张小卡片：每位队友的延迟与「谁在说话」（绿点）。
 * 鼠标/触摸完全穿透，不影响游戏操作；玩游戏时一眼掌握全队状态。
 */
object GameHudOverlay {
    data class HudRow(val name: String, val latencyMs: Long?, val speaking: Boolean, val self: Boolean)

    @Volatile var enabled = false
    private var wm: WindowManager? = null
    private var container: LinearLayout? = null
    private var appCtx: Context? = null

    fun hasPermission(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(ctx)

    fun show(ctx: Context) {
        if (!hasPermission(ctx)) return
        appCtx = ctx.applicationContext
        if (container != null) return
        val manager = appCtx!!.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val d = appCtx!!.resources.displayMetrics.density
        val root = LinearLayout(appCtx!!).apply {
            orientation = LinearLayout.VERTICAL
            background = GradientDrawable().apply {
                cornerRadius = 14f * d
                setColor(Color.argb(210, 16, 18, 24))
                setStroke((1 * d).toInt(), Color.argb(80, 124, 207, 0))
            }
            setPadding((12 * d).toInt(), (10 * d).toInt(), (12 * d).toInt(), (10 * d).toInt())
        }
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else
            @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE
        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        )
        lp.gravity = Gravity.TOP or Gravity.END
        lp.x = (10 * d).toInt()
        lp.y = (60 * d).toInt()
        runCatching { manager.addView(root, lp) }
        wm = manager
        container = root
        // 初始标题
        renderRows(emptyList())
    }

    fun hide() {
        val c = container
        val m = wm
        if (c != null && m != null) runCatching { m.removeView(c) }
        container = null
        wm = null
    }

    /** 更新 HUD 行（在主线程执行） */
    fun update(rows: List<HudRow>) {
        val c = container ?: return
        c.post { renderRows(rows) }
    }

    private fun renderRows(rows: List<HudRow>) {
        val c = container ?: return
        val ctx = appCtx ?: return
        val d = ctx.resources.displayMetrics.density
        c.removeAllViews()
        // 标题
        c.addView(TextView(ctx).apply {
            text = "MCTier · " + L("队伍状态", "Squad")
            setTextColor(Color.parseColor("#7CCF00"))
            textSize = 12f
            setTypeface(typeface, Typeface.BOLD)
            setPadding(0, 0, 0, (6 * d).toInt())
        })
        if (rows.isEmpty()) {
            c.addView(TextView(ctx).apply {
                text = L("暂无队友数据", "No teammates yet")
                setTextColor(Color.argb(150, 255, 255, 255))
                textSize = 12f
            })
            return
        }
        for (r in rows) {
            val row = LinearLayout(ctx).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(0, (3 * d).toInt(), 0, (3 * d).toInt())
            }
            // 说话指示点
            row.addView(View(ctx).apply {
                background = GradientDrawable().apply {
                    shape = GradientDrawable.OVAL
                    setColor(if (r.speaking) Color.parseColor("#7CCF00") else Color.argb(64, 255, 255, 255))
                }
                layoutParams = LinearLayout.LayoutParams((8 * d).toInt(), (8 * d).toInt()).apply { rightMargin = (8 * d).toInt() }
            })
            // 名字
            row.addView(TextView(ctx).apply {
                text = r.name + if (r.self) L("（我）", " (me)") else ""
                setTextColor(Color.WHITE)
                textSize = 13f
                setTypeface(typeface, Typeface.BOLD)
                maxLines = 1
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { rightMargin = (10 * d).toInt() }
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
                textSize = 12f
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
