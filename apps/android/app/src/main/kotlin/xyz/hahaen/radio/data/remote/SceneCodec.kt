package xyz.hahaen.radio.data.remote

import kotlinx.serialization.json.*
import xyz.hahaen.radio.domain.Station

private val stationId = Regex("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
internal fun validStationId(id: String) = id.matches(stationId)

/** Mirrors the version 1 tuple in packages/contracts/src/scene.ts. */
fun decodeSceneEntry(entry: JsonArray): Station {
    require(entry.size == 13) { "SCENE_ENTRY_SHAPE" }
    fun text(index: Int, max: Int, nullable: Boolean = false): String? {
        if (entry[index] === JsonNull && nullable) return null
        val value = entry[index] as? JsonPrimitive ?: error("SCENE_ENTRY_TEXT")
        require(value.isString && value.content.length <= max) { "SCENE_ENTRY_TEXT" }
        return value.content
    }
    fun coordinate(index: Int, limit: Double): Double? {
        if (entry[index] === JsonNull) return null
        val value = entry[index] as? JsonPrimitive ?: error("SCENE_ENTRY_COORDINATE")
        require(!value.isString) { "SCENE_ENTRY_COORDINATE" }
        return requireNotNull(value.doubleOrNull).also { require(it.isFinite() && it in -limit..limit) }
    }
    val id = requireNotNull(text(0, 36)).also { require(validStationId(it)) }
    val name = requireNotNull(text(1, 512)).also { require(it.isNotBlank()) }
    val country = text(2, 2, true)?.also { require(it.matches(Regex("[A-Z]{2}"))) }
    val latitude = coordinate(6, 90.0)
    val longitude = coordinate(7, 180.0)
    val precision = requireNotNull(text(8, 32)).also { require(it in setOf("coordinates", "country", "unknown")) }
    val languages = (entry[10] as? JsonArray ?: error("SCENE_ENTRY_LANGUAGES")).also { require(it.size <= 32) }.map {
        val value = it as? JsonPrimitive ?: error("SCENE_ENTRY_LANGUAGE")
        require(value.isString && value.content.length in 1..64)
        value.content
    }
    val bitrate = if (entry[11] === JsonNull) null else {
        val value = entry[11] as? JsonPrimitive ?: error("SCENE_ENTRY_BITRATE")
        require(!value.isString)
        requireNotNull(value.intOrNull).also { require(it in 1..10_000) }
    }
    val availability = requireNotNull(text(12, 32)).also { require(it in setOf("available", "unavailable", "blocked", "unknown")) }
    return Station(id, name, country, text(3, 255, true), text(4, 255, true), text(5, 255, true),
        latitude, longitude, precision, requireNotNull(text(9, 64)), languages, bitrate, availability)
}
