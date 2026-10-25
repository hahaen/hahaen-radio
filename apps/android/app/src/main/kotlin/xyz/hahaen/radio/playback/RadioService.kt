package xyz.hahaen.radio.playback

import android.app.PendingIntent
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.os.Bundle
import android.os.SystemClock
import androidx.media3.common.*
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.session.*
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.update
import okhttp3.OkHttpClient
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import xyz.hahaen.radio.app.MainActivity
import xyz.hahaen.radio.R
import xyz.hahaen.radio.data.local.Preferences
import xyz.hahaen.radio.data.remote.StationDto
import xyz.hahaen.radio.data.remote.StreamDto
import xyz.hahaen.radio.data.repository.CatalogRepository
import xyz.hahaen.radio.data.repository.LibraryRepository
import xyz.hahaen.radio.domain.Station
import java.io.ByteArrayOutputStream
import java.util.concurrent.TimeUnit
import javax.inject.Inject

@UnstableApi @AndroidEntryPoint class RadioService : MediaSessionService() {
    @Inject lateinit var catalog: CatalogRepository
    @Inject lateinit var library: LibraryRepository
    @Inject lateinit var connection: PlaybackConnection
    @Inject lateinit var preferences: Preferences
    private lateinit var player: ExoPlayer
    private lateinit var sessionPlayer: RadioSessionPlayer
    private var session: MediaSession? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var resolving: Job? = null
    private var preparingInitial = false
    private var preparedDetail: StationDto? = null
    private val watchdog = PlaybackStallWatchdog(scope) { if (shouldWatchForStall()) failedLine() }
    private var sleepJob: Job? = null
    private var generation = 0L
    private var intent = false
    private var switching = false
    private var streams: List<StreamDto> = emptyList()
    private var line = 0
    private var recoveryStations = 0
    private var heardId: String? = null
    private var requestedStationId: String? = null
    private var requestedRandomStation = false
    private var pendingItem: MediaItem? = null
    private val previous = ArrayDeque<String>()
    private val brandArtwork by lazy { createBrandArtwork() }

