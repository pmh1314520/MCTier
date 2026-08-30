# ==== 原生库（JNI 按名字查找，不能被混淆/移除）====
-keep class org.webrtc.** { *; }
-keep class fi.iki.elonen.** { *; }

# EasyTier / LocalVQE 的 JNI 入口：C 侧按 Java_<包>_<类>_<方法> 符号绑定，
# 类名或方法名一旦被改写就会在运行时抛 UnsatisfiedLinkError。
-keep class com.easytier.jni.EasyTierJNI { *; }
-keep class top.pmh13.mctier.audio.LocalVqeNative { *; }
-keepclasseswithmembernames class * {
    native <methods>;
}

# ==== kotlinx.serialization ====
# 序列化类的字段名就是 JSON 里的键名，直接参与与桌面端的互通协议，不能被混淆。
-keepattributes *Annotation*, InnerClasses, Signature, RuntimeVisible*Annotations, AnnotationDefault
-keepclassmembers class top.pmh13.mctier.** {
    *** Companion;
}
-keepclasseswithmembers class top.pmh13.mctier.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class top.pmh13.mctier.**$$serializer { *; }
-if @kotlinx.serialization.Serializable class top.pmh13.mctier.**
-keep class top.pmh13.mctier.<1> {
    public static ** INSTANCE;
    kotlinx.serialization.KSerializer serializer(...);
}

# ==== OkHttp / Okio（仅编译期引用的可选依赖，压制无害告警）====
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# ==== ZXing 扫码（journeyapps 会反射查找 CaptureActivity 子类）====
-keep class com.journeyapps.barcodescanner.** { *; }
-keep class top.pmh13.mctier.PortraitCaptureActivity { *; }