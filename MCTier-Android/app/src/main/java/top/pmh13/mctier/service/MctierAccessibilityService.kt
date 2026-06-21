package top.pmh13.mctier.service

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.os.Build
import android.provider.Settings
import android.text.TextUtils
import android.view.accessibility.AccessibilityEvent

/**
 * MCTier 无障碍服务：用于"电脑远程控制手机"时，把控制端发来的指针事件
 * 转换为系统级触摸手势(点击/滑动/拖拽)注入到当前界面。
 *
 * 需用户在 系统设置 > 无障碍 中手动开启本服务。
 */
class MctierAccessibilityService : AccessibilityService() {

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) { /* 不需要监听事件 */ }

    override fun onInterrupt() { /* no-op */ }

    override fun onDestroy() {
        if (instance === this) instance = null
        super.onDestroy()
    }

    /** 单击（屏幕像素坐标） */
    fun tap(x: Float, y: Float) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return
        runCatching {
            val path = Path().apply { moveTo(x, y) }
            val stroke = GestureDescription.StrokeDescription(path, 0, 60)
            dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null)
        }
    }

    /** 长按 */
    fun longPress(x: Float, y: Float) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return
        runCatching {
            val path = Path().apply { moveTo(x, y) }
            val stroke = GestureDescription.StrokeDescription(path, 0, 600)
            dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null)
        }
    }

    /** 多点路径手势（滑动/拖拽，points 为屏幕像素坐标序列） */
    fun gesturePath(points: List<Pair<Float, Float>>, durationMs: Long) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N || points.isEmpty()) return
        runCatching {
            val path = Path()
            path.moveTo(points[0].first, points[0].second)
            for (i in 1 until points.size) path.lineTo(points[i].first, points[i].second)
            val dur = durationMs.coerceIn(20, 30000)
            val stroke = GestureDescription.StrokeDescription(path, 0, dur)
            dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null)
        }
    }

    /** 全局动作：返回 */
    fun goBack() { runCatching { performGlobalAction(GLOBAL_ACTION_BACK) } }

    /** 全局动作：回到桌面 */
    fun goHome() { runCatching { performGlobalAction(GLOBAL_ACTION_HOME) } }

    /** 全局动作：最近任务 */
    fun recents() { runCatching { performGlobalAction(GLOBAL_ACTION_RECENTS) } }

    companion object {
        @Volatile
        var instance: MctierAccessibilityService? = null

        /** 本服务是否已被系统启用（兼容未 onServiceConnected 的情况，再查系统设置） */
        fun isRunning(): Boolean = instance != null

        /** 通过系统设置判断无障碍服务是否已开启 */
        fun isEnabledInSettings(ctx: android.content.Context): Boolean {
            val expected = "${ctx.packageName}/${MctierAccessibilityService::class.java.name}"
            val enabled = Settings.Secure.getString(
                ctx.contentResolver,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
            ) ?: return false
            val splitter = TextUtils.SimpleStringSplitter(':')
            splitter.setString(enabled)
            while (splitter.hasNext()) {
                if (splitter.next().equals(expected, ignoreCase = true)) return true
            }
            return false
        }
    }
}
