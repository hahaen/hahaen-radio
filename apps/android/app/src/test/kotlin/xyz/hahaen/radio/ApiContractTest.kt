package xyz.hahaen.radio

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import xyz.hahaen.radio.data.remote.*
import xyz.hahaen.radio.domain.ListeningCollection

class ApiContractTest {
    @Test fun preservesGatewayPrefixAndNullableFields() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"items":[{"id":"00000000-0000-4000-8000-000000000001","name":"世界电台","countryCode":null,"futureField":true}],"total":1,"offset":0,"limit":30}"""))
            val api = api(server)
            val result = api.stations(q="世界",languages="zh",bitrate=128)
            assertEquals("世界电台",result.items.single().model().name)
            assertNull(result.items.single().countryCode)
            val request = server.takeRequest()
            assertTrue(request.path!!.startsWith("/radio/api/v1/stations?"))
            assertEquals("zh",request.requestUrl!!.queryParameter("languages"))
            assertEquals("128",request.requestUrl!!.queryParameter("minBitrate"))
        }
    }
    @Test fun conflictIsNotRetriedAsAnUnconditionalWrite() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(409).setBody("{}"))
            try { api(server).saveLibrary(SaveLibrary("owner",7,ListeningCollection())); fail("Expected conflict") }
            catch (error: HttpException) { assertEquals(409,error.code()) }
            assertEquals(1,server.requestCount)
            assertTrue(server.takeRequest().body.readUtf8().contains("\"revision\":7"))
        }
    }
    private fun api(server: MockWebServer): RadioApi = Retrofit.Builder().baseUrl(server.url("/radio/api/v1/"))
        .client(OkHttpClient.Builder().retryOnConnectionFailure(false).build())
        .addConverterFactory(Json { ignoreUnknownKeys=true }.asConverterFactory("application/json".toMediaType())).build().create(RadioApi::class.java)
}
