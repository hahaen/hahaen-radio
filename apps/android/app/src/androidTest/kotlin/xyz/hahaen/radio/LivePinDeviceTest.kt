package xyz.hahaen.radio

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.rules.TestRule
import org.junit.runner.RunWith
import org.junit.runners.model.Statement
import androidx.test.ext.junit.runners.AndroidJUnit4
import xyz.hahaen.radio.app.MainActivity

/** Opt-in pin interaction; restores the setting without changing account or station. */
@RunWith(AndroidJUnit4::class)
class LivePinDeviceTest {
    private val compose = createAndroidComposeRule<MainActivity>()
    private val enabled = TestRule { base, _ -> object : Statement() {
        override fun evaluate() {
            assumeTrue("Requires explicit haenLivePin=true", InstrumentationRegistry.getArguments().getString("haenLivePin") == "true")
            base.evaluate()
        }
    } }
    @get:Rule val rules: TestRule = RuleChain.outerRule(enabled).around(compose)

    @Test fun homeAndImmersivePinUpdateImmediatelyAndCanToggleRepeatedly() {
        compose.waitUntil(15_000) { compose.activity.playback.state.value.station != null }
        val original = compose.runOnIdle { compose.activity.playback.state.value }
        try {
            repeat(2) { screen ->
                if (screen == 1) compose.onNodeWithContentDescription(compose.activity.getString(R.string.immersive)).performClick()
                repeat(4) { index ->
                    val current = if (index % 2 == 0) original.pinned else !original.pinned
                    pin(current).assertSelected(current).performClick()
                    compose.waitUntil(5_000) {
                        compose.onAllNodesWithContentDescription(label(!current)).fetchSemanticsNodes().isNotEmpty()
                    }
                    pin(!current).assertSelected(!current)
                    compose.waitUntil(5_000) { compose.activity.playback.state.value.pinned == !current }
                }
                if (screen == 1) compose.onNodeWithContentDescription(compose.activity.getString(R.string.back)).performClick()
            }
            val after = compose.runOnIdle { compose.activity.playback.state.value }
            assertEquals(original.station?.id, after.station?.id)
            assertEquals(original.playing, after.playing)
        } finally {
            // Re-enter even a broken retained entry before restoring the setting.
            val back = compose.activity.getString(R.string.back)
            if (compose.onAllNodesWithContentDescription(back).fetchSemanticsNodes().isNotEmpty())
                compose.onNodeWithContentDescription(back).performClick()
            compose.onNodeWithContentDescription(compose.activity.getString(R.string.settings)).performClick()
            compose.onNodeWithContentDescription(back).performClick()
            if (compose.activity.playback.state.value.pinned != original.pinned) {
                pin(!original.pinned).performClick()
                compose.waitUntil(5_000) { compose.activity.playback.state.value.pinned == original.pinned }
            }
        }
    }
    private fun label(pinned: Boolean) = compose.activity.getString(if (pinned) R.string.unpin else R.string.pin)
    private fun pin(pinned: Boolean) = compose.onNodeWithContentDescription(label(pinned))
    private fun SemanticsNodeInteraction.assertSelected(selected: Boolean): SemanticsNodeInteraction =
        if (selected) assertIsSelected() else assertIsNotSelected()
}
