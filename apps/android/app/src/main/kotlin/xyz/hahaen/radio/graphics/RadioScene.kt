package xyz.hahaen.radio.graphics

import android.annotation.SuppressLint
import android.graphics.Color
import android.net.Uri
import android.webkit.*
import android.view.ViewGroup
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.webkit.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.yield
import kotlinx.serialization.json.*
import xyz.hahaen.radio.domain.*
import java.util.concurrent.atomic.AtomicBoolean

private const val ORIGIN = "https://appassets.androidplatform.net"
private const val PAGE = "$ORIGIN/assets/graphics/index.html"

@SuppressLint("SetJavaScriptEnabled")
@Composable fun RadioScene(stations: List<Station>, playback: PlaybackState, scene: String, powerSave: Boolean,
    modifier: Modifier = Modifier, onSelect: (String) -> Unit, onFailure: () -> Unit) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var ready by remember { mutableStateOf(false) }
    var active by remember { mutableStateOf(lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) }
    val select by rememberUpdatedState(onSelect)
    val failure by rememberUpdatedState(onFailure)
    val allowedIds = remember(stations, playback.station) { (stations.map { it.id } + listOfNotNull(playback.station?.id)).toSet() }
    val ids by rememberUpdatedState(allowedIds)
    val json = remember { Json { encodeDefaults = true } }
    val webDisposed = remember { AtomicBoolean(false) }
    val web = remember {
        WebView(context).apply {
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            setBackgroundColor(Color.TRANSPARENT)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.mediaPlaybackRequiresUserGesture = true
            val loader = WebViewAssetLoader.Builder().addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context)).build()
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                    if (!webDisposed.get() && request.isForMainFrame) failure()
                }
                override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) {
                    if (!webDisposed.get() && request.isForMainFrame) failure()
                }
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
                    if (request.url.scheme == "https" && request.url.host == "appassets.androidplatform.net" && request.url.path?.startsWith("/assets/graphics/") == true)
                        loader.shouldInterceptRequest(request.url)?.let { return it }
                    return WebResourceResponse("text/plain", "utf-8", 403, "Forbidden", emptyMap(), "".byteInputStream())
                }
                override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                    if (!webDisposed.get()) failure()
                    return true
                }
            }
            if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                WebViewCompat.addWebMessageListener(this, "HaenNative", setOf(ORIGIN)) { _, message, origin, mainFrame, _ ->
                    if (webDisposed.get()) return@addWebMessageListener
                    val data = message.data
                    if (!mainFrame || origin != Uri.parse(ORIGIN) || data == null || data.length > 4096) return@addWebMessageListener
                    val payload = runCatching { json.parseToJsonElement(data).jsonObject }.getOrNull() ?: return@addWebMessageListener
                    if ((payload["version"] as? JsonPrimitive)?.intOrNull != 1) return@addWebMessageListener
                    when ((payload["type"] as? JsonPrimitive)?.contentOrNull) {
                        "ready" -> ready = true
                        "select" -> (payload["id"] as? JsonPrimitive)?.contentOrNull?.takeIf { it in ids }?.let(select)
                        "lost" -> failure()
                    }
                }
                loadUrl(PAGE)
            } else failure()
        }
    }
    fun sendOnMain(payload: JsonObject) {
        if (!webDisposed.get()) web.evaluateJavascript("window.haenReceive && window.haenReceive(${payload});", null)
    }
    suspend fun sendFromCoroutine(payload: () -> JsonObject) {
        withContext(Dispatchers.Main.immediate) {
            // Read lifecycle-sensitive state after dispatching, alongside the actual send.
            sendOnMain(payload())
        }
    }
    LaunchedEffect(web, ready) {
        if (!ready) { delay(15_000); if (!webDisposed.get()) failure() }
    }
    DisposableEffect(web, lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            if (webDisposed.get()) return@LifecycleEventObserver
            if (event == Lifecycle.Event.ON_START) {
                active = true
                web.onResume()
                sendOnMain(buildJsonObject { put("version", 1); put("type", "active"); put("active", true) })
            }
            if (event == Lifecycle.Event.ON_STOP) {
                active = false
                // A stopped Compose frame clock may defer the snapshot effect indefinitely.
                sendOnMain(buildJsonObject { put("version", 1); put("type", "active"); put("active", false) })
                web.onPause()
            }
        }
        lifecycle.addObserver(observer)
        onDispose {
            lifecycle.removeObserver(observer)
            if (webDisposed.compareAndSet(false, true)) {
                web.evaluateJavascript("window.haenReceive && window.haenReceive({version:1,type:'destroy'});", null)
                web.stopLoading(); web.removeAllViews(); web.destroy()
            }
        }
    }
    LaunchedEffect(ready, stations) {
        if (!ready) return@LaunchedEffect
        sendFromCoroutine { buildJsonObject { put("version",1); put("type","reset") } }
        for (batch in stations.chunked(250)) {
            val payload = withContext(Dispatchers.Default) { buildJsonObject { put("version",1); put("type","batch"); put("items",json.encodeToJsonElement(batch)) } }
            sendFromCoroutine { payload }; yield()
        }
        sendFromCoroutine { buildJsonObject { put("version",1); put("type","complete") } }
    }
    LaunchedEffect(ready, playback.station, playback.playing, playback.pinned, scene, powerSave, active) {
        if (ready) sendFromCoroutine { buildJsonObject {
            put("version",1); put("type","snapshot"); putJsonObject("snapshot") {
                put("station",json.encodeToJsonElement(playback.station)); put("playing",playback.playing)
                put("pinned",playback.pinned); put("scene",scene); put("powerSave",powerSave); put("active",active)
            }
        } }
    }
    AndroidView(factory = { web }, modifier = modifier)
}
