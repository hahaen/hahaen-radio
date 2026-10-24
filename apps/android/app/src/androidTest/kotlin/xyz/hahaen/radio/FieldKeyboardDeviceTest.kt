package xyz.hahaen.radio

import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import xyz.hahaen.radio.app.MainActivity
import xyz.hahaen.radio.app.theme.HaenTheme
import xyz.hahaen.radio.feature.NightField

@RunWith(AndroidJUnit4::class)
class FieldKeyboardDeviceTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Test fun searchUsernameAndPasswordCanReopenTheRealKeyboard() {
        // Exercise the production field without reading or changing the user's account.
        compose.activityRule.scenario.onActivity { activity ->
            activity.setContent {
                HaenTheme {
                    var query by remember { mutableStateOf("") }
                    var username by remember { mutableStateOf("") }
                    var password by remember { mutableStateOf("") }
                    Column(Modifier.imePadding()) {
                        NightField(query, { query = it }, R.string.search_hint,
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search))
                        NightField(username, { username = it }, R.string.username,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii, imeAction = ImeAction.Next))
                        NightField(password, { password = it }, R.string.password,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                            visualTransformation = PasswordVisualTransformation())
                    }
                }
            }
        }
        for (label in listOf(R.string.search_hint, R.string.username, R.string.password)) {
            val field = compose.onNode(hasSetTextAction() and hasText(compose.activity.getString(label)))
            repeat(2) {
                field.performTouchInput { click() }
                compose.waitUntil(5_000) { keyboardHeight() > 100 }
                field.assertIsFocused().performTextReplacement("test")
                // A hardware key can put some IMEs into a collapsed hardware-input panel.
                // A subsequent finger tap must request a usable on-screen keyboard again.
                InstrumentationRegistry.getInstrumentation().sendStringSync("x")
                Thread.sleep(500)
                field.performTouchInput { click() }
                compose.waitUntil(5_000) { keyboardHeight() > 100 }
                compose.activityRule.scenario.onActivity { activity ->
                    WindowInsetsControllerCompat(activity.window, activity.window.decorView)
                        .hide(WindowInsetsCompat.Type.ime())
                }
                compose.waitUntil(5_000) { keyboardHeight() == 0 }
                // Recovery must not reopen a keyboard deliberately dismissed by the user.
                Thread.sleep(800)
                check(keyboardHeight() == 0)
            }
        }
    }

    private fun keyboardHeight(): Int {
        var height = 0
        compose.activityRule.scenario.onActivity { activity ->
            height = ViewCompat.getRootWindowInsets(activity.window.decorView)
                ?.getInsets(WindowInsetsCompat.Type.ime())?.bottom ?: 0
        }
        return height
    }
}
