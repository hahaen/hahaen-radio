plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
}
dependencyLocking { lockAllConfigurations() }
android {
    namespace = "xyz.hahaen.radio"
    compileSdk = 36
    buildToolsVersion = "36.0.0"
    defaultConfig {
        applicationId = "xyz.hahaen.radio"
        minSdk = 26
        targetSdk = 36
        versionCode = 3
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "API_BASE_URL", "\"https://hahaen.xyz/radio/api/v1/\"")
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
