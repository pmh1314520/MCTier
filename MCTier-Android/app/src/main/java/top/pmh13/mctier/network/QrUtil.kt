package top.pmh13.mctier.network

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel

/** 二维码生成工具 */
object QrUtil {
    /** 把文本编码为二维码 Bitmap(黑色前景、白色背景)，用高纠错级别以便中心放置 Logo */
    fun encode(text: String, size: Int = 640): Bitmap? = runCatching {
        val hints = mapOf(
            EncodeHintType.CHARACTER_SET to "UTF-8",
            EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.H,
            EncodeHintType.MARGIN to 1,
        )
        val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size, hints)
        val w = matrix.width
        val h = matrix.height
        val pixels = IntArray(w * h)
        for (y in 0 until h) {
            val offset = y * w
            for (x in 0 until w) {
                pixels[offset + x] = if (matrix.get(x, y)) Color.BLACK else Color.WHITE
            }
        }
        Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).apply {
            setPixels(pixels, 0, w, 0, 0, w, h)
        }
    }.getOrNull()

    /** 在二维码中心叠加 Logo（带白色圆角底衬 + 圆角裁剪 Logo，避免遮挡码点导致扫不出） */
    fun encodeWithLogo(text: String, logo: Bitmap?, size: Int = 640): Bitmap? {
        val qr = encode(text, size) ?: return null
        if (logo == null) return qr
        val result = qr.copy(Bitmap.Config.ARGB_8888, true)
        val canvas = Canvas(result)
        val logoSize = size / 5
        val cx = size / 2f
        val cy = size / 2f
        val pad = logoSize * 0.06f
        // 白色圆角底衬
        val bg = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
        val r = logoSize / 2f + pad
        canvas.drawRoundRect(RectF(cx - r, cy - r, cx + r, cy + r), r * 0.36f, r * 0.36f, bg)
        // 圆角裁剪 Logo
        val dst = RectF(cx - logoSize / 2f, cy - logoSize / 2f, cx + logoSize / 2f, cy + logoSize / 2f)
        canvas.save()
        val clip = android.graphics.Path().apply {
            addRoundRect(dst, logoSize * 0.24f, logoSize * 0.24f, android.graphics.Path.Direction.CW)
        }
        canvas.clipPath(clip)
        canvas.drawBitmap(logo, null, dst, Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
        canvas.restore()
        return result
    }

    /** 把二维码合成为一张 MCTier 主题邀请海报（与桌面端下载样式保持一致） */
    fun buildPoster(qr: Bitmap, lobbyName: String, password: String, accent: Int): Bitmap {
        val w = 600
        val h = 880
        val poster = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(poster)

        val bgPaint = Paint().apply {
            shader = LinearGradient(
                0f,
                0f,
                0f,
                h.toFloat(),
                intArrayOf(Color.parseColor("#16361B"), Color.parseColor("#13131F"), Color.parseColor("#0E0E16")),
                floatArrayOf(0f, 0.5f, 1f),
                Shader.TileMode.CLAMP,
            )
        }
        canvas.drawRect(0f, 0f, w.toFloat(), h.toFloat(), bgPaint)

        val margin = 44f
        val card = RectF(margin, margin, w - margin, h - margin)
        canvas.drawRoundRect(
            card,
            28f,
            28f,
            Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(10, 255, 255, 255) },
        )
        canvas.drawRoundRect(
            card,
            28f,
            28f,
            Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.TRANSPARENT
                style = Paint.Style.STROKE
                strokeWidth = 1.5f
                this.color = Color.argb(89, 82, 196, 26)
            },
        )

        val brand = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.parseColor("#52C41A")
            textAlign = Paint.Align.CENTER
            textSize = 44f
            isFakeBoldText = true
        }
        canvas.drawText("MCTier", w / 2f, 132f, brand)

        val title = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(235, 255, 255, 255)
            textAlign = Paint.Align.CENTER
            textSize = 26f
            isFakeBoldText = true
        }
        canvas.drawText("组网邀请", w / 2f, 174f, title)

        val sub = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(128, 255, 255, 255)
            textAlign = Paint.Align.CENTER
            textSize = 17f
        }
        canvas.drawText("用手机 MCTier 扫一扫，立即加入大厅", w / 2f, 210f, sub)

        val qrSize = 360
        val qx = (w - qrSize) / 2f
        val qy = 250f
        val cardPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
        cardPaint.setShadowLayer(24f, 0f, 8f, Color.argb(89, 0, 0, 0))
        canvas.drawRoundRect(RectF(qx - 24, qy - 24, qx + qrSize + 24, qy + qrSize + 24), 22f, 22f, cardPaint)
        canvas.drawBitmap(qr, null, RectF(qx, qy, qx + qrSize, qy + qrSize), Paint(Paint.FILTER_BITMAP_FLAG))

        val name = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            textAlign = Paint.Align.CENTER
            textSize = 34f
            isFakeBoldText = true
        }
        canvas.drawText(lobbyName, w / 2f, qy + qrSize + 96, name)

        val pwdText = "密码  ${password.ifBlank { "（无）" }}"
        val pwd = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.parseColor("#7EE23F")
            textAlign = Paint.Align.CENTER
            textSize = 22f
        }
        val pillWidth = pwd.measureText(pwdText) + 56f
        val pillX = (w - pillWidth) / 2f
        val pillY = qy + qrSize + 120f
        canvas.drawRoundRect(
            RectF(pillX, pillY, pillX + pillWidth, pillY + 46f),
            23f,
            23f,
            Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(41, 82, 196, 26) },
        )
        canvas.drawText(pwdText, w / 2f, pillY + 31f, pwd)

        val divider = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(26, 255, 255, 255)
            strokeWidth = 1f
        }
        canvas.drawLine(margin + 40f, h - 96f, w - margin - 40f, h - 96f, divider)

        val link = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(140, 255, 255, 255)
            textAlign = Paint.Align.CENTER
            textSize = 18f
        }
        canvas.drawText("https://mctier.pmhs.top", w / 2f, h - 60f, link)
        return poster
    }
}
