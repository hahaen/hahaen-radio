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

    @Test fun scansAllCountrySearchPagesAndChecksActualCountryAndAvailability() = runBlocking {
        MockWebServer().use { server ->
            val china = station(101)
            server.enqueue(MockResponse().setBody(json.encodeToString(StationPage((1..100).map { station(it, "GB") }, 103, 0, 100))))
            server.enqueue(MockResponse().setBody(json.encodeToString(StationPage(listOf(china, station(102, availability = "blocked"), station(103, genre = "religious")), 103, 100, 100))))
            assertEquals(china.model(), randomChinaStation(api(server)))
            assertEquals(2, server.requestCount)
            for (offset in listOf("0", "100")) {
                val url = server.takeRequest().requestUrl!!
                assertEquals("中国", url.queryParameter("q"))
                assertEquals(offset, url.queryParameter("offset"))
                assertEquals("100", url.queryParameter("limit"))
                assertEquals("true", url.queryParameter("playableOnly"))
            }
        }
    }

    @Test fun neverFallsBackAbroadWhenNoChinaStationIsAvailable() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody(json.encodeToString(StationPage(listOf(station(1, "GB")), 1, 0, 100))))
            assertEquals("NO_STATIONS", runCatching { randomChinaStation(api(server)) }.exceptionOrNull()?.message)
            assertEquals(1, server.requestCount)
        }
    }
}
