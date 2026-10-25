package xyz.hahaen.radio.domain

import kotlinx.serialization.Serializable

@Serializable
data class Station(
    val id: String, val name: String, val countryCode: String? = null,
    val region: String? = null, val city: String? = null, val nearbyCity: String? = null,
    val latitude: Double? = null, val longitude: Double? = null,
    val locationPrecision: String = "unknown", val genre: String = "general",
    val languages: List<String> = emptyList(), val bitrate: Int? = null,
    val availability: String = "unknown",
) {
    val location: String get() = listOfNotNull(city ?: nearbyCity, region, countryCode).distinct().joinToString(" · ")
}

@Serializable data class SavedStation(val id: String, val name: String, val countryCode: String? = null, val savedAt: Long) {
    fun station() = Station(id, name, countryCode)
}
@Serializable data class SavedSong(val artist: String, val title: String, val savedAt: Long)
@Serializable data class ListeningCollection(
    val favorites: List<SavedStation> = emptyList(),
    val songs: List<SavedSong> = emptyList(),
    val history: List<SavedStation> = emptyList(),
    val pinned: Boolean = false,
)
@Serializable data class AccountUser(val id: String, val username: String)
@Serializable data class Library(val revision: Int = 0, val collection: ListeningCollection = ListeningCollection())
@Serializable data class LibraryOperation(val kind: String, val station: SavedStation? = null, val pinned: Boolean? = null)

fun applyOperations(base: ListeningCollection, operations: List<LibraryOperation>): ListeningCollection {
    var result = base
    for (operation in operations) {
        val station = operation.station
        result = when (operation.kind) {
            "favorite.add" -> if (station == null) result else result.copy(favorites =
                (listOf(station) + result.favorites.filterNot { it.id == station.id }).take(5000))
            "favorite.remove" -> result.copy(favorites = result.favorites.filterNot { it.id == station?.id })
            "history.add" -> if (station == null) result else result.copy(history =
                (result.history + station).groupBy { it.id }.values.map { group -> group.maxBy { it.savedAt } }
                    .sortedByDescending { it.savedAt }.take(100))
            "pin.set" -> result.copy(pinned = requireNotNull(operation.pinned))
            "history.clear" -> result.copy(history = emptyList())
            else -> result
        }
    }
    return result
}

data class PlaybackState(
    val station: Station? = null, val playing: Boolean = false, val connecting: Boolean = false,
    val error: String? = null, val sleepRemainingMs: Long = 0, val pinned: Boolean = false,
    val volume: Float = 1f,
)

/** Fail closed on a malformed account payload without overwriting the last local copy. */
class InvalidLibraryData : Exception("INVALID_LIBRARY_DATA")

private val uuidPattern = Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
private const val MAX_SAVED_AT = 8_640_000_000_000_000L
private fun validText(value: String) = value.length in 1..512 && value.trim().isNotEmpty()
private fun SavedStation.valid() = id.matches(uuidPattern) && validText(name) &&
    (countryCode == null || countryCode.matches(Regex("[A-Z]{2}"))) && savedAt in 0..MAX_SAVED_AT

fun AccountUser.validated(): AccountUser = also {
    if (!id.matches(uuidPattern) || username.isBlank() || username.length > 32) throw InvalidLibraryData()
}

fun LibraryOperation.validated(): LibraryOperation = also {
    if (kind !in setOf("favorite.add", "favorite.remove", "history.add", "history.clear", "pin.set") ||
        (kind !in setOf("history.clear", "pin.set") && station?.valid() != true) ||
        (kind == "pin.set" && pinned == null)) throw InvalidLibraryData()
}

fun Library.validated(): Library = also {
    val favorites = collection.favorites
    val history = collection.history
    val songs = collection.songs
    if (revision !in 0..2_147_483_646 || favorites.size > 5000 || history.size > 100 || songs.size > 5000 ||
        favorites.any { !it.valid() } || history.any { !it.valid() } ||
        favorites.map { it.id.lowercase(java.util.Locale.ROOT) }.distinct().size != favorites.size ||
        history.map { it.id.lowercase(java.util.Locale.ROOT) }.distinct().size != history.size ||
        songs.any { !validText(it.artist) || !validText(it.title) || it.savedAt !in 0..MAX_SAVED_AT } ||
        songs.map { listOf(it.artist, it.title).map { text ->
            java.text.Normalizer.normalize(text, java.text.Normalizer.Form.NFKC).trim()
                .replace(Regex("[\\s\\p{Z}\\uFEFF]+"), " ").lowercase(java.util.Locale.ROOT)
        } }.distinct().size != songs.size) throw InvalidLibraryData()
}
