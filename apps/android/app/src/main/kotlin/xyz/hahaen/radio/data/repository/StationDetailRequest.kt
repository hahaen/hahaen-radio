package xyz.hahaen.radio.data.repository

import java.io.EOFException
import java.io.IOException
import java.net.SocketException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import xyz.hahaen.radio.data.remote.RadioApi
import xyz.hahaen.radio.data.remote.StationDto

internal suspend fun readStationDetail(api: RadioApi, id: String): StationDto {
    currentCoroutineContext().ensureActive()
    try {
        return api.station(id)
    } catch (error: IOException) {
        currentCoroutineContext().ensureActive()
        // OkHttp wraps header EOF; coroutine stack recovery may add one same-type copy.
        val cause = error.cause
        val headerEof = error.javaClass == IOException::class.java &&
            (cause is EOFException || (cause?.javaClass == IOException::class.java && cause.cause is EOFException))
        if (error !is SocketException && error !is EOFException && !headerEof) throw error
    }
    delay(300)
    currentCoroutineContext().ensureActive()
    return api.station(id)
}
