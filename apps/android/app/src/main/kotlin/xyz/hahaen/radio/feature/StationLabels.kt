package xyz.hahaen.radio.feature

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import xyz.hahaen.radio.R
import java.util.Locale

internal val browsableGenres = listOf("general", "pop", "news", "rock", "electronic", "world", "classical", "jazz", "folk", "hiphop")

@Composable internal fun genreLabel(id: String): String = stringResource(when (id) {
    "pop" -> R.string.genre_pop
    "news" -> R.string.genre_news
    "rock" -> R.string.genre_rock
    "electronic" -> R.string.genre_electronic
    "world" -> R.string.genre_world
    "classical" -> R.string.genre_classical
    "jazz" -> R.string.genre_jazz
    "folk" -> R.string.genre_folk
    "hiphop" -> R.string.genre_hiphop
    "religious" -> R.string.genre_religious
    else -> R.string.genre_general
})

@Composable internal fun languageLabel(id: String): String {
    val locale = LocalConfiguration.current.locales[0]
    return Locale.forLanguageTag(canonicalLanguageId(id)).getDisplayName(locale).takeIf { it.isNotBlank() } ?: id
}
