package xyz.hahaen.radio.playback

import android.content.ComponentName
import android.content.Context
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import androidx.media3.session.*
import com.google.common.util.concurrent.ListenableFuture
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton
import xyz.hahaen.radio.domain.PlaybackState

/** The service owns the facts; the connection owns only a controller and published snapshots. */
@Singleton class PlaybackConnection @Inject constructor(@ApplicationContext private val context: Context) {
    internal val mutable = MutableStateFlow(PlaybackState())
    val state = mutable.asStateFlow()
    private var controller: MediaController? = null
    private var controllerFuture: ListenableFuture<MediaController>? = null
    private var connecting = false
    private var generation = 0
    private var attached = false
    private var foreground = false
    private var inFlightCommands = 0
    internal var requestedStationId: String? = null
    private val handler = Handler(Looper.getMainLooper())
    private var releaseScheduled = false
    private val releaseAfterHandoffTimeout = Runnable { releaseController() }
    private val waiting = ArrayDeque<Pair<String, Bundle>>()
    @androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
    fun connect() {
        attached = true
        handler.removeCallbacks(releaseAfterHandoffTimeout)
        releaseScheduled = false
        ensureConnected()
    }
    @androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
    private fun ensureConnected() {
        if (controller?.isConnected == true || connecting) return
        controller?.release(); controller = null
        connecting = true
        val expected = ++generation
        val future = MediaController.Builder(context, SessionToken(context, ComponentName(context, RadioService::class.java))).buildAsync()
        controllerFuture = future
        future.addListener({
            if (expected != generation) return@addListener
            controllerFuture = null
            connecting = false
            runCatching { future.get() }.onSuccess {
                controller = it
                while (waiting.isNotEmpty()) { val (command, args) = waiting.removeFirst(); send(it, command, args) }
                releaseIfDetached()
            }.onFailure {
                waiting.clear(); mutable.value = mutable.value.copy(error = "service")
                releaseIfDetached()
            }
        }, ContextCompat.getMainExecutor(context))
    }
    fun disconnect() {
        attached = false
        releaseIfDetached()
    }
    internal fun onServiceForegroundChanged(value: Boolean) {
        foreground = value
        releaseIfDetached()
    }
    private fun releaseIfDetached() {
        if (attached) return
        val handingOff = connecting || waiting.isNotEmpty() || inFlightCommands > 0 ||
            (state.value.connecting && !foreground)
        if (!handingOff) releaseController()
        else if (!releaseScheduled) {
            // Hold only the command/foreground handoff, never the background listening session.
            handler.postDelayed(releaseAfterHandoffTimeout, 5_000)
            releaseScheduled = true
        }
    }
    private fun releaseController() {
        handler.removeCallbacks(releaseAfterHandoffTimeout)
        releaseScheduled = false
        generation++; connecting = false; waiting.clear(); inFlightCommands = 0
        controllerFuture?.let(MediaController::releaseFuture); controllerFuture = null
        controller?.release(); controller = null
    }
    private fun send(active: MediaController, name: String, args: Bundle) {
        val expected = generation
        inFlightCommands++
        val result = active.sendCustomCommand(SessionCommand(name, Bundle.EMPTY), args)
        result.addListener({
            if (expected != generation) return@addListener
            inFlightCommands--
            if (runCatching { result.get().resultCode }.getOrNull() != SessionResult.RESULT_SUCCESS) {
                mutable.value = mutable.value.copy(error = "service")
            }
            releaseIfDetached()
        }, ContextCompat.getMainExecutor(context))
    }
    private fun command(name: String, args: Bundle = Bundle.EMPTY) {
        val active = controller
        if (active != null && active.isConnected) send(active, name, args)
        else {
            active?.release(); controller = null
            if (waiting.size >= 8) waiting.removeFirst()
            waiting.add(name to args); ensureConnected()
        }
    }
    fun select(id: String) = command(SELECT, Bundle().apply { putString("id", id) })
    fun prepare() = command(PREPARE)
    fun toggle() = command(TOGGLE)
    fun next() = command(NEXT)
    fun previous() = command(PREVIOUS)
    fun sleep(minutes: Int) = command(SLEEP, Bundle().apply { putInt("minutes", minutes) })
    fun volume(value: Float) = command(VOLUME, Bundle().apply { putFloat("volume", value) })
    companion object {
        const val SELECT = "haen.select"; const val TOGGLE = "haen.toggle"; const val NEXT = "haen.next"
        const val PREVIOUS = "haen.previous"; const val SLEEP = "haen.sleep"; const val VOLUME = "haen.volume"
        const val PREPARE = "haen.prepare"
        val COMMANDS = listOf(SELECT, TOGGLE, NEXT, PREVIOUS, SLEEP, VOLUME, PREPARE)
    }
}
