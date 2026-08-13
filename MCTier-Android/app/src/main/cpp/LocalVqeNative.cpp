#include <jni.h>
#include <string>
#include "localvqe_api.h"

extern "C" JNIEXPORT jlong JNICALL
Java_top_pmh13_mctier_audio_LocalVqeNative_create(JNIEnv* env, jclass, jstring model_path) {
    if (!model_path) return 0;
    const char* path = env->GetStringUTFChars(model_path, nullptr);
    const auto ctx = localvqe_new(path);
    env->ReleaseStringUTFChars(model_path, path);
    return static_cast<jlong>(ctx);
}

extern "C" JNIEXPORT void JNICALL
Java_top_pmh13_mctier_audio_LocalVqeNative_destroy(JNIEnv*, jclass, jlong ctx) {
    if (ctx) localvqe_free(static_cast<localvqe_ctx_t>(ctx));
}

extern "C" JNIEXPORT jint JNICALL
Java_top_pmh13_mctier_audio_LocalVqeNative_processFrame(
    JNIEnv* env, jclass, jlong ctx, jshortArray mic, jshortArray ref, jshortArray out) {
    if (!ctx || !mic || !ref || !out || env->GetArrayLength(mic) < 256 ||
        env->GetArrayLength(ref) < 256 || env->GetArrayLength(out) < 256) return -1;
    jshort* mic_data = env->GetShortArrayElements(mic, nullptr);
    jshort* ref_data = env->GetShortArrayElements(ref, nullptr);
    jshort* out_data = env->GetShortArrayElements(out, nullptr);
    const int result = localvqe_process_frame_s16(
        static_cast<localvqe_ctx_t>(ctx), reinterpret_cast<int16_t*>(mic_data),
        reinterpret_cast<int16_t*>(ref_data), 256, reinterpret_cast<int16_t*>(out_data));
    env->ReleaseShortArrayElements(mic, mic_data, JNI_ABORT);
    env->ReleaseShortArrayElements(ref, ref_data, JNI_ABORT);
    env->ReleaseShortArrayElements(out, out_data, 0);
    return result;
}
