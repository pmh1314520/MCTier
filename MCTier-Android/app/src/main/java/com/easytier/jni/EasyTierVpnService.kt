package com.easytier.jni

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Log
import kotlin.concurrent.thread

class EasyTierVpnService : VpnService() {
    private var vpnInterface: ParcelFileDescriptor? = null
    private var running = false
    private var wakeLock: android.os.PowerManager.WakeLock? = null
    private var wifiLock: android.net.wifi.WifiManager.WifiLock? = null

    private fun acquireLocks() {
        runCatching {
            if (wakeLock == null) {
                val pm = getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
                wakeLock = pm.newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "mctier:vpn").apply {
                    setReferenceCounted(false); acquire()
                }
            }
            if (wifiLock == null) {
                val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as android.net.wifi.WifiManager
                wifiLock = wm.createWifiLock(android.net.wifi.WifiManager.WIFI_MODE_FULL_HIGH_PERF, "mctier:wifi").apply {
                    setReferenceCounted(false); acquire()
                }
            }
        }
    }

    private fun releaseLocks() {
        runCatching { wakeLock?.let { if (it.isHeld) it.release() } }
        runCatching { wifiLock?.let { if (it.isHeld) it.release() } }
        wakeLock = null
        wifiLock = null
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // 显式停止：关闭 TUN、撤销前台、结束服务，确保系统 VPN 图标立即消失
        if (intent?.action == ACTION_STOP) {
            running = false
            runCatching { vpnInterface?.close() }
            vpnInterface = null
            runCatching {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE) else @Suppress("DEPRECATION") stopForeground(true)
            }
            stopSelf()
            return START_NOT_STICKY
        }
        // 前台服务保活：常驻通知，避免系统在后台杀掉组网
        startAsForeground()
        acquireLocks()
        val ipv4Address = intent?.getStringExtra(EXTRA_IPV4) ?: return START_STICKY
        val routes = intent.getStringArrayListExtra(EXTRA_ROUTES) ?: arrayListOf("10.0.0.0/8")
        val instanceName = intent.getStringExtra(EXTRA_INSTANCE) ?: return START_STICKY
        val magicDns = intent.getBooleanExtra(EXTRA_MAGIC_DNS, false)

        thread(name = "mctier-easytier-vpn") {
            runCatching {
                setupVpnInterface(instanceName, ipv4Address, routes, magicDns)
            }.onFailure {
                Log.e(TAG, "Failed to setup EasyTier VPN", it)
                stopSelf()
            }
        }
        return START_STICKY
    }

    private fun startAsForeground() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (mgr.getNotificationChannel(CHANNEL_ID) == null) {
                mgr.createNotificationChannel(
                    NotificationChannel(CHANNEL_ID, "MCTier 组网", NotificationManager.IMPORTANCE_LOW),
                )
            }
        }
        val notification: Notification = Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("MCTier 正在组网")
            .setContentText("保持与好友的虚拟局域网连接")
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setOngoing(true)
            .build()
        runCatching { startForeground(NOTIFICATION_ID, notification) }
    }

    override fun onDestroy() {
        running = false
        releaseLocks()
        vpnInterface?.close()
        vpnInterface = null
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE) else @Suppress("DEPRECATION") stopForeground(true)
        }
        super.onDestroy()
    }

    private fun setupVpnInterface(instanceName: String, ipv4Address: String, routes: List<String>, magicDns: Boolean) {
        val (ip, prefix) = parseCidr(if (ipv4Address.contains("/")) ipv4Address else "$ipv4Address/24")
        val builder = Builder()
            .setSession("MCTier EasyTier")
            .setMtu(1420)
            .addAddress(ip, prefix)
        // 开启"使用域名"时：把 EasyTier Magic DNS 的 fake IP 设为首选 DNS，并路由进隧道，
        // 由 EasyTier 把 <对端主机名>.mct.net 解析为对端虚拟 IP（实现手机端虚拟域名访问）
        if (magicDns) {
            builder.addDnsServer(MAGIC_DNS_FAKE_IP)
            runCatching { builder.addRoute(MAGIC_DNS_FAKE_IP, 32) }
        }
        builder.addDnsServer("223.5.5.5")
            .addDnsServer("114.114.114.114")

        routes.forEach { cidr ->
            runCatching {
                val (routeIp, routePrefix) = parseCidr(cidr)
                builder.addRoute(routeIp, routePrefix)
            }.onFailure {
                Log.w(TAG, "Skip invalid route $cidr", it)
            }
        }

        vpnInterface = builder.establish() ?: error("VpnService.Builder.establish returned null")
        val fd = vpnInterface?.fd ?: error("VPN fd is missing")
        val result = EasyTierJNI.setTunFd(instanceName, fd)
        if (result != 0) {
            error(EasyTierJNI.getLastError() ?: "setTunFd failed")
        }

        running = true
        while (running && vpnInterface != null) {
            Thread.sleep(1000)
        }
    }

    private fun parseCidr(value: String): Pair<String, Int> {
        val parts = value.split("/")
        require(parts.size == 2) { "Invalid CIDR: $value" }
        return parts[0] to parts[1].toInt()
    }

    companion object {
        private const val TAG = "MCTierEasyTierVpn"
        private const val CHANNEL_ID = "mctier_vpn_keepalive"
        private const val NOTIFICATION_ID = 4541
        const val EXTRA_IPV4 = "ipv4_address"
        const val EXTRA_ROUTES = "proxy_cidrs"
        const val EXTRA_INSTANCE = "instance_name"
        const val EXTRA_MAGIC_DNS = "magic_dns"
        const val ACTION_STOP = "top.pmh13.mctier.action.STOP_VPN"
        private const val MAGIC_DNS_FAKE_IP = "100.100.100.101"
    }
}
