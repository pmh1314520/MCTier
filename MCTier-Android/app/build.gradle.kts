import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.gradle.api.tasks.testing.Test
import org.gradle.api.tasks.JavaExec
import java.security.MessageDigest
import java.net.URI
import java.util.zip.GZIPOutputStream

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
        testInstrumentationRunner = "top.pmh13.mctier.PeerUiInstrumentation"
        minSdk = 26
        targetSdk = 36
        versionCode = 86
        versionName = "3.6.0-android"
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

// LGPL-3.0 要求许可证文本随发行版一同提供，仅在"关于"页放 GitHub 链接不够：
// 离线安装 APK 的用户必须也能在本地读到全文。这里把仓库根目录的许可证/声明
// 复制进 assets，使其打进 APK；由构建任务从单一来源同步，避免副本与根目录不一致。
val licenseAssetDir = layout.buildDirectory.dir("generated/licenseAssets")

val syncLicenseAssets by tasks.registering(Sync::class) {
    description = "Copy repository license texts into APK assets for offline access."
    val repoRoot = rootProject.layout.projectDirectory.dir("..")
    from(repoRoot.file("LICENSE")) { rename { "LICENSE.txt" } }
    from(repoRoot.file("LICENSE-LGPL-3.0.txt"))
    from(repoRoot.file("LICENSE-GPL-3.0.txt"))
    from(repoRoot.file("THIRD_PARTY_NOTICES.md"))
    from(repoRoot.file("shared/speech-model.json"))
    from(repoRoot.file("patches/easytier-2.6.0-mctier-android.patch"))
    into(licenseAssetDir)
}

android.sourceSets.getByName("main").assets.srcDir(licenseAssetDir)
val builtinEmojiPack = rootProject.projectDir.parentFile.resolve("shared/builtin-emoji/builtin-v3.pack.gz")
val builtinEmojiAssetDir = layout.buildDirectory.dir("generated/builtinEmojiAssets")
val prepareBuiltinEmojiAsset by tasks.registering {
    description = "Wrap the builtin emoji gzip once so Android preserves the .pack.gz asset name and bytes."
    inputs.file(builtinEmojiPack)
    outputs.file(builtinEmojiAssetDir.map { it.file("builtin-v3.pack.gz.gz") })
    doLast {
        val destination = builtinEmojiAssetDir.get().file("builtin-v3.pack.gz.gz").asFile
        destination.parentFile.mkdirs()
        GZIPOutputStream(destination.outputStream().buffered()).use { output ->
            builtinEmojiPack.inputStream().buffered().use { input -> input.copyTo(output) }
        }
    }
}
android.sourceSets.getByName("main").assets.srcDir(builtinEmojiAssetDir)
val prepareSpeechModel by tasks.registering(Exec::class) {
    workingDir(rootProject.projectDir.parentFile)
    commandLine("node", "scripts/prepare-speech-model.mjs")
    inputs.file(rootProject.projectDir.parentFile.resolve("scripts/prepare-speech-model.mjs"))
    inputs.file(rootProject.projectDir.parentFile.resolve("shared/speech-model.json"))
    outputs.dir(rootProject.projectDir.parentFile.resolve("shared/generated/speech-model"))
}
android.sourceSets.getByName("main").assets.srcDir(rootProject.projectDir.parentFile.resolve("shared/generated"))

// 仅把目录登记为 assets 源不够：AGP 的资产合并任务不会因此依赖上面的复制任务，
// 结果是根目录文本更新后 APK 里仍是旧副本（实测 mergeReleaseAssets 直接 UP-TO-DATE）。
// 这里显式建立依赖，确保每次构建都先同步再合并。
tasks.matching { it.name.startsWith("merge") && it.name.endsWith("Assets") }.configureEach {
    dependsOn(syncLicenseAssets)
    dependsOn(prepareSpeechModel)
    dependsOn(prepareBuiltinEmojiAsset)
}
val buildFilePreview by tasks.registering(Exec::class) {
    workingDir(rootProject.projectDir.parentFile)
    commandLine("node", "scripts/build-file-preview.mjs")
    inputs.dir(rootProject.projectDir.parentFile.resolve("shared/file-preview"))
    inputs.file(rootProject.projectDir.parentFile.resolve("scripts/build-file-preview.mjs"))
    inputs.file(rootProject.projectDir.parentFile.resolve("package-lock.json"))
    outputs.file(projectDir.resolve("src/main/assets/file-preview/index.html"))
}
tasks.named("preBuild") { dependsOn(syncLicenseAssets, buildFilePreview) }

