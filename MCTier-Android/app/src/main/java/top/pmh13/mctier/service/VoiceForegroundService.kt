package top.pmh13.mctier.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import top.pmh13.mctier.MainActivity
import top.pmh13.mctier.ui.L

/**
 * 语音通话麦克风前台服务（foregroundServiceType=microphone）。
 *
 * 背景：Android 9+ 起，App 切到后台后若没有“麦克风类型”的前台服务在运行，系统会在数秒内
 * 切断麦克风采集（RECORD_AUDIO 使用中授权），导致挂后台后语音突然没声。仅靠悬浮窗提权
 * 在很多机型上不足以保活，必须使用 microphone 类型的前台服务。
 *
 * 本服务在加入语音大厅时启动（此时 App 处于前台、已持有 RECORD_AUDIO 权限，满足 Android 14
 * 启动 microphone 前台服务的条件），离开大厅时停止。它使麦克风采集在后台持续存活。
 */
class VoiceForegroundService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        ensureChannel()
        val tapIntent = runCatching {
            PendingIntent.getActivity(
                this, 0,
                Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0,
            )
        }.getOrNull()
        val notification: Notification = Notification.Builder(this, CHANNEL_ID)
            .setContentTitle(L("MCTier 语音通话", "MCTier Voice"))
            .setContentText(L("正在保持语音通话（后台运行中）", "Keeping voice active in the background"))
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setOngoing(true)
            .also { if (tapIntent != null) it.setContentIntent(tapIntent) }
            .build()
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        }
        // 进程存活期间维持后台语音；进程被系统杀掉后无需自动重建（届时大厅连接也已断开）
        return START_NOT_STICKY
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (mgr.getNotificationChannel(CHANNEL_ID) == null) {
                mgr.createNotificationChannel(
                    NotificationChannel(CHANNEL_ID, L("语音通话", "Voice"), NotificationManager.IMPORTANCE_LOW),
                )
            }
        }
    }

    override fun onDestroy() {
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE) else @Suppress("DEPRECATION") stopForeground(true)
        }
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL_ID = "mctier_voice_mic"
        private const val NOTIFICATION_ID = 4542

        fun start(context: Context) {
            val intent = Intent(context, VoiceForegroundService::class.java)
            runCatching {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
            }
        }

        fun stop(context: Context) {
            runCatching { context.stopService(Intent(context, VoiceForegroundService::class.java)) }
        }
    }
}
