package top.pmh13.mctier.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** 首次启动合规同意页：必须同意隐私政策与用户协议方可使用 */
@Composable
fun ConsentScreen(onAgree: () -> Unit, onDisagree: () -> Unit) {
    var doc by remember { mutableStateOf<Int>(0) } // 0=无 1=隐私 2=协议 3=权限

    Box(
        Modifier.fillMaxSize().background(PageBg).padding(20.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Panel).padding(20.dp),
        ) {
            Text(L("欢迎使用 MCTier", "Welcome to MCTier"), color = TextPrimary, fontSize = 19.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(12.dp))
            Text(
                L(
                    "为保护你的权益，请阅读并同意以下条款。我们仅在实现对应功能时申请相应权限，通信内容采用成员间点对点直传。点击下方链接可查看完整内容。",
                    "To protect your rights, please read and agree to the following. We request permissions only for the related features, and communication is transmitted peer-to-peer between members. Tap the links below to read the full text.",
                ),
                color = TextPrimary.copy(alpha = 0.85f), fontSize = 13.sp, lineHeight = 20.sp,
            )
            Spacer(Modifier.height(14.dp))
            LinkRow(L("《隐私政策》", "Privacy Policy")) { doc = 1 }
            LinkRow(L("《用户协议》", "User Agreement")) { doc = 2 }
            LinkRow(L("《权限用途说明》", "Permission Usage")) { doc = 3 }
            Spacer(Modifier.height(18.dp))
            Box(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(GrassGreen)
                    .clickable { onAgree() }.padding(vertical = 13.dp),
                contentAlignment = Alignment.Center,
            ) { Text(L("同意并继续", "Agree & Continue"), color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold) }
            Spacer(Modifier.height(10.dp))
            Box(
                Modifier.fillMaxWidth().clickable { onDisagree() }.padding(vertical = 10.dp),
                contentAlignment = Alignment.Center,
            ) { Text(L("不同意并退出", "Disagree & Exit"), color = TextPrimary.copy(alpha = 0.6f), fontSize = 14.sp) }
        }
    }

    when (doc) {
        1 -> ComplianceDocDialog(L("隐私政策", "Privacy Policy"), ComplianceTexts.privacyPolicy()) { doc = 0 }
        2 -> ComplianceDocDialog(L("用户协议", "User Agreement"), ComplianceTexts.userAgreement()) { doc = 0 }
        3 -> ComplianceDocDialog(L("权限用途说明", "Permission Usage"), ComplianceTexts.permissionUsage()) { doc = 0 }
    }
}

@Composable
private fun LinkRow(label: String, onClick: () -> Unit) {
    Box(Modifier.fillMaxWidth().clickable { onClick() }.padding(vertical = 8.dp)) {
        Text(label, color = GrassGreen, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
    }
}

/** 可滚动的合规文档查看弹窗 */
@Composable
fun ComplianceDocDialog(title: String, body: String, onClose: () -> Unit) {
    Box(
        Modifier.fillMaxSize().background(Color(0xCC000000)).clickable(onClick = onClose),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier.fillMaxWidth().padding(18.dp).clip(RoundedCornerShape(16.dp)).background(Panel).padding(18.dp),
        ) {
            Text(title, color = TextPrimary, fontSize = 17.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(12.dp))
            Box(Modifier.heightIn(max = 460.dp).verticalScroll(rememberScrollState())) {
                Text(body, color = TextPrimary.copy(alpha = 0.85f), fontSize = 13.sp, lineHeight = 20.sp)
            }
            Spacer(Modifier.height(14.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                Box(
                    Modifier.clip(RoundedCornerShape(10.dp)).background(GrassGreen)
                        .clickable { onClose() }.padding(horizontal = 22.dp, vertical = 9.dp),
                ) { Text(L("我已阅读", "I have read"), color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Bold) }
            }
        }
    }
}

/** 设置页中的合规入口：随时可查看隐私政策/用户协议/权限说明 */
@Composable
fun ComplianceLinksSection() {
    var doc by remember { mutableStateOf<Int>(0) }
    Column(Modifier.fillMaxWidth()) {
        Text(L("隐私与协议", "Privacy & Terms"), fontSize = 13.sp, color = TextPrimary.copy(alpha = 0.7f), fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(8.dp))
        ComplianceEntryRow(L("隐私政策", "Privacy Policy")) { doc = 1 }
        ComplianceEntryRow(L("用户协议", "User Agreement")) { doc = 2 }
        ComplianceEntryRow(L("权限用途说明", "Permission Usage")) { doc = 3 }
    }
    when (doc) {
        1 -> ComplianceDocDialog(L("隐私政策", "Privacy Policy"), ComplianceTexts.privacyPolicy()) { doc = 0 }
        2 -> ComplianceDocDialog(L("用户协议", "User Agreement"), ComplianceTexts.userAgreement()) { doc = 0 }
        3 -> ComplianceDocDialog(L("权限用途说明", "Permission Usage"), ComplianceTexts.permissionUsage()) { doc = 0 }
    }
}

@Composable
private fun ComplianceEntryRow(label: String, onClick: () -> Unit) {
    Box(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(PanelHigh)
            .clickable { onClick() }.padding(horizontal = 14.dp, vertical = 12.dp),
    ) {
        Text(label, color = TextPrimary.copy(alpha = 0.9f), fontSize = 14.sp)
    }
}
