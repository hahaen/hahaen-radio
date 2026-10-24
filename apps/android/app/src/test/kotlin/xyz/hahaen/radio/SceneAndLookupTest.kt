package xyz.hahaen.radio

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import okhttp3.OkHttpClient
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import xyz.hahaen.radio.data.remote.*
import xyz.hahaen.radio.data.repository.lookupStations

class SceneAndLookupTest {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private fun id(number: Int) = "20000000-0000-4000-8000-${number.toString().padStart(12, '0')}"

    @Test fun sceneTupleKeepsCoordinatesLanguagesAndAvailabilityInContractOrder() {
        val entry = json.parseToJsonElement("""["${id(1)}","夜航","CN","浙江",null,"杭州",30.2,120.1,"coordinates","jazz",["zh","en"],128,"available"]""").jsonArray
        val station = decodeSceneEntry(entry)
        assertEquals("杭州", station.nearbyCity)
        assertEquals(30.2, station.latitude!!, 0.0)
        assertEquals(120.1, station.longitude!!, 0.0)
        assertEquals(listOf("zh", "en"), station.languages)
        assertEquals("jazz", station.genre)
        assertEquals(128, station.bitrate)
        assertEquals("available", station.availability)
    }

    @Test fun sceneTupleRejectsWrongArityOutOfRangeCoordinatesAndStringNumbers() {
        val valid = """["${id(1)}","夜航",null,null,null,null,30.2,120.1,"coordinates","jazz",[],128,"available"]"""
        for (value in listOf("[]", valid.replace("30.2", "130.2"), valid.replace("30.2", "\"30.2\""))) {
            assertTrue(runCatching { decodeSceneEntry(json.parseToJsonElement(value).jsonArray) }.isFailure)
        }
    }

    @Test fun lookupDeduplicatesAndSplitsIntoOneHundredStationRequests() = runBlocking {
        MockWebServer().use { server ->
            val ids = (1..201).map(::id)
            for (batch in ids.chunked(100)) server.enqueue(MockResponse().setBody(json.encodeToString(
                StationLookupResult(batch.map { StationDto(it, "Station", availability = "available") }, emptyList()))))
            val result = lookupStations(api(server), ids + ids.first())
            assertEquals(ids, result.map { it.id })
            assertEquals(3, server.requestCount)
            assertEquals(listOf(100, 100, 1), List(3) {
                val request = server.takeRequest()
                assertEquals("/radio/api/v1/stations/lookup", request.path)
                json.decodeFromString<StationLookup>(request.body.readUtf8()).ids.size
            })
        }
    }

    @Test fun emptyAndInvalidLookupNeverReachNetworkAndUnexpectedIdsAreRejected() = runBlocking {
        MockWebServer().use { server ->
            val api = api(server)
            assertTrue(lookupStations(api, emptyList()).isEmpty())
            assertTrue(runCatching { lookupStations(api, listOf("bad")) }.isFailure)
            assertTrue(runCatching { lookupStations(api, List(5001) { id(1) }) }.isFailure)
            assertEquals(0, server.requestCount)
            server.enqueue(MockResponse().setBody(json.encodeToString(StationLookupResult(listOf(StationDto(id(2), "Unexpected")), emptyList()))))
            assertTrue(runCatching { lookupStations(api, listOf(id(1))) }.isFailure)
        }
    }

    private fun api(server: MockWebServer) = Retrofit.Builder().baseUrl(server.url("/radio/api/v1/"))
        .client(OkHttpClient.Builder().retryOnConnectionFailure(false).build())
        .addConverterFactory(json.asConverterFactory("application/json".toMediaType())).build().create(RadioApi::class.java)
}
