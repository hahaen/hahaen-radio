package xyz.hahaen.radio

import org.junit.Assert.*
import org.junit.Test
import xyz.hahaen.radio.domain.Station
import xyz.hahaen.radio.feature.filterStations

class StationFiltersTest {
    private val jazz = Station("jazz", "Café Monde", countryCode = "FR", city = "Paris", genre = "jazz",
        languages = listOf("fr", "en"), bitrate = 192, availability = "available")
    private val news = Station("news", "World News", countryCode = "US", genre = "news",
        languages = listOf("english"), bitrate = 128, availability = "available")
    private val rock = Station("rock", "Rock Tokyo", countryCode = "JP", genre = "rock",
        languages = listOf("ja"), bitrate = 320, availability = "available")
    private val stations = listOf(jazz, news, rock)

    @Test fun genresAndLanguagesMatchAnySelectedValueWithinEachGroup() {
        assertEquals(listOf(jazz, rock), filterStations(stations, "", setOf("jazz", "rock"), setOf("fr", "ja"), 0))
        assertEquals(listOf(jazz), filterStations(stations, "", setOf("jazz", "rock"), setOf("fr"), 0))
    }

    @Test fun allAndExplicitlyEmptySelectionsAreDifferent() {
        assertEquals(stations, filterStations(stations, "", null, null, 0))
        assertTrue(filterStations(stations, "", emptySet(), null, 0).isEmpty())
        assertTrue(filterStations(stations, "", null, emptySet(), 0).isEmpty())
    }

    @Test fun emptyFavoritesNeverFallsThroughToTheWholeCatalog() {
        assertTrue(filterStations(stations, "", null, null, 0, emptySet()).isEmpty())
        assertEquals(listOf(news), filterStations(stations, "", null, null, 0, setOf(news.id)))
    }

    @Test fun favoritesApplyQueryGenresLanguagesAndBitrateTogether() {
        assertEquals(listOf(jazz), filterStations(stations, "paris", setOf("jazz", "news"), setOf("en"), 192,
            setOf(jazz.id, news.id)))
        assertTrue(filterStations(stations, "tokyo", null, null, 0, setOf(jazz.id, news.id)).isEmpty())
    }

    @Test fun searchFoldsAccentsWidthAndCaseAndRequiresAllTerms() {
        assertEquals(listOf(jazz), filterStations(stations, "ＣＡＦＥ paris", null, null, 0))
        assertTrue(filterStations(stations, "cafe tokyo", null, null, 0).isEmpty())
    }

    @Test fun countryNamesWorkInBothInterfaceLanguages() {
        assertEquals(listOf(news), filterStations(stations, "美国", null, null, 0))
        assertEquals(listOf(jazz), filterStations(stations, "france", null, null, 0))
    }

    @Test fun legacyLanguageNamesMatchCanonicalSelections() {
        assertEquals(listOf(jazz, news), filterStations(stations, "", null, setOf("en"), 0))
        assertEquals(listOf(jazz, news), filterStations(stations, "", null, setOf("English"), 0))
    }

    @Test fun unknownBitrateAndUnplayableStationsDoNotMatch() {
        val unknown = jazz.copy(id = "unknown", bitrate = null)
        val offline = rock.copy(id = "offline", availability = "unavailable")
        val excluded = news.copy(id = "excluded", genre = "religious")
        assertEquals(listOf(jazz), filterStations(listOf(unknown, offline, excluded, jazz), "", null, null, 192))
    }

    @Test fun duplicatesDoNotDestabilizePageOffsetsOrFavoriteCounts() {
        assertEquals(stations, filterStations(stations + stations, "", null, null, 0))
    }
}
