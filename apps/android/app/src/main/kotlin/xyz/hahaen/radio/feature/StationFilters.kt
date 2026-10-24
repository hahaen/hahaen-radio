package xyz.hahaen.radio.feature

import xyz.hahaen.radio.domain.Station
import java.text.Normalizer
import java.util.Locale

private val combiningMarks = Regex("\\p{M}+")
private val whitespace = Regex("\\s+")
private val shortLanguageTag = Regex("[a-z]{2}(?:-[a-z]{2})?")
private fun folded(value: String) = Normalizer.normalize(value, Normalizer.Form.NFKD)
    .replace(combiningMarks, "").lowercase(Locale.ROOT)

private val languageAliases by lazy {
    buildMap {
        Locale.getISOLanguages().forEach { code ->
            val locale = Locale.forLanguageTag(code)
            listOf(locale.getDisplayLanguage(Locale.ENGLISH), locale.getDisplayLanguage(Locale.CHINESE),
                locale.getDisplayLanguage(locale), runCatching { locale.isO3Language }.getOrDefault(code))
                .forEach { put(folded(it), code) }
        }
        putAll(mapOf("mandarin" to "zh", "cmn" to "zh", "普通话" to "zh", "国语" to "zh",
            "汉语" to "zh", "cantonese" to "yue", "广东话" to "yue", "fre" to "fr", "ger" to "de",
            "engilsh" to "en", "egnlish" to "en", "british english" to "en", "american english" to "en",
            "english uk" to "en", "en gb" to "en", "brazilian portuguese" to "pt-br"))
    }
}

internal fun canonicalLanguageId(value: String): String {
    val key = folded(value.trim().replace(whitespace, " ")).replace('_', '-')
    if (shortLanguageTag.matches(key)) return key
    return languageAliases[key] ?: key
}

private val countryNames by lazy {
    Locale.getISOCountries().associateWith { code ->
        val locale = Locale.Builder().setRegion(code).build()
        "${locale.getDisplayCountry(Locale.ENGLISH)} ${locale.getDisplayCountry(Locale.CHINESE)}"
    }
}

/** Null selections mean all; an explicit empty selection means no stations. */
internal fun filterStations(
    stations: List<Station>, query: String, genres: Set<String>?, languages: Set<String>?, bitrate: Int,
    favoriteIds: Set<String>? = null,
): List<Station> {
    if (genres?.isEmpty() == true || languages?.isEmpty() == true || favoriteIds?.isEmpty() == true) return emptyList()
    val terms = folded(query.trim()).split(whitespace).filter { it.isNotEmpty() }
    val canonicalLanguages = languages?.map(::canonicalLanguageId)?.toSet()
    val seen = HashSet<String>()
    return stations.filter { station ->
        station.availability == "available" && station.genre != "religious" &&
            (favoriteIds == null || station.id in favoriteIds) &&
            (genres == null || station.genre in genres) &&
            (canonicalLanguages == null || station.languages.any { canonicalLanguageId(it) in canonicalLanguages }) &&
            (bitrate == 0 || (station.bitrate ?: 0) >= bitrate) &&
            (terms.isEmpty() || folded(listOfNotNull(station.name, station.region, station.city,
                station.nearbyCity, station.countryCode, station.countryCode?.let(countryNames::get)).joinToString(" "))
                .let { searchable -> terms.all(searchable::contains) }) && seen.add(station.id)
    }
}
