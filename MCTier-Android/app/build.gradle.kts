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
        versionCode = 3
        versionName = "2.1.0-android"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
        // 超大 Compose 文件(MctierApp.kt)用 invokedynamic 生成 lambda 会导致编译器 IR 阶段 OOM，
        // 改为 class 方式生成 lambda/SAM 转换，规避 GC overhead / 内部错误
        freeCompilerArgs += listOf("-Xlambdas=class", "-Xsam-conversions=class")
    }

    buildFeatures {
        compose = true
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.05.01"))
    implementation("androidx.activity:activity-compose:1.10.1")
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
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")
    implementation("org.nanohttpd:nanohttpd:2.3.1")
    implementation("io.github.webrtc-sdk:android:144.7559.09")
    // 二维码：生成(core) + 扫码(zxing-android-embedded)
    implementation("com.google.zxing:core:3.5.3")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
}
