package top.pmh13.mctier

import android.app.Activity
import android.content.Intent
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import android.widget.Toast
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.MultiFormatReader
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.client.android.Intents
import com.google.zxing.common.HybridBinarizer
import com.journeyapps.barcodescanner.CaptureActivity

/** Portrait scanner Activity with an in-screen gallery QR picker. */
class PortraitCaptureActivity : CaptureActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        addGalleryPickerButton()
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == RequestPickQrImage) {
            if (resultCode == Activity.RESULT_OK) {
                val uri = data?.data
                val contents = uri?.let { decodeQrFromImageUri(it) }
                if (contents.isNullOrBlank()) {
                    Toast.makeText(this, "图片中未识别到有效二维码", Toast.LENGTH_SHORT).show()
                } else {
                    setResult(Activity.RESULT_OK, Intent().putExtra(Intents.Scan.RESULT, contents))
                    finish()
                }
            }
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }

    private fun addGalleryPickerButton() {
        val button = TextView(this).apply {
            text = "从相册选择二维码"
            textSize = 15f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setPadding(dp(18), dp(10), dp(18), dp(10))
            background = GradientDrawable().apply {
                cornerRadius = dp(22).toFloat()
                setColor(Color.argb(210, 32, 42, 38))
                setStroke(dp(1), Color.rgb(82, 196, 26))
            }
            setOnClickListener { openGalleryPicker() }
        }
        val params = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL,
        ).apply {
            bottomMargin = dp(42)
        }
        (window.decorView as? ViewGroup)?.addView(button, params)
    }

    private fun openGalleryPicker() {
        val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
            type = "image/*"
            addCategory(Intent.CATEGORY_OPENABLE)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        startActivityForResult(Intent.createChooser(intent, "选择二维码图片"), RequestPickQrImage)
    }

    private fun decodeQrFromImageUri(uri: Uri): String? = runCatching {
        val bitmap = contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it) }
            ?: return@runCatching null
        val pixels = IntArray(bitmap.width * bitmap.height)
        bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
        val source = RGBLuminanceSource(bitmap.width, bitmap.height, pixels)
        val binaryBitmap = BinaryBitmap(HybridBinarizer(source))
        val hints = mapOf(DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE))
        MultiFormatReader().decode(binaryBitmap, hints).text
    }.getOrNull()

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density + 0.5f).toInt()

    private companion object {
        const val RequestPickQrImage = 0x4D51
    }
}
