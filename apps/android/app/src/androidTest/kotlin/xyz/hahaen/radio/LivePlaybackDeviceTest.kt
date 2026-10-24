package xyz.hahaen.radio

import android.Manifest
import android.content.ComponentName
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaController
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import androidx.media3.session.SessionToken
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import com.google.common.util.concurrent.ListenableFuture
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.AssumptionViolatedException
import org.junit.Test
import org.junit.runner.RunWith
import xyz.hahaen.radio.app.MainActivity
import xyz.hahaen.radio.playback.PlaybackConnection
import xyz.hahaen.radio.playback.RadioService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * Opt-in, audible device verification. No service binding occurs without haenLivePlayback=true.
 * The operator opens the App and starts a stable station while this test waits for readiness.
 * No Activity is launched by the test: vendor background-launch restrictions cannot block it
 * inside Instrumentation.startActivitySync. Its preparation wait has a two-minute bound.
 * This test never selects a station, changes an account/collection, or resets application data.
 * The sleep case leaves the station paused; the independent focus case restores via the system.
 */
@UnstableApi
@RunWith(AndroidJUnit4::class)
class LivePlaybackDeviceTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()

    @Test fun transientAudioFocusRecovers() = runLiveVerification(checkFocus = true, checkSleep = false)

    @Test fun oneMinuteSleepActuallyPauses() = runLiveVerification(checkFocus = false, checkSleep = true)

    private fun runLiveVerification(checkFocus: Boolean, checkSleep: Boolean) {
        assumeTrue("Live playback verification requires explicit haenLivePlayback=true.",
            InstrumentationRegistry.getArguments().getString("haenLivePlayback") == "true")
        val context = instrumentation.targetContext
        if (Build.VERSION.SDK_INT >= 33) assumeTrue(
            "Allow notifications before opting into live playback verification.",
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED,
        )

        var controllerFuture: ListenableFuture<MediaController>? = null
        var controller: MediaController? = null
        var ownsSleepTimer = false
        val audioManager = context.getSystemService(AudioManager::class.java)
        var focusRequest: AudioFocusRequest? = null
        val focusChanges = AtomicInteger(0)
        var focusGranted = false
        val events = ArrayDeque<String>()
        var eventsListener: Player.Listener? = null
        var failureDetails: () -> String = { "controllerPrepared=false" }
        try {
            lateinit var playback: PlaybackConnection
            awaitCondition(120_000, "Open HAEN and start a stable station within two minutes.") {
                onMain {
                    val activity = ActivityLifecycleMonitorRegistry.getInstance()
                        .getActivitiesInStage(Stage.RESUMED).filterIsInstance<MainActivity>().firstOrNull()
                    if (activity == null) false else {
                        playback = activity.playback
                        val state = playback.state.value
                        state.playing && !state.connecting && state.station != null && state.error == null
                    }
                }
            }
            val connecting = onMain {
                MediaController.Builder(context,
                    SessionToken(context, ComponentName(context, RadioService::class.java))).buildAsync()
            }
            controllerFuture = connecting
            val active = connecting.get(10, TimeUnit.SECONDS)
            controller = active
            val eventListener = object : Player.Listener {
                private fun record(event: String) {
                    if (events.size == 12) events.removeFirst()
                    events.addLast(event)
                }
                override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
                    record("playWhenReady=$playWhenReady,reason=${playWhenReadyReason(reason)}")
                }
                override fun onPlaybackSuppressionReasonChanged(playbackSuppressionReason: Int) {
                    record("suppression=${suppressionReason(playbackSuppressionReason)}")
                }
                override fun onIsPlayingChanged(isPlaying: Boolean) { record("isPlaying=$isPlaying") }
                override fun onPlaybackStateChanged(playbackState: Int) { record("state=${playbackPhase(playbackState)}") }
            }
            eventsListener = eventListener
            onMain { active.addListener(eventListener) }
            failureDetails = { onMain {
                val state = playback.state.value
                "controller={connected=${active.isConnected},playing=${active.isPlaying},playWhenReady=${active.playWhenReady}," +
                    "state=${playbackPhase(active.playbackState)},suppression=${suppressionReason(active.playbackSuppressionReason)}," +
                    "hasItem=${active.currentMediaItem != null},error=${active.playerError != null}};" +
                    "service={playing=${state.playing},connecting=${state.connecting},hasStation=${state.station != null},error=${state.error != null}};" +
                    "focus={granted=$focusGranted,lastChange=${focusChange(focusChanges.get())}};events=$events"
            } }
            awaitCondition(5_000, "The controller did not observe the prepared live playback.") {
                val state = snapshot(active)
                state.connected && state.playing && state.playWhenReady && state.ready &&
                    state.unsuppressed && state.hasItem && !state.error && playback.state.value.error == null
            }
            assumeTrue("An existing sleep timer must be canceled manually before this test.",
                playback.state.value.sleepRemainingMs == 0L)
            val originalItem = onMain { active.currentMediaItem?.mediaId }
            assertTrue("A playing station is required.", !originalItem.isNullOrEmpty())

            if (checkFocus) {
                // A separate focus listener makes this a different focus owner from ExoPlayer.
                // TRANSIENT (not MAY_DUCK) exercises suppression and automatic gain restoration.
                val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                    .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                    .setAcceptsDelayedFocusGain(false)
                    .setOnAudioFocusChangeListener({ focusChanges.set(it) }, Handler(Looper.getMainLooper()))
                    .build()
                focusRequest = request
                val focusResult = onMain { audioManager.requestAudioFocus(request) }
                focusGranted = focusResult == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
                assertEquals("The device must grant the temporary focus request.",
                    AudioManager.AUDIOFOCUS_REQUEST_GRANTED, focusResult)
                awaitCondition(5_000, "The real player did not enter transient audio-focus suppression.") {
                    val state = snapshot(active)
                    state.connected && !state.playing && state.playWhenReady && state.transientFocusLoss
                }
                val focusDeadline = SystemClock.elapsedRealtime() + 25_000
                while (SystemClock.elapsedRealtime() < focusDeadline) {
                    assertSameHealthyStation(active, playback, originalItem)
                    val state = snapshot(active)
                    assertTrue("Transient focus loss must preserve play intent.", state.playWhenReady)
                    assertTrue("Playback must remain suppressed while the test owns focus.", state.transientFocusLoss)
                    assertFalse("The real player must not play while focus is held.", state.playing)
                    assertTrue("Another focus owner interrupted this controlled verification.", focusChanges.get() >= 0)
                    assertTrue("A user sleep timer was started during focus verification.",
                        playback.state.value.sleepRemainingMs == 0L)
                    SystemClock.sleep(200)
                }
                assertEquals("The temporary focus request must be abandoned successfully.",
                    AudioManager.AUDIOFOCUS_REQUEST_GRANTED, onMain { audioManager.abandonAudioFocusRequest(request) })
                focusRequest = null
                awaitCondition(10_000, "The real player did not automatically resume after focus was released.") {
                    assertSameHealthyStation(active, playback, originalItem)
                    val state = snapshot(active)
                    state.playing && state.playWhenReady && state.unsuppressed
                }
            }

            if (checkSleep) {
                assumeTrue("A user sleep timer was started before the test timer.", playback.state.value.sleepRemainingMs == 0L)
                val timerStartedAt = SystemClock.elapsedRealtime()
                // Mark ownership before sending so even a command-result timeout is cleaned up.
                ownsSleepTimer = true
                assertEquals("The service must accept its actual one-minute sleep command.",
                    SessionResult.RESULT_SUCCESS, sleep(active, 1))
                awaitCondition(5_000, "The service did not start its one-minute sleep timer.") {
                    playback.state.value.sleepRemainingMs in 55_000L..60_000L
                }
                var lastRemaining = 60_000L
                val timerDeadline = timerStartedAt + 70_000
                while (true) {
                    assertSameHealthyStation(active, playback, originalItem)
                    val remaining = playback.state.value.sleepRemainingMs
                    assertTrue("Sleep time must count down monotonically.", remaining in 0L..lastRemaining)
                    lastRemaining = remaining
                    val elapsed = SystemClock.elapsedRealtime() - timerStartedAt
                    if (remaining == 0L) {
                        assertTrue("Sleep must not expire before a real minute (one-second sampling tolerance).", elapsed >= 59_000)
                        awaitCondition(2_000, "Sleep expired without pausing the real player.") {
                            val state = snapshot(active)
                            state.connected && !state.playWhenReady && !state.playing
                        }
                        assertTrue("Sleep must pause promptly after the real minute.",
                            SystemClock.elapsedRealtime() - timerStartedAt <= 65_000)
                        break
                    }
                    val state = snapshot(active)
                    assertTrue("Another focus owner interrupted the sleep verification.", state.unsuppressed)
                    // Leave one second for the service and controller snapshots to converge at
                    // expiry; before that, buffering or interruption cannot count as live playback.
                    if (elapsed < 59_000) {
                        assertTrue("Playback was paused before the sleep deadline.", state.playWhenReady)
                        assertTrue("The live source must remain ready before the sleep deadline.", state.ready)
                        assertTrue("The live source stopped playing before the sleep deadline.", state.playing)
                    }
                    assertTrue("The real sleep timer did not finish within its bound.",
                        SystemClock.elapsedRealtime() < timerDeadline)
                    SystemClock.sleep(200)
                }
                ownsSleepTimer = false
            }
        } catch (skipped: AssumptionViolatedException) {
            throw skipped
        } catch (assertion: AssertionError) {
            throw AssertionError("${assertion.message}; ${runCatching(failureDetails).getOrDefault("diagnosticsAvailable=false")}")
        } catch (_: Exception) {
            // Unexpected platform/connection exceptions may contain external details. Keep
            // diagnostics limited to booleans and platform enum values, including event history.
            throw AssertionError("Live playback verification failed; ${runCatching(failureDetails).getOrDefault("diagnosticsAvailable=false")}")
        } finally {
            // Always release focus. Do not call play() in cleanup: it could undo a user pause.
            try {
                focusRequest?.let { request -> onMain { audioManager.abandonAudioFocusRequest(request) } }
            } finally {
                try {
                    if (ownsSleepTimer) controller?.let { active ->
                        if (onMain { active.isConnected }) sleep(active, 0)
                    }
                } finally {
                    try {
                        eventsListener?.let { listener -> controller?.let { active -> onMain { active.removeListener(listener) } } }
                    } finally {
                        controllerFuture?.let { future -> onMain { MediaController.releaseFuture(future) } }
                    }
                }
            }
        }
    }

    private fun sleep(controller: MediaController, minutes: Int): Int {
        val result = onMain {
            controller.sendCustomCommand(SessionCommand(PlaybackConnection.SLEEP, Bundle.EMPTY),
                Bundle().apply { putInt("minutes", minutes) })
        }
        return result.get(5, TimeUnit.SECONDS).resultCode
    }

    private fun assertSameHealthyStation(controller: MediaController, playback: PlaybackConnection, originalItem: String?) {
        val state = snapshot(controller)
        assertTrue("The media controller disconnected during live verification.", state.connected)
        // Boolean equality deliberately keeps station identifiers and metadata out of failures.
        assertTrue("The station changed during live verification.", onMain { controller.currentMediaItem?.mediaId == originalItem })
        assertFalse("The live source failed; this run cannot verify the playback policy.", state.error)
        assertTrue("The service reported an error; this run cannot verify the playback policy.", playback.state.value.error == null)
    }

    private fun snapshot(controller: MediaController) = onMain {
        Snapshot(controller.isConnected, controller.isPlaying, controller.playWhenReady,
            controller.playbackState == Player.STATE_READY,
            controller.playbackSuppressionReason == Player.PLAYBACK_SUPPRESSION_REASON_NONE,
            controller.playbackSuppressionReason == Player.PLAYBACK_SUPPRESSION_REASON_TRANSIENT_AUDIO_FOCUS_LOSS,
            controller.currentMediaItem != null, controller.playerError != null)
    }

    private fun awaitCondition(timeoutMs: Long, message: String, condition: () -> Boolean) {
        val deadline = SystemClock.elapsedRealtime() + timeoutMs
        while (!condition()) {
            assertTrue(message, SystemClock.elapsedRealtime() < deadline)
            SystemClock.sleep(100)
        }
    }

    private fun <T> onMain(block: () -> T): T {
        var result: Result<T>? = null
        instrumentation.runOnMainSync { result = runCatching(block) }
        return checkNotNull(result).getOrThrow()
    }

    private fun playbackPhase(value: Int) = when (value) {
        Player.STATE_IDLE -> "IDLE"
        Player.STATE_BUFFERING -> "BUFFERING"
        Player.STATE_READY -> "READY"
        Player.STATE_ENDED -> "ENDED"
        else -> "OTHER($value)"
    }

    private fun suppressionReason(value: Int) = when (value) {
        Player.PLAYBACK_SUPPRESSION_REASON_NONE -> "NONE"
        Player.PLAYBACK_SUPPRESSION_REASON_TRANSIENT_AUDIO_FOCUS_LOSS -> "TRANSIENT_AUDIO_FOCUS_LOSS"
        else -> "OTHER($value)"
    }

    private fun playWhenReadyReason(value: Int) = when (value) {
        Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST -> "USER_REQUEST"
        Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_FOCUS_LOSS -> "AUDIO_FOCUS_LOSS"
        Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_BECOMING_NOISY -> "AUDIO_BECOMING_NOISY"
        else -> "OTHER($value)"
    }

    private fun focusChange(value: Int) = when (value) {
        0 -> "NO_CALLBACK"
        AudioManager.AUDIOFOCUS_GAIN -> "GAIN"
        AudioManager.AUDIOFOCUS_LOSS -> "LOSS"
        AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> "LOSS_TRANSIENT"
        AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> "LOSS_TRANSIENT_CAN_DUCK"
        else -> "OTHER($value)"
    }

    private data class Snapshot(val connected: Boolean, val playing: Boolean, val playWhenReady: Boolean,
        val ready: Boolean, val unsuppressed: Boolean, val transientFocusLoss: Boolean,
        val hasItem: Boolean, val error: Boolean)
}