// Kotlin 2.4 writes JVM test classes to its own tmp directory, while AGP's
// AndroidUnitTest task discovers classes from the javac output directory.
// Synchronize the compiled output into AGP's exact Java task directory before
// the test task; no custom Test wiring is needed.
val syncDebugUnitTestKotlinClasses by tasks.registering(Sync::class) {
    dependsOn("compileDebugUnitTestKotlin")
    from(layout.buildDirectory.dir("tmp/kotlin-classes/debugUnitTest"))
    into(layout.buildDirectory.dir("intermediates/javac/debugUnitTest/compileDebugUnitTestJavaWithJavac/classes"))
}
// AGP 8.13's AndroidUnitTest worker does not load Kotlin 2.4 test classes on
// this project, even though they are present in its reported classpath. Keep a
// normal Gradle/JUnit runner as the authoritative JVM test task.
val jvmSecurityHardeningTest by tasks.registering(JavaExec::class) {
    dependsOn("compileDebugUnitTestKotlin", "bundleDebugClassesToRuntimeJar")
    classpath = files(
        layout.buildDirectory.dir("tmp/kotlin-classes/debugUnitTest"),
        layout.buildDirectory.dir("tmp/kotlin-classes/debug"),
        (configurations.findByName("debugUnitTestRuntimeClasspath")
            ?: configurations.findByName("testDebugRuntimeClasspath")
            ?: configurations.findByName("testRuntimeClasspath")
            ?: configurations.getByName("debugRuntimeClasspath"))
            .files.filter { it.extension.equals("jar", ignoreCase = true) },
        fileTree("${gradle.gradleUserHomeDir}/caches/modules-2/files-2.1/junit/junit/4.13.2") { include("**/*.jar") },
        fileTree("${gradle.gradleUserHomeDir}/caches/modules-2/files-2.1/org.hamcrest/hamcrest-core") { include("**/*.jar") },
    )
    mainClass.set("org.junit.runner.JUnitCore")
    args("top.pmh13.mctier.network.LobbyAddressTest")
    args("top.pmh13.mctier.network.SignalingRegistrationTest")
    args("top.pmh13.mctier.ui.ChatMediaLayoutTest")
    args("top.pmh13.mctier.ui.ThemeContrastTest")
    args("top.pmh13.mctier.network.PeerPreferencesTest")
    args("top.pmh13.mctier.network.VoiceHealthTest")
    args("top.pmh13.mctier.network.MessagePreviewTest")
    args("top.pmh13.mctier.ui.SpeechModelTest")
    args("top.pmh13.mctier.network.SecurityHardeningTest", "top.pmh13.mctier.network.ChatOrderTest", "top.pmh13.mctier.network.ChatUnreadTest", "top.pmh13.mctier.network.EncryptedChatTest", "top.pmh13.mctier.network.ImageFormatTest", "top.pmh13.mctier.network.BuiltinEmojiCacheTest", "top.pmh13.mctier.network.EmojiManagementTest", "top.pmh13.mctier.network.ChatAttachmentTest", "top.pmh13.mctier.ui.ChatLinkTest")
}
tasks.withType<Test>().matching { it.name == "testDebugUnitTest" }.configureEach {
    dependsOn(syncDebugUnitTestKotlinClasses, jvmSecurityHardeningTest)
    enabled = false
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

val sherpaAar = File(gradle.gradleUserHomeDir, "mctier-libs/sherpa-onnx-1.13.8.aar")
val prepareSherpa by tasks.registering {
    val expected = "633c24321e06b1fe79feafa03ea16cbc0f8a286641e2da3559bac91bdb13bd96"
    outputs.file(sherpaAar)
    fun valid(file: File): Boolean = file.isFile && file.inputStream().use { input ->
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(65536)
        while (true) { val count = input.read(buffer); if (count < 0) break; digest.update(buffer, 0, count) }
        digest.digest().joinToString("") { "%02x".format(it) } == expected
    }
    outputs.upToDateWhen { valid(sherpaAar) }
    doLast {
        if (!valid(sherpaAar)) {
            sherpaAar.parentFile.mkdirs()
            val pending = File(sherpaAar.parentFile, "${sherpaAar.name}.partial")
            try {
                val connection = URI("https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.8/${sherpaAar.name}").toURL().openConnection()
                connection.connectTimeout = 30000
                connection.readTimeout = 120000
                connection.getInputStream().use { input -> pending.outputStream().use { output -> input.copyTo(output) } }
                check(valid(pending)) { "sherpa-onnx AAR checksum mismatch" }
                pending.copyTo(sherpaAar, overwrite = true)
            } finally { pending.delete() }
        }
    }
}

dependencies {
    implementation(files(sherpaAar).builtBy(prepareSherpa))
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
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
    implementation("io.coil-kt.coil3:coil-compose:3.3.0")
    implementation("io.coil-kt.coil3:coil-gif:3.3.0")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation("top.yukonga.miuix.kmp:miuix:0.8.8")

    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")
    implementation("org.nanohttpd:nanohttpd:2.3.1")
    implementation("org.apache.poi:poi:5.4.1")
    implementation("org.apache.poi:poi-scratchpad:5.4.1")
    implementation("io.github.webrtc-sdk:android:144.7559.14")
    // 二维码：生成(core) + 扫码(zxing-android-embedded)
    implementation("com.google.zxing:core:3.5.4")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
}