    override fun onCreate() {
        super.onCreate()
        setMediaNotificationProvider(DefaultMediaNotificationProvider.Builder(this)
            .setChannelName(R.string.media_channel_name).build().apply { setSmallIcon(R.drawable.ic_notification_radio) })
        val audioClient = OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS).retryOnConnectionFailure(false).build()
        val factory = DefaultMediaSourceFactory(this).setDataSourceFactory(OkHttpDataSource.Factory(audioClient).setUserAgent("HAEN-Android/0.1"))
            .setLoadErrorHandlingPolicy(DefaultLoadErrorHandlingPolicy(0))
        player = ExoPlayer.Builder(this).setMediaSourceFactory(factory).build().apply {
            setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
            setHandleAudioBecomingNoisy(true)
            setWakeMode(C.WAKE_MODE_NETWORK)
            addListener(listener)
        }
        sessionPlayer = RadioSessionPlayer(player, onPlay = ::resume, onPause = ::pausePlayback,
            onStop = { pausePlayback(); player.stop() },
            onNext = { recoveryStations = 0; nextStation() }, onPrevious = ::previousStation,
            decorateMetadata = ::mediaCardMetadata)
        val activity = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        session = MediaSession.Builder(this, sessionPlayer).setSessionActivity(activity).setCallback(object : MediaSession.Callback {
            override fun onConnect(session: MediaSession, controller: MediaSession.ControllerInfo): MediaSession.ConnectionResult {
                val commands = MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.buildUpon()
                if (controller.packageName == packageName) PlaybackConnection.COMMANDS.forEach { commands.add(SessionCommand(it, Bundle.EMPTY)) }
                return MediaSession.ConnectionResult.AcceptedResultBuilder(session).setAvailableSessionCommands(commands.build()).build()
            }
            override fun onCustomCommand(session: MediaSession, controller: MediaSession.ControllerInfo, customCommand: SessionCommand, args: Bundle): ListenableFuture<SessionResult> {
                if (controller.packageName != packageName) return Futures.immediateFuture(SessionResult(SessionError.ERROR_PERMISSION_DENIED))
                when (customCommand.customAction) {
                    PlaybackConnection.PREPARE -> prepareInitialStation()
                    PlaybackConnection.SELECT -> args.getString("id")?.takeIf { ID.matches(it) }?.let { recoveryStations = 0; select(it) }
                    PlaybackConnection.TOGGLE -> if (intent || player.isPlaying) pausePlayback() else resume()
                    PlaybackConnection.NEXT -> { recoveryStations = 0; nextStation() }
                    PlaybackConnection.PREVIOUS -> previousStation()
                    PlaybackConnection.SLEEP -> setSleep(args.getInt("minutes").coerceIn(0, 180))
                    PlaybackConnection.VOLUME -> {
                        player.volume = args.getFloat("volume", 1f).takeIf { it.isFinite() }?.coerceIn(0f,1f) ?: 1f
                        publish()
                    }
                    else -> return Futures.immediateFuture(SessionResult(SessionError.ERROR_NOT_SUPPORTED))
                }
                return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
            }
        }).build()
        setListener(object : MediaSessionService.Listener {
            override fun onForegroundServiceStartNotAllowedException() { fail("service") }
        })
        scope.launch { combine(preferences.state, library.pinned) { local, account -> account ?: local.pinned }
            .collect { value -> connection.mutable.update { it.copy(pinned = value) } } }
        publish()
    }

    private val listener = object : Player.Listener {
        override fun onIsPlayingChanged(isPlaying: Boolean) {
            publish()
            if (isPlaying) {
                val station = connection.state.value.station
                if (station != null && heardId != station.id) { heardId = station.id; scope.launch { library.heard(station) } }
            }
        }
        override fun onPlaybackStateChanged(state: Int) {
            publish()
            if (state == Player.STATE_ENDED && intent && pendingItem == null) failedLine()
        }
        override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
            if (!playWhenReady && !switching && (reason == Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_FOCUS_LOSS ||
                    reason == Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_BECOMING_NOISY)) pausePlayback()
            publish()
        }
        override fun onPlaybackSuppressionReasonChanged(playbackSuppressionReason: Int) {
            publish()
            if (playbackSuppressionReason == Player.PLAYBACK_SUPPRESSION_REASON_NONE && intent && pendingItem == null &&
                (player.playbackState == Player.STATE_ENDED || player.playerError != null)) failedLine()
        }
        override fun onPlayerError(error: PlaybackException) {
            if (intent && resolving == null && player.currentMediaItem?.mediaId == connection.state.value.station?.id) failedLine() else publish()
        }
        override fun onVolumeChanged(volume: Float) { publish() }
    }
    private fun publish() {
        connection.mutable.update { it.copy(playing = player.isPlaying, volume = player.volume,
            connecting = intent && (pendingItem != null || player.playbackState == Player.STATE_BUFFERING)) }
        if (::sessionPlayer.isInitialized) sessionPlayer.updatePending(pendingItem, intent, connection.state.value.error != null)
        updateWatchdog()
    }
    private fun pausePlayback() {
        intent = false; generation++; resolving?.cancel(); resolving = null; preparingInitial = false; watchdog.cancel()
        player.pause(); publish()
    }
    private fun resume() {
        if (preparingInitial && resolving?.isActive == true) {
            intent = true
            pendingItem = pendingMediaItem("haen:initial", null)
            publish()
            return
        }
        if (intent && (resolving?.isActive == true || player.playWhenReady)) return
        if (requestedRandomStation) { recoveryStations = 0; nextStation(); return }
        val id = requestedStationId ?: connection.requestedStationId ?: connection.state.value.station?.id
        if (id == null) { nextStation(); return }
        if (pendingItem != null || streams.isEmpty() || player.currentMediaItem?.mediaId != id ||
            player.playerError != null || player.playbackState == Player.STATE_IDLE) {
            recoveryStations = 0; select(id, rememberPrevious = false); return
        }
        intent = true; connection.mutable.update { it.copy(error = null) }; player.play(); publish()
    }
    private fun select(id: String, rememberPrevious: Boolean = true, ready: StationDto? = null) {
        val prepared = ready ?: preparedDetail?.takeIf { it.id == id }
        preparedDetail = null
        val old = connection.state.value.station
        if (rememberPrevious && old != null && old.id != id) { previous.addLast(old.id); if (previous.size > 100) previous.removeFirst() }
        pausePlayback()
        val expected = ++generation
        requestedStationId = id; connection.requestedStationId = id; requestedRandomStation = false
        val target = catalog.scene.value.firstOrNull { it.id == id } ?: old?.takeIf { it.id == id }
        pendingItem = pendingMediaItem(id, target)
        intent = true; heardId = null; streams = emptyList(); line = 0
        switching = true; player.stop(); player.clearMediaItems(); switching = false
        connection.mutable.update { it.copy(connecting = true, error = null, playing = false) }
        publish()
        resolving = scope.launch(start = CoroutineStart.LAZY) {
            try {
                val detail = prepared ?: catalog.station(id)
                ensureActive()
                if (generation != expected || !intent) return@launch
                streams = detail.streams.filter { it.url.toHttpUrlOrNull()?.let { url -> url.isHttps && url.username.isEmpty() && url.password.isEmpty() } == true }.take(3)
                connection.mutable.update { it.copy(station = detail.model()) }
                resolving = null
                if (streams.isEmpty()) failedLine() else startLine()
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { if (generation == expected) fail("network") }
        }
        resolving?.start()
    }
    private fun startLine() {
        if (!intent) return
        val station = connection.state.value.station ?: return
        val stream = streams.getOrNull(line) ?: run { fail("stream"); return }
        val item = MediaItem.Builder().setMediaId(station.id).setUri(stream.url)
            .setLiveConfiguration(MediaItem.LiveConfiguration.Builder().build())
            .setMediaMetadata(MediaMetadata.Builder().setTitle(station.name).setArtist(station.location)
                .setIsBrowsable(false).setIsPlayable(true).setMediaType(MediaMetadata.MEDIA_TYPE_RADIO_STATION).build())
            .apply { if (stream.hls) setMimeType(MimeTypes.APPLICATION_M3U8) }.build()
        player.setMediaItem(item); player.prepare(); player.play()
        pendingItem = null
        publish()
    }
    private fun shouldWatchForStall(): Boolean = intent && pendingItem == null && resolving == null &&
        player.playWhenReady && !player.isPlaying &&
        player.playbackSuppressionReason == Player.PLAYBACK_SUPPRESSION_REASON_NONE &&
        (player.playbackState == Player.STATE_BUFFERING || player.playbackState == Player.STATE_READY)
    private fun updateWatchdog() {
        watchdog.update(generation, line, shouldWatchForStall())
    }
    private fun failedLine() {
        watchdog.cancel()
        if (!intent || (pendingItem == null && player.playbackSuppressionReason != Player.PLAYBACK_SUPPRESSION_REASON_NONE)) return
        if (++line < streams.size) { startLine(); return }
        if (!connection.state.value.pinned && recoveryStations++ < 2) nextStation() else fail("stream")
    }
    private fun fail(code: String) { pausePlayback(); connection.mutable.update { it.copy(error = code) }; publish() }
    private fun prepareInitialStation() {
        if (connection.state.value.station != null || resolving != null || requestedStationId != null || intent) return
        val expected = generation
        preparingInitial = true
        resolving = scope.launch {
            try {
                val station = catalog.randomChina()
                ensureActive()
                if (expected != generation) return@launch
                requestedStationId = station.id; connection.requestedStationId = station.id
                resolving = null
                preparingInitial = false
                if (intent) select(station.id, ready = station)
                else {
                    preparedDetail = station
                    connection.mutable.update { it.copy(station = station.model(), error = null) }
                    publish()
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { if (expected == generation) { resolving = null; fail("network") } }
        }
    }
    private fun nextStation() {
        pausePlayback()
        val expected = ++generation
        requestedStationId = null; connection.requestedStationId = null; requestedRandomStation = true
        pendingItem = pendingMediaItem("haen:next", null)
        intent = true
        switching = true; player.stop(); player.clearMediaItems(); switching = false
        connection.mutable.update { it.copy(connecting = true, error = null) }
        publish()
        resolving = scope.launch {
            try {
                val initial = if (connection.state.value.station == null) catalog.randomChina() else null
                val station = initial?.model() ?: catalog.random(connection.state.value.station?.id)
                ensureActive()
                if (expected == generation && intent) { resolving = null; select(station.id, ready = initial) }
            }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { if (expected == generation) fail("network") }
        }
    }
    private fun previousStation() { val id = previous.removeLastOrNull() ?: return; recoveryStations = 0; select(id, rememberPrevious = false) }
    private fun pendingMediaItem(id: String, station: Station?) = MediaItem.Builder().setMediaId(id)
        .setMediaMetadata(MediaMetadata.Builder().setTitle(station?.name ?: getString(R.string.app_name))
            .setArtist(station?.location)
            .setIsPlayable(true).setIsBrowsable(false).setMediaType(MediaMetadata.MEDIA_TYPE_RADIO_STATION).build()).build()
    private fun mediaCardMetadata(metadata: MediaMetadata, status: RadioMediaStatus): MediaMetadata {
        val label = getString(when (status) {
            RadioMediaStatus.CONNECTING -> R.string.connecting
            RadioMediaStatus.PLAYING -> R.string.playing
            RadioMediaStatus.PAUSED -> R.string.paused
            RadioMediaStatus.ERROR -> R.string.media_playback_error
        })
        val location = metadata.artist?.toString()?.takeIf { it.isNotBlank() }
        val subtitle = if (location == null) label else getString(R.string.media_status_location, label, location)
        return metadata.buildUpon().setDisplayTitle(metadata.title)
            .setArtist(subtitle).setSubtitle(subtitle)
            .setDescription(getString(R.string.media_description, getString(R.string.app_name), subtitle))
            .setArtworkData(brandArtwork, MediaMetadata.PICTURE_TYPE_FRONT_COVER)
            .setMediaType(MediaMetadata.MEDIA_TYPE_RADIO_STATION).setIsPlayable(true).setIsBrowsable(false)
            .build()
    }
    private fun createBrandArtwork(): ByteArray {
        val artwork = Bitmap.createBitmap(512, 512, Bitmap.Config.ARGB_8888)
        val logo = requireNotNull(BitmapFactory.decodeResource(resources, R.drawable.ic_launcher_artwork))
        try {
            val canvas = Canvas(artwork)
            canvas.drawColor(Color.rgb(11, 32, 25))
            canvas.drawCircle(256f, 256f, 240f, Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.argb(80, 243, 107, 69); style = Paint.Style.STROKE; strokeWidth = 3f
            })
            // Preserve the approved PNG's colors and transparent margins on an opaque night background.
            canvas.drawBitmap(logo, 0f, 0f, Paint(Paint.FILTER_BITMAP_FLAG))
            return ByteArrayOutputStream().use { output ->
                check(artwork.compress(Bitmap.CompressFormat.PNG, 100, output))
                output.toByteArray()
            }
        } finally { logo.recycle(); artwork.recycle() }
    }
    private fun setSleep(minutes: Int) {
        sleepJob?.cancel()
        connection.mutable.update { it.copy(sleepRemainingMs = minutes * 60000L) }
        if (minutes == 0) return
        val deadline = SystemClock.elapsedRealtime() + minutes * 60000L
        sleepJob = scope.launch {
            while (isActive) {
                val remaining = (deadline - SystemClock.elapsedRealtime()).coerceAtLeast(0)
                connection.mutable.update { it.copy(sleepRemainingMs = remaining) }
                if (remaining == 0L) { pausePlayback(); break }
                delay(minOf(remaining, 1000))
            }
        }
    }
    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo) = session
    override fun onUpdateNotification(session: MediaSession, startInForegroundRequired: Boolean) {
        super.onUpdateNotification(session, startInForegroundRequired)
        connection.onServiceForegroundChanged(isPlaybackOngoing)
    }
    override fun onDestroy() {
        scope.cancel(); session?.release(); player.removeListener(listener); sessionPlayer.release()
        connection.mutable.update { it.copy(playing = false, connecting = false, sleepRemainingMs = 0) }
        connection.onServiceForegroundChanged(false)
        super.onDestroy()
    }
    companion object { private val ID = Regex("[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}") }
}
