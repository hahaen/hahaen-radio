package xyz.hahaen.radio

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import okhttp3.*
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test
import xyz.hahaen.radio.data.remote.*
import java.util.concurrent.TimeUnit

class SessionCookieInterceptorTest {
    @Test fun lateLoginResponseCannotRestoreCookieAfterIdentityWasCleared() = runBlocking {
        MockWebServer().use { server ->
            val store = CookieFixture()
            val client = OkHttpClient.Builder().cookieJar(CookieJar.NO_COOKIES)
                .addInterceptor(SessionCookieInterceptor(store)).build()
            server.enqueue(MockResponse().setHeader("Set-Cookie", "haen_session=fixture; Path=/; HttpOnly").setHeadersDelay(200, TimeUnit.MILLISECONDS).setBody("{}"))
            val request = Request.Builder().url(server.url("/account/login")).build()
            val response = async(Dispatchers.IO) { client.newCall(request).execute().use { it.code } }
            assertNotNull(server.takeRequest(5, TimeUnit.SECONDS))
            store.clear()
            assertEquals(200, response.await())
            assertTrue(store.cookies.isEmpty())
        }
    }

    @Test fun freshResponseUsesSnapshotAndCallerCannotInjectCookieHeader() {
        MockWebServer().use { server ->
            val store = CookieFixture()
            val client = OkHttpClient.Builder().cookieJar(CookieJar.NO_COOKIES)
                .addInterceptor(SessionCookieInterceptor(store)).build()
            server.enqueue(MockResponse().setHeader("Set-Cookie", "haen_session=fixture; Path=/; HttpOnly").setBody("{}"))
            client.newCall(Request.Builder().url(server.url("/account/login")).header("Cookie", "accidental=fixture").build()).execute().close()
            assertNull(server.takeRequest().getHeader("Cookie"))
            assertEquals("fixture", store.cookies.single().value)
            server.enqueue(MockResponse().setBody("{}"))
            client.newCall(Request.Builder().url(server.url("/account/session")).build()).execute().close()
            assertEquals("haen_session=fixture", server.takeRequest().getHeader("Cookie"))
        }
    }

    @Test fun authenticatedResponseRefreshesExistingCookieDeadline() {
        MockWebServer().use { server ->
            val store = CookieFixture()
            val client = OkHttpClient.Builder().cookieJar(CookieJar.NO_COOKIES)
                .addInterceptor(SessionCookieInterceptor(store)).build()
            server.enqueue(MockResponse().setHeader("Set-Cookie", "haen_session=fixture; Path=/; HttpOnly; Max-Age=60").setBody("{}"))
            client.newCall(Request.Builder().url(server.url("/account/login")).build()).execute().close()
            val originalDeadline = store.cookies.single().expiresAt
            server.enqueue(MockResponse().setHeader("Set-Cookie", "haen_session=fixture; Path=/; HttpOnly; Max-Age=2592000").setBody("{}"))
            client.newCall(Request.Builder().url(server.url("/account/library")).build()).execute().close()
            assertEquals("fixture", store.cookies.single().value)
            assertTrue(store.cookies.single().expiresAt > originalDeadline + TimeUnit.DAYS.toMillis(29))
        }
    }

    private class CookieFixture : VersionedSessionCookies {
        private var generation = 0L
        var cookies: List<Cookie> = emptyList()
            private set
        @Synchronized fun clear() { generation++; cookies = emptyList() }
        @Synchronized override fun snapshot(url: HttpUrl) = SessionCookieSnapshot(generation, cookies)
        @Synchronized override fun receive(url: HttpUrl, cookies: List<Cookie>, generation: Long) {
            if (generation == this.generation && cookies.isNotEmpty()) this.cookies = cookies
        }
    }
}
