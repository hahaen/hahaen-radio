package xyz.hahaen.radio.data.remote

import okhttp3.Cookie
import okhttp3.HttpUrl
import okhttp3.Interceptor
import okhttp3.Response

/** CookieJar alone cannot tell which login generation produced a delayed response. */
data class SessionCookieSnapshot(val generation: Long, val cookies: List<Cookie>)
interface VersionedSessionCookies {
    fun snapshot(url: HttpUrl): SessionCookieSnapshot
    fun receive(url: HttpUrl, cookies: List<Cookie>, generation: Long)
}

class SessionCookieInterceptor(private val session: VersionedSessionCookies) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()
        val snapshot = session.snapshot(original.url)
        val request = original.newBuilder().removeHeader("Cookie").apply {
            if (snapshot.cookies.isNotEmpty()) header("Cookie", snapshot.cookies.joinToString("; ") { "${it.name}=${it.value}" })
        }.build()
        val response = chain.proceed(request)
        try {
            session.receive(request.url, Cookie.parseAll(request.url, response.headers), snapshot.generation)
        } catch (error: Exception) {
            response.close()
            throw error
        }
        return response
    }
}
