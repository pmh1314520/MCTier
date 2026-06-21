package top.pmh13.mctier

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.net.VpnService
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.core.view.WindowCompat
import androidx.activity.result.contract.ActivityResultContracts
import com.easytier.jni.EasyTierJNI
import androidx.compose.runtime.remember
import top.pmh13.mctier.ui.MctierApp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // 开启 edge-to-edge：让 statusBars/navigationBars/ime 等 WindowInsets 只计一次，
        // 配合 adjustResize 修复聊天输入框被键盘顶得过高的问题
        WindowCompat.setDecorFitsSystemWindows(window, false)
        Log.i("MCTier", "EasyTier native available=${EasyTierJNI.available}, error=${EasyTierJNI.loadErrorMessage}")
        val permissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {}
        permissions.launch(arrayOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.POST_NOTIFICATIONS))
        val vpnPermission = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            if (result.resultCode != Activity.RESULT_OK) {
                // 用户可以稍后再次点加入大厅触发系统授权流程。
            }
        }
        VpnService.prepare(this)?.let { vpnPermission.launch(it) }
        // 启动即应用已保存的主题（深/浅色 + 主色），避免冷启动闪烁
        run {
            val s = MctierRepository.get(applicationContext).state.value.settings
            top.pmh13.mctier.ui.applyAppTheme(s.themeMode, s.themePrimary)
            top.pmh13.mctier.ui.applyAppLanguage(s.language)
        }
        // 处理冷启动时的 deep link
        handleDeepLink(intent)
        setContent {
            val repository = remember { MctierRepository.get(applicationContext) }
            MctierApp(repository = repository)
        }
    }

    override fun onResume() {
        super.onResume()
        runCatching { MctierRepository.get(applicationContext).setAppForeground(true) }
    }

    override fun onPause() {
        super.onPause()
        // 进入后台(如切到游戏)：标记非前台，使消息弹幕即使在聊天室界面也能飘出
        runCatching { MctierRepository.get(applicationContext).setAppForeground(false) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleDeepLink(intent)
    }

    /** 解析 mctier://join?name=&pwd= 并预填加入表单（仅填表，不自动连接；非法参数安全忽略） */
    private fun handleDeepLink(intent: Intent?) {
        val data: Uri = intent?.data ?: return
        if (data.scheme != "mctier") return
        runCatching {
            val name = data.getQueryParameter("name").orEmpty()
            val pwd = data.getQueryParameter("pwd").orEmpty()
            if (name.isNotBlank()) {
                MctierRepository.get(applicationContext).applyDeepLink(name, pwd)
            }
        }
    }
}
