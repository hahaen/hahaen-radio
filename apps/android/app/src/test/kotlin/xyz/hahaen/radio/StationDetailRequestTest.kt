package xyz.hahaen.radio

import java.io.EOFException
import java.io.IOException
import java.net.ProtocolException
import java.net.SocketException
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLHandshakeException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.Assert.*
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import xyz.hahaen.radio.data.remote.RadioApi
import xyz.hahaen.radio.data.remote.StationDto
import xyz.hahaen.radio.data.repository.readStationDetail

@OptIn(ExperimentalCoroutinesApi::class)
class StationDetailRequestTest {
    @Test fun retriesOnceAfterTheServerClosesBeforeResponseHeaders() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(disconnect())
            server.enqueue(success())
            assertEquals(ID, readStationDetail(api(server), ID).id)
            assertEquals(2, server.requestCount)
            repeat(2) {
                val request = server.takeRequest()
                assertEquals("GET", request.method)
                assertEquals("/radio/api/v1/stations/$ID", request.path)
            }
        }
    }

    @Test fun retriesDirectSocketFailureWithTheSameApi() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(success())
            var attempts = 0
            val api = api(server, Interceptor { chain ->
                if (++attempts == 1) throw SocketException("TEST_CONNECTION_RESET")
                chain.proceed(chain.request())
            })
            assertEquals(ID, readStationDetail(api, ID).id)
            assertEquals(2, attempts)
            assertEquals(1, server.requestCount)
        }
    }

    @Test fun aSecondDisconnectIsFinalEvenWithASuccessQueued() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(disconnect())
            server.enqueue(disconnect())
            server.enqueue(success())
            expectFailure<IOException> { readStationDetail(api(server), ID) }
            assertEquals(2, server.requestCount)
        }
    }

    @Test fun cancellationDuringBackoffPreventsAnotherRequest() = runTest {
        MockWebServer().use { server ->
            server.enqueue(disconnect())
            server.enqueue(success())
            val delegate = api(server)
            val failed = CompletableDeferred<Unit>()
            val observed = object : RadioApi by delegate {
                override suspend fun station(id: String): StationDto = try {
                    delegate.station(id)
                } catch (error: IOException) {
                    failed.complete(Unit)
                    throw error
                }
            }
            val result = async { readStationDetail(observed, ID) }
            failed.await()
            runCurrent()
            advanceTimeBy(299)
            runCurrent()
            assertTrue(result.isActive)
            assertEquals(1, server.requestCount)
            result.cancel()
            expectFailure<CancellationException> { result.await() }
            advanceTimeBy(1000)
            runCurrent()
            assertEquals(1, server.requestCount)
        }
    }

    @Test fun httpFailureIsNotRetried() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(503).setBody("{}"))
            server.enqueue(success())
            val error = expectFailure<HttpException> { readStationDetail(api(server), ID) }
            assertEquals(503, error.code())
            assertEquals(1, server.requestCount)
        }
    }

    @Test fun invalidJsonIsNotRetried() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("{\"id\":"))
            server.enqueue(success())
            expectFailure<SerializationException> { readStationDetail(api(server), ID) }
            assertEquals(1, server.requestCount)
        }
    }

    @Test fun responseLimitFailureIsNotRetried() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(success())
            server.enqueue(success())
            val limitFailure = IOException("RESPONSE_TOO_LARGE")
            val api = api(server, Interceptor { chain ->
                // The response-size guard reports an ordinary IOException at this boundary.
                chain.proceed(chain.request()).use { throw limitFailure }
            })
            val error = expectFailure<IOException> { readStationDetail(api, ID) }
            assertEquals(IOException::class.java, error.javaClass)
            assertEquals("RESPONSE_TOO_LARGE", error.message)
            assertEquals(1, server.requestCount)
        }
    }

    @Test fun protocolAndTlsFailuresDoNotBecomeRetryableThroughTheirEofCause() = runBlocking {
        for (error in listOf(
            ProtocolException("TEST_PROTOCOL").apply { initCause(EOFException()) },
            SSLHandshakeException("TEST_TLS").apply { initCause(EOFException()) },
        )) {
            MockWebServer().use { server ->
                var attempts = 0
                val api = api(server, Interceptor { attempts++; throw error })
                assertEquals(error.javaClass, expectFailure<IOException> { readStationDetail(api, ID) }.javaClass)
                assertEquals(1, attempts)
                assertEquals(0, server.requestCount)
            }
        }
    }

    @Test fun nestedTlsProtocolAndDeeperIoChainsAreNotRetried() = runBlocking {
        val failures = listOf(
            IOException(SSLHandshakeException("TEST_TLS").apply { initCause(EOFException()) }),
            IOException(ProtocolException("TEST_PROTOCOL").apply { initCause(EOFException()) }),
            IOException(IOException(IOException(EOFException()))),
        )
        MockWebServer().use { server ->
            val delegate = api(server)
            for (error in failures) {
                var attempts = 0
                val failing = object : RadioApi by delegate {
                    override suspend fun station(id: String): StationDto {
                        attempts++
                        throw error
                    }
                }
                expectFailure<IOException> { readStationDetail(failing, ID) }
                assertEquals(1, attempts)
            }
            assertEquals(0, server.requestCount)
        }
    }

    private fun disconnect() = MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST)
    private fun success() = MockResponse().setBody("""{"id":"$ID","name":"Test station"}""")
    private fun api(server: MockWebServer, interceptor: Interceptor? = null): RadioApi {
        val client = OkHttpClient.Builder().retryOnConnectionFailure(false)
            .callTimeout(2, TimeUnit.SECONDS)
            .apply { if (interceptor != null) addInterceptor(interceptor) }.build()
        return Retrofit.Builder().baseUrl(server.url("/radio/api/v1/"))
            .client(client)
            .addConverterFactory(Json.asConverterFactory("application/json".toMediaType()))
            .build().create(RadioApi::class.java)
    }

    private suspend inline fun <reified T : Throwable> expectFailure(block: suspend () -> Unit): T {
        try {
            block()
        } catch (error: Throwable) {
            if (error is T) return error
            throw AssertionError("Expected ${T::class.java.simpleName}, got ${error.javaClass.simpleName}", error)
        }
        throw AssertionError("Expected ${T::class.java.simpleName}")
    }

    private companion object { const val ID = "00000000-0000-4000-8000-000000000001" }
}
