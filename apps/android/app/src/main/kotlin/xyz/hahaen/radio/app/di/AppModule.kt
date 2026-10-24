package xyz.hahaen.radio.app.di

import android.content.Context
import androidx.room.Room
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.json.Json
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import xyz.hahaen.radio.BuildConfig
import xyz.hahaen.radio.data.local.RadioDatabase
import xyz.hahaen.radio.data.remote.*
import java.io.IOException
import java.util.concurrent.TimeUnit
import javax.inject.Singleton

@Module @InstallIn(SingletonComponent::class) object AppModule {
    @Provides @Singleton fun json() = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    @Provides @Singleton fun database(@ApplicationContext context: Context) = Room.databaseBuilder(context, RadioDatabase::class.java, "haen.db").build()
    @Provides @Singleton fun api(session: SecureSession, json: Json): RadioApi {
        val client = OkHttpClient.Builder().cookieJar(CookieJar.NO_COOKIES).addInterceptor(SessionCookieInterceptor(session)).followRedirects(false).followSslRedirects(false)
            .connectTimeout(12, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).callTimeout(30, TimeUnit.SECONDS)
            .retryOnConnectionFailure(false)
            .addInterceptor { chain ->
                val request = chain.request().newBuilder().header("x-haen-request", "1").build()
                val response = chain.proceed(request)
                val body = response.body
                val contentType = body.contentType()
                val bytes = body.use {
                    val source = it.source()
                    if (source.request(24L * 1024 * 1024 + 1)) throw IOException("RESPONSE_TOO_LARGE")
                    source.readByteArray()
                }
                response.newBuilder().body(bytes.toResponseBody(contentType)).build()
            }.build()
        return Retrofit.Builder().baseUrl(BuildConfig.API_BASE_URL).client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType())).build().create(RadioApi::class.java)
    }
}
