import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "top.pmh13.mctier"
    compileSdk = 36

    defaultConfig {
        applicationId = "top.pmh13.mctier"
        minSdk = 26
        targetSdk = 36
        versionCode = 29
        versionName = "2.8.0-android"
        ndk {
            // The bundled LocalVQE engine is currently built for the primary
            // Android ABI; unsupported ABIs retain the WebRTC hardware AEC/NS path.
            abiFilters += listOf("arm64-v8a")
        }
    }

    buildTypes {
        release {
            // 开启 R8：剥离未使用代码并混淆，缩小包体并提高逆向成本（见 issue #17 第 6 条）。
            // JNI 入口、kotlinx.serialization 的线协议字段等需要保名的部分见 proguard-rules.pro。
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "4.1.2"
        }
    }
}

// Kotlin 2.2+ 起 android.kotlinOptions 已废弃（2.4 起为错误），改用 compilerOptions DSL。
kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
        // 超大 Compose 文件(MctierApp.kt)用 invokedynamic 生成 lambda 会导致编译器 IR 阶段 OOM，
        // 改为 class 方式生成 lambda/SAM 转换，规避 GC overhead / 内部错误
        freeCompilerArgs.addAll("-Xlambdas=class", "-Xsam-conversions=class")
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.05.01"))
    implementation("androidx.activity:activity-compose:1.10.1")
    // 保持 1.16.0：1.19.0 要求 AGP 9.1+ / compileSdk 37（Dependabot 误判为 minor 升级）
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.documentfile:documentfile:1.1.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.1")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation("top.yukonga.miuix.kmp:miuix:0.8.8")

    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")
    implementation("org.nanohttpd:nanohttpd:2.3.1")
    implementation("io.github.webrtc-sdk:android:144.7559.14")
    // 二维码：生成(core) + 扫码(zxing-android-embedded)
    implementation("com.google.zxing:core:3.5.4")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
}
