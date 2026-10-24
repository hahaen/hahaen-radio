package xyz.hahaen.radio

import android.content.Context
import android.content.ContextWrapper
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.serialization.json.Json
import okhttp3.Cookie
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.*
import org.junit.Test
import xyz.hahaen.radio.data.remote.SecureSession
import xyz.hahaen.radio.domain.AccountUser

class SessionSecurityTest {
    @Test fun sessionSurvivesRecreationButNeverLeavesApiOriginOrPath() {
        val target = InstrumentationRegistry.getInstrumentation().targetContext
        val isolated = object : ContextWrapper(target) {
            override fun getSharedPreferences(name: String, mode: Int) = target.getSharedPreferences("test-$name",mode)
        }
        val json = Json { encodeDefaults = true }
        val session = SecureSession(isolated,json)
        session.clear()
        val api = BuildConfig.API_BASE_URL.toHttpUrl()
        val value = "a".repeat(64)
        val cookie = Cookie.Builder().name("haen_session").value(value).hostOnlyDomain(api.host)
            .path("/").secure().httpOnly().expiresAt(System.currentTimeMillis()+3600000).build()
        try {
            session.saveFromResponse(api,listOf(cookie))
            session.setUser(AccountUser("00000000-0000-4000-8000-000000000001","fixture"))
            val restored = SecureSession(isolated,json)
            assertEquals(1,restored.loadForRequest(api).size)
            assertEquals("fixture",restored.user()?.username)
            assertTrue(restored.loadForRequest("https://example.com/radio/api/v1/".toHttpUrl()).isEmpty())
            assertTrue(restored.loadForRequest("http://${api.host}/radio/api/v1/".toHttpUrl()).isEmpty())
            assertTrue(restored.loadForRequest("https://${api.host}/radio/assets/cover.jpg".toHttpUrl()).isEmpty())
            val raw = isolated.getSharedPreferences("encrypted_session",Context.MODE_PRIVATE).getString("ciphertext","")!!
            assertFalse(raw.contains(value)); assertFalse(raw.contains("fixture"))
            restored.clear()
            assertNull(SecureSession(isolated,json).user())
        } finally { session.clear() }
    }
    @Test fun rejectsBroadDomainWrongPathAndNonHttpOnlyCookiesAndClearsExpiredIdentity() {
        val target = InstrumentationRegistry.getInstrumentation().targetContext
        val isolated = object : ContextWrapper(target) {
            override fun getSharedPreferences(name: String, mode: Int) = target.getSharedPreferences("boundaries-$name", mode)
        }
        val session = SecureSession(isolated, Json { encodeDefaults = true })
        val api = BuildConfig.API_BASE_URL.toHttpUrl()
        val user = AccountUser("00000000-0000-4000-8000-000000000001", "fixture")
        fun cookie(path: String = "/", domain: Boolean = false, httpOnly: Boolean = true, expired: Boolean = false) =
            Cookie.Builder().name("haen_session").value("b".repeat(64)).apply {
                if (domain) domain(api.host) else hostOnlyDomain(api.host)
                path(path); secure()
                if (httpOnly) httpOnly()
                expiresAt(if (expired) 1 else System.currentTimeMillis() + 3_600_000)
            }.build()
        try {
            session.clear()
            session.saveFromResponse(api, listOf(cookie(domain = true), cookie(path = "/elsewhere"), cookie(httpOnly = false)))
            assertTrue(session.loadForRequest(api).isEmpty())
            session.saveFromResponse(api, listOf(cookie()))
            session.setUser(user)
            session.saveFromResponse(api, listOf(cookie(expired = true)))
            assertTrue(session.loadForRequest(api).isEmpty())
            assertNull(session.user())
            assertNull(SecureSession(isolated, Json).user())
            isolated.getSharedPreferences("encrypted_session", Context.MODE_PRIVATE).edit().putString("ciphertext", "corrupt").commit()
            assertNull(SecureSession(isolated, Json).user())
            assertFalse(isolated.getSharedPreferences("encrypted_session", Context.MODE_PRIVATE).contains("ciphertext"))
        } finally { session.clear() }
    }

}
