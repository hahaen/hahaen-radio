package xyz.hahaen.radio.playback

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Counts only uninterrupted, unsuppressed waiting for the current stream attempt. */
internal class PlaybackStallWatchdog(
    private val scope: CoroutineScope,
    private val timeoutMs: Long = 20_000,
    private val onTimeout: () -> Unit,
) {
    private data class Attempt(val generation: Long, val line: Int)
    private var attempt: Attempt? = null
    private var job: Job? = null

    fun update(generation: Long, line: Int, eligible: Boolean) {
        if (!eligible) { cancel(); return }
        val next = Attempt(generation, line)
        if (attempt == next && job?.isActive == true) return
        cancel()
        attempt = next
        job = scope.launch {
            delay(timeoutMs)
            if (attempt == next) {
                attempt = null
                job = null
                onTimeout()
            }
        }
    }

    fun cancel() {
        attempt = null
        job?.cancel()
        job = null
    }
}
