package com.easytier.jni

import android.util.Log

object EasyTierJNI {
    private const val TAG = "EasyTierJNI"

    val loadErrorMessage: String?
    val available: Boolean

    init {
        var error: String? = null
        val loaded = runCatching {
            System.loadLibrary("easytier_ffi")
            System.loadLibrary("easytier_android_jni")
        }.onFailure { throwable ->
            error = throwable::class.java.simpleName + ": " + (throwable.message ?: "unknown native load error")
            Log.e(TAG, "Failed to load EasyTier native libraries", throwable)
        }.isSuccess
        loadErrorMessage = error
        available = loaded
    }

    @JvmStatic external fun setTunFd(instanceName: String, fd: Int): Int
    @JvmStatic external fun parseConfig(config: String): Int
    @JvmStatic external fun runNetworkInstance(config: String): Int
    @JvmStatic external fun retainNetworkInstance(instanceNames: Array<String>?): Int
    @JvmStatic external fun collectNetworkInfos(maxLength: Int): String?
    @JvmStatic external fun getLastError(): String?

    @JvmStatic
    fun stopAllInstances(): Int = retainNetworkInstance(null)

    @JvmStatic
    fun retainSingleInstance(instanceName: String): Int = retainNetworkInstance(arrayOf(instanceName))
}
