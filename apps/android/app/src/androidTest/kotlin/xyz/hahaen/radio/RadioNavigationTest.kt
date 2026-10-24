package xyz.hahaen.radio

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.rules.TestRule
import org.junit.runner.RunWith
import org.junit.runners.model.Statement
import xyz.hahaen.radio.app.MainActivity

@RunWith(AndroidJUnit4::class)
class RadioNavigationTest {
    private val compose = createAndroidComposeRule<MainActivity>()

    // A first-run system permission dialog is outside this navigation test. Do not change
    // the user's notification permission, account, collection, or saved preferences here.
    private val notificationPrerequisite = TestRule { base, _ ->
        object : Statement() {
            override fun evaluate() {
                val context = InstrumentationRegistry.getInstrumentation().targetContext
                if (Build.VERSION.SDK_INT >= 33) assumeTrue(
                    "Allow notifications once before this real-Activity UI test; no permission is changed by the test.",
                    context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED,
                )
                base.evaluate()
            }
        }
    }

    @get:Rule val rules: TestRule = RuleChain.outerRule(notificationPrerequisite).around(compose)

    @Test fun searchFiltersSurviveBackNavigationAndOpeningFiltersDismissesTheKeyboard() {
        val searchLabel = compose.activity.getString(R.string.search)
        val backLabel = compose.activity.getString(R.string.back)
        val genresLabel = compose.activity.getString(R.string.filter_genres)
        val generalLabel = compose.activity.getString(R.string.genre_general)
        val popLabel = compose.activity.getString(R.string.genre_pop)
        val query = "SomaFM"
        val before = compose.runOnIdle { compose.activity.playback.state.value }

        compose.onNodeWithContentDescription(searchLabel).performClick()
        compose.onNode(hasSetTextAction()).performClick().performTextReplacement(query)
        compose.waitUntil(timeoutMillis = 5_000) { isKeyboardVisible() }
        compose.onNodeWithText(compose.activity.getString(R.string.filters)).performClick()
        compose.waitUntil(timeoutMillis = 5_000) { !isKeyboardVisible() }
        compose.onNodeWithText(genresLabel).assertIsDisplayed()

        genreChip(generalLabel).performClick()
        genreChip(popLabel).performClick()
        genreChip(generalLabel).assertIsSelected()
        genreChip(popLabel).assertIsSelected()
        compose.onNodeWithText(compose.activity.getString(R.string.active_filters, 1)).assertIsDisplayed()

        compose.onNodeWithContentDescription(backLabel).performClick()
        compose.onNodeWithContentDescription(searchLabel).assertIsDisplayed().performClick()
        compose.onNode(hasSetTextAction()).assertTextContains(query)
        val filterButton = compose.onNodeWithText(compose.activity.getString(R.string.active_filters, 1))
        filterButton.assertIsDisplayed()
        if (compose.onAllNodesWithText(genresLabel).fetchSemanticsNodes().isEmpty()) filterButton.performClick()
        genreChip(generalLabel).assertIsSelected()
        genreChip(popLabel).assertIsSelected()
        compose.onNodeWithContentDescription(backLabel).performClick()
        compose.onNodeWithContentDescription(searchLabel).assertIsDisplayed()

        val after = compose.runOnIdle { compose.activity.playback.state.value }
        assertEquals("Navigation must not change the service volume", before.volume, after.volume, 0f)
        assertEquals("Navigation must not change the pin preference", before.pinned, after.pinned)
        // An already-playing live station can change state independently because of its network.
        // Initial country selection may complete while navigating, but never starts audio.
        if (before.station == null && !before.playing && !before.connecting) {
            after.station?.let { assertEquals("CN", it.countryCode) }
            assertFalse(after.playing)
            assertFalse(after.connecting)
        }
    }

    private fun isKeyboardVisible(): Boolean {
        var visible = false
        compose.activityRule.scenario.onActivity { activity ->
            visible = ViewCompat.getRootWindowInsets(activity.window.decorView)
                ?.isVisible(WindowInsetsCompat.Type.ime()) == true
        }
        return visible
    }

    private fun genreChip(label: String): SemanticsNodeInteraction {
        val matcher = SemanticsMatcher("selectable genre labelled $label") { node ->
            node.config.getOrNull(SemanticsProperties.Selected) != null &&
                node.config.getOrNull(SemanticsProperties.Text)?.any {
                    it.text == label || it.text.startsWith("$label  ")
                } == true
        }
        val horizontalList = SemanticsMatcher.keyIsDefined(SemanticsProperties.HorizontalScrollAxisRange) and hasScrollToIndexAction()
        compose.onAllNodes(horizontalList)[0].performScrollToNode(matcher)
        return compose.onNode(matcher)
    }
}
