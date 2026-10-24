package xyz.hahaen.radio

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test
import xyz.hahaen.radio.playback.PlaybackStallWatchdog

@OptIn(ExperimentalCoroutinesApi::class)
class PlaybackStallWatchdogTest {
    @Test fun temporaryFocusLossNeverConsumesTheStreamRetryBudget() = runTest {
        var failures = 0
        val watchdog = PlaybackStallWatchdog(this) { failures++ }
        watchdog.update(1, 0, eligible = true)
        advanceTimeBy(12_000)
        watchdog.update(1, 0, eligible = false)
        advanceTimeBy(60_000)
        assertEquals(0, failures)
        watchdog.update(1, 0, eligible = true)
        advanceTimeBy(19_999)
        assertEquals(0, failures)
        advanceTimeBy(1); runCurrent()
        assertEquals(1, failures)
    }

    @Test fun aNewStationAndAlternateLineEachInvalidateTheOldTimeout() = runTest {
        var failures = 0
        val watchdog = PlaybackStallWatchdog(this) { failures++ }
        watchdog.update(1, 0, eligible = true)
        advanceTimeBy(15_000)
        watchdog.update(2, 0, eligible = true)
        advanceTimeBy(15_000)
        assertEquals(0, failures)
        watchdog.update(2, 1, eligible = true)
        advanceTimeBy(19_999)
        assertEquals(0, failures)
        advanceTimeBy(1); runCurrent()
        assertEquals(1, failures)
    }

    @Test fun repeatedBufferEventsDoNotExtendTheTimeoutAndPauseCancelsIt() = runTest {
        var failures = 0
        val watchdog = PlaybackStallWatchdog(this) { failures++ }
        watchdog.update(1, 0, eligible = true)
        advanceTimeBy(15_000)
        watchdog.update(1, 0, eligible = true)
        advanceTimeBy(5_000); runCurrent()
        assertEquals(1, failures)
        watchdog.update(2, 0, eligible = true)
        advanceTimeBy(19_999)
        watchdog.cancel()
        advanceTimeBy(60_000)
        assertEquals(1, failures)
    }
}
