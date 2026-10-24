package xyz.hahaen.radio.data.remote

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import xyz.hahaen.radio.BuildConfig
import xyz.hahaen.radio.domain.AccountUser
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.inject.Inject
import javax.inject.Singleton

@Serializable private data class SessionRecord(val cookie: String? = null, val user: AccountUser? = null)

interface SessionStore {
    fun user(): AccountUser?
    fun setUser(user: AccountUser?)
    fun clear()
}

@Singleton class SecureSession @Inject constructor(@ApplicationContext context: Context, private val json: Json) : CookieJar, SessionStore, VersionedSessionCookies {
    private val prefs = context.getSharedPreferences("encrypted_session", Context.MODE_PRIVATE)
    private val origin = BuildConfig.API_BASE_URL.toHttpUrl()
    private var record = SessionRecord()
    private var generation = 0L
    private val alias = "haen.session.v1"
    init {
        record = runCatching { prefs.getString("ciphertext", null)?.let { json.decodeFromString<SessionRecord>(decrypt(it)) } }
            .onFailure { prefs.edit().clear().commit() }.getOrNull() ?: SessionRecord()
    }
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        return (store.getKey(alias, null) as? SecretKey) ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    private fun decrypt(value: String): String {
        val bytes = Base64.decode(value, Base64.NO_WRAP)
        require(bytes.size > 28)
        return Cipher.getInstance("AES/GCM/NoPadding").run { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0,12))); String(doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8) }
    }
    private fun persist() {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val encrypted = cipher.iv + cipher.doFinal(json.encodeToString(record).toByteArray(Charsets.UTF_8))
        check(prefs.edit().putString("ciphertext", Base64.encodeToString(encrypted, Base64.NO_WRAP)).commit())
    }
    @Synchronized override fun user(): AccountUser? {
        if (cookie()?.expiresAt?.let { it > System.currentTimeMillis() } != true) {
            clear()
            return null
        }
        return record.user
    }
    @Synchronized override fun setUser(user: AccountUser?) {
        if (user == null) { clear(); return }
        check(cookie()?.let { it.matches(origin) && it.expiresAt > System.currentTimeMillis() } == true) { "SESSION_COOKIE_MISSING" }
        record = record.copy(user = user)
        persist()
    }
    @Synchronized override fun clear() { generation++; record = SessionRecord(); check(prefs.edit().clear().commit()) }
    private fun cookie() = record.cookie?.let { Cookie.parse(origin, it) }
    private fun allowed(url: HttpUrl) = url.isHttps && url.host == origin.host && url.port == origin.port && url.encodedPath.startsWith(origin.encodedPath)
    @Synchronized override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        if (!allowed(url)) return
        cookies.lastOrNull { it.name == "haen_session" && it.hostOnly && it.domain == origin.host && it.secure && it.httpOnly && it.matches(origin) }?.let {
            if (it.expiresAt <= System.currentTimeMillis()) clear()
            else if (it.value.matches(Regex("[a-f0-9]{64}"))) { record = record.copy(cookie = it.toString()); persist() }
        }
    }
    @Synchronized override fun snapshot(url: HttpUrl) = SessionCookieSnapshot(generation, loadForRequest(url))
    @Synchronized override fun receive(url: HttpUrl, cookies: List<Cookie>, generation: Long) {
        if (generation == this.generation) saveFromResponse(url, cookies)
    }
    @Synchronized override fun loadForRequest(url: HttpUrl): List<Cookie> =
        if (!allowed(url)) emptyList() else listOfNotNull(cookie()?.takeIf { it.matches(url) && it.expiresAt > System.currentTimeMillis() })
}
