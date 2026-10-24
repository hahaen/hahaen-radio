package xyz.hahaen.radio

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import xyz.hahaen.radio.app.MainActivity

/** Run from a stopped app; no account, collection or preference is changed. */
class InitialStationDeviceTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Test fun coldEntrySelectsChinaWithoutStartingAudioAndReturnKeepsSelection() {
        compose.waitUntil(timeoutMillis = 30_000) { compose.activity.playback.state.value.station != null }
        val before = compose.runOnIdle { compose.activity.playback.state.value }
        assertEquals("CN", before.station?.countryCode)
        assertFalse(before.playing)
        assertFalse(before.connecting)
        assertNull(before.error)
        compose.activityRule.scenario.recreate()
        compose.waitForIdle()
        val after = compose.runOnIdle { compose.activity.playback.state.value }
        assertEquals(before.station?.id, after.station?.id)
        assertFalse(after.playing)
        assertFalse(after.connecting)
    }
}
