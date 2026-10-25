package xyz.hahaen.radio

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import xyz.hahaen.radio.data.remote.*
import xyz.hahaen.radio.data.repository.randomChinaStation

class InitialStationTest {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private fun station(index: Int, country: String = "CN", availability: String = "available", genre: String = "jazz") =
        StationDto("00000000-0000-4000-8000-${index.toString().padStart(12, '0')}", "中国测试 $index", countryCode = country,
            availability = availability, genre = genre)
    private fun api(server: MockWebServer): RadioApi = Retrofit.Builder().baseUrl(server.url("/radio/api/v1/"))
        .client(OkHttpClient.Builder().retryOnConnectionFailure(false).build())
        .addConverterFactory(json.asConverterFactory("application/json".toMediaType())).build().create(RadioApi::class.java)

    @Test fun readsAChinaStationAndStreamsInOneRequest() = runBlocking {
        MockWebServer().use { server ->
            val china = station(101).copy(streams = listOf(StreamDto("1".repeat(24), "https://radio.example/live.mp3")))
            server.enqueue(MockResponse().setBody(json.encodeToString(RandomStationResult(china))))
            assertEquals(china, randomChinaStation(api(server)))
            assertEquals(1, server.requestCount)
            assertEquals("/radio/api/v1/stations/random-china", server.takeRequest().path)
        }
    }

    @Test fun neverFallsBackWhenNoChinaStationIsAvailable() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody(json.encodeToString(RandomStationResult(null))))
            assertEquals("NO_STATIONS", runCatching { randomChinaStation(api(server)) }.exceptionOrNull()?.message)
            assertEquals(1, server.requestCount)
        }
    }

    @Test fun rejectsForeignBlockedReligiousAndEmptyCandidatesWithoutExtraRequests() = runBlocking {
        MockWebServer().use { server ->
            val valid = station(1).copy(streams = listOf(StreamDto("1".repeat(24), "https://radio.example/live.mp3")))
            for (candidate in listOf(valid.copy(countryCode = "GB"), valid.copy(availability = "blocked"),
                valid.copy(genre = "religious"), valid.copy(streams = emptyList()))) {
                server.enqueue(MockResponse().setBody(json.encodeToString(RandomStationResult(candidate))))
                assertEquals("NO_STATIONS", runCatching { randomChinaStation(api(server)) }.exceptionOrNull()?.message)
            }
            assertEquals(4, server.requestCount)
        }
    }
}
