import com.android.build.api.artifact.SingleArtifact
import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
}
dependencyLocking { lockAllConfigurations() }

val releaseSigningFile = rootProject.file("../../.local/signing/release.properties")
val releaseSigningProperties = Properties().apply {
    if (releaseSigningFile.isFile) releaseSigningFile.inputStream().use { load(it) }
}
val hasReleaseSigning = releaseSigningFile.isFile
val releaseSigningValues = if (hasReleaseSigning) {
    listOf("storeFile", "storePassword", "keyAlias", "keyPassword").associateWith { name ->
        requireNotNull(releaseSigningProperties.getProperty(name)?.takeIf { it.isNotBlank() }) {
            "Missing $name in the private Release signing configuration."
        }
    }
} else emptyMap()
val releaseKeyStore = releaseSigningValues["storeFile"]?.let {
    releaseSigningFile.parentFile.resolve(it).also { keyStore ->
        require(keyStore.isFile) { "Release signing keystore does not exist." }
    }
}

android {
    namespace = "xyz.hahaen.radio"
    compileSdk = 36
    buildToolsVersion = "36.0.0"
    defaultConfig {
        applicationId = "xyz.hahaen.radio"
        minSdk = 26
        targetSdk = 36
        versionCode = 6
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "API_BASE_URL", "\"https://hahaen.xyz/radio/api/v1/\"")
    }
    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = releaseKeyStore
                storePassword = releaseSigningValues.getValue("storePassword")
                keyAlias = releaseSigningValues.getValue("keyAlias")
                keyPassword = releaseSigningValues.getValue("keyPassword")
            }
        }
    }
    buildTypes.named("release") {
        isDebuggable = false
        signingConfig = signingConfigs.findByName("release")
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    packaging { resources.excludes += setOf("META-INF/AL2.0", "META-INF/LGPL2.1") }
    testOptions { unitTests.isIncludeAndroidResources = true }
    sourceSets["androidTest"].assets.srcDir("$projectDir/schemas")
}
kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }
ksp { arg("room.schemaLocation", "$projectDir/schemas") }
val graphicsBuild by tasks.registering(Exec::class) {
    workingDir(rootProject.file("../web"))
    commandLine("pnpm", "exec", "vite", "build", "--config", "../android/graphics/vite.config.ts")
    inputs.dir(rootProject.file("graphics"))
    inputs.dir(rootProject.file("../web/src/graphics"))
    inputs.file(rootProject.file("../web/src/library/model.ts"))
    inputs.file(rootProject.file("../web/src/platform/paths.ts"))
    inputs.dir(rootProject.file("../../packages/contracts/src"))
    inputs.dir(rootProject.file("../web/public"))
    inputs.file(rootProject.file("../../pnpm-lock.yaml"))
    outputs.dir(file("src/main/assets/graphics"))
}
tasks.named("preBuild").configure { dependsOn(graphicsBuild) }

val requireReleaseSigning by tasks.registering {
    group = "verification"
    description = "Require private signing configuration before building a Release artifact."
    doLast {
        check(hasReleaseSigning) {
            "Release signing is not configured. Restore .local/signing/release.properties and its keystore."
        }
    }
}
tasks.matching { it.name == "preReleaseBuild" }.configureEach { dependsOn(requireReleaseSigning) }

androidComponents {
    onVariants(selector().all()) { variant ->
        val variantTaskName = variant.name.replaceFirstChar { it.uppercaseChar() }
        val releaseApkFileName = "声屿HAEN.apk"
        val exportApk = tasks.register<Sync>("export${variantTaskName}Apk") {
            group = "distribution"
            description = "Sync the latest ${variant.name} APKs to the local android-packages folder."
            inputs.property("releaseApkFileName", releaseApkFileName)
            from(variant.artifacts.get(SingleArtifact.APK)) {
                include("*.apk")
                if (variant.name == "release") {
                    rename { name -> if (name == "app-release.apk") releaseApkFileName else name }
                }
            }
            into(rootProject.layout.projectDirectory.dir("../../android-packages/${variant.name}"))
        }
        tasks.matching { it.name == "assemble$variantTaskName" }.configureEach {
            dependsOn(exportApk)
        }
    }
}

dependencies {
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
    implementation(libs.compose.icons)
    implementation(libs.activity.compose)
    implementation(libs.appcompat)
    implementation(libs.lifecycle.runtime)
    implementation(libs.lifecycle.viewmodel)
    implementation(libs.navigation.ui)
    implementation(libs.navigation.runtime)
    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.retrofit)
    implementation(libs.retrofit.serialization)
    implementation(libs.okhttp)
    implementation(libs.serialization)
    implementation(libs.coroutines)
    implementation(libs.room.runtime)
    implementation(libs.room.ktx)
    ksp(libs.room.compiler)
    implementation(libs.datastore)
    implementation(libs.media3.exoplayer)
    implementation(libs.media3.hls)
    implementation(libs.media3.session)
    implementation(libs.media3.okhttp)
    implementation(libs.webkit)
    implementation(libs.coil)
    debugImplementation(platform(libs.compose.bom))
    debugImplementation(libs.compose.tooling)
    debugImplementation(libs.compose.test.manifest)
    testImplementation(libs.junit)
    testImplementation(libs.coroutines.test)
    testImplementation(libs.mockwebserver)
    androidTestImplementation(platform(libs.compose.bom))
    androidTestImplementation(libs.compose.test)
    androidTestImplementation(libs.androidx.test)
    androidTestImplementation(libs.androidx.runner)
    androidTestImplementation(libs.room.testing)
}
