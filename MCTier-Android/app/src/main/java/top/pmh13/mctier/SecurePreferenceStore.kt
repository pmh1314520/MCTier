package top.pmh13.mctier

import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Small AES-GCM wrapper for values that must not be kept as plaintext preferences. */
internal class SecurePreferenceStore(private val preferences: SharedPreferences) {
    companion object {
        private const val KeyStoreName = "AndroidKeyStore"
        private const val KeyAlias = "top.pmh13.mctier.secure-preferences"
        private const val Transformation = "AES/GCM/NoPadding"
        private const val IvLengthBytes = 12
        private const val TagLengthBits = 128
    }

    fun getString(key: String): String? {
        val encoded = preferences.getString(key, null) ?: return null
        return runCatching {
            val packed = Base64.decode(encoded, Base64.DEFAULT)
            require(packed.size > IvLengthBytes)
            val iv = packed.copyOfRange(0, IvLengthBytes)
            val ciphertext = packed.copyOfRange(IvLengthBytes, packed.size)
            Cipher.getInstance(Transformation).apply {
                init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(TagLengthBits, iv))
                updateAAD(key.toByteArray(StandardCharsets.UTF_8))
            }.doFinal(ciphertext).let { String(it, StandardCharsets.UTF_8) }
        }.getOrNull()
    }

    fun putStringRemoving(key: String, value: String, legacyKey: String): Boolean {
        val encoded = encodeString(key, value) ?: return false
        return preferences.edit()
            .putString(key, encoded)
            .remove(legacyKey)
            .commit()
    }

    fun remove(vararg keys: String): Boolean {
        val editor = preferences.edit()
        keys.forEach(editor::remove)
        return editor.commit()
    }

    private fun encodeString(key: String, value: String): String? = runCatching {
        val cipher = Cipher.getInstance(Transformation).apply {
            init(Cipher.ENCRYPT_MODE, getOrCreateKey())
            updateAAD(key.toByteArray(StandardCharsets.UTF_8))
        }
        val ciphertext = cipher.doFinal(value.toByteArray(StandardCharsets.UTF_8))
        val packed = ByteArray(cipher.iv.size + ciphertext.size)
        cipher.iv.copyInto(packed)
        ciphertext.copyInto(packed, cipher.iv.size)
        Base64.encodeToString(packed, Base64.NO_WRAP)
    }.getOrNull()

    @Synchronized
    private fun getOrCreateKey(): SecretKey {
        val keyStore = KeyStore.getInstance(KeyStoreName).apply { load(null) }
        (keyStore.getKey(KeyAlias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KeyStoreName).apply {
            init(
                KeyGenParameterSpec.Builder(
                    KeyAlias,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                )
                    .setKeySize(256)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setRandomizedEncryptionRequired(true)
                    .build(),
            )
        }.generateKey()
    }
}
