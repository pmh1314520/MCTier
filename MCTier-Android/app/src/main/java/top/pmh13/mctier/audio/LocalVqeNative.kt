package top.pmh13.mctier.audio

/** JNI entry points for the bundled LocalVQE GGML engine. */
internal object LocalVqeNative {
    val available: Boolean

    init {
        available = runCatching { System.loadLibrary("localvqe_jni") }.isSuccess
    }

    external fun create(modelPath: String): Long
    external fun destroy(context: Long)
    external fun processFrame(context: Long, mic: ShortArray, reference: ShortArray, output: ShortArray): Int
}
