package xyz.hahaen.radio.playback

import androidx.media3.common.C
import androidx.media3.common.ForwardingSimpleBasePlayer
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.SimpleBasePlayer.MediaItemData
import androidx.media3.common.SimpleBasePlayer.PositionSupplier
import androidx.media3.common.SimpleBasePlayer.State
import androidx.media3.common.util.UnstableApi
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

internal enum class RadioMediaStatus { CONNECTING, PLAYING, PAUSED, ERROR }

/** Keeps session commands and listener snapshots consistent with the service's radio policy. */
@UnstableApi
internal class RadioSessionPlayer(
    player: Player,
    private val onPlay: () -> Unit,
    private val onPause: () -> Unit,
    private val onStop: () -> Unit,
    private val onNext: () -> Unit,
    private val onPrevious: () -> Unit,
    private val decorateMetadata: (MediaMetadata, RadioMediaStatus) -> MediaMetadata = { metadata, _ -> metadata },
) : ForwardingSimpleBasePlayer(player) {
    private var pendingItem: MediaItem? = null
    private var pendingPlayWhenReady = false
    private var failed = false

    fun updatePending(item: MediaItem?, playWhenReady: Boolean, failed: Boolean = false) {
        if (pendingItem == item && pendingPlayWhenReady == playWhenReady && this.failed == failed) return
        pendingItem = item
        pendingPlayWhenReady = playWhenReady
        this.failed = failed
        invalidateState()
    }

    override fun getState(): State {
        val underlying = super.getState()
        val commands = underlying.availableCommands.buildUpon()
            .add(Player.COMMAND_SEEK_TO_NEXT).add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
            .add(Player.COMMAND_SEEK_TO_PREVIOUS).add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
            .remove(Player.COMMAND_SEEK_BACK).remove(Player.COMMAND_SEEK_FORWARD)
            .remove(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM)
            .remove(Player.COMMAND_SEEK_TO_DEFAULT_POSITION).remove(Player.COMMAND_SEEK_TO_MEDIA_ITEM)
            .build()
        val state = underlying.buildUpon().setAvailableCommands(commands)
        pendingItem?.let { item ->
            // Resolving a station is preparation, not playback. Media3 can show its one media
            // notification and keep the service foreground before the stream URL has arrived.
            state.setPlaylist(listOf(MediaItemData.Builder(item.mediaId).setMediaItem(item)
                .setIsDynamic(true).setIsPlaceholder(true).build()))
                .setCurrentMediaItemIndex(0).setCurrentAd(C.INDEX_UNSET, C.INDEX_UNSET)
                .setContentPositionMs(0).setContentBufferedPositionMs(PositionSupplier.ZERO)
                .setTotalBufferedDurationMs(PositionSupplier.ZERO)
                .setPlaybackState(if (pendingPlayWhenReady) Player.STATE_BUFFERING else Player.STATE_IDLE)
                .setPlayWhenReady(pendingPlayWhenReady, Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST)
                .setPlaybackSuppressionReason(Player.PLAYBACK_SUPPRESSION_REASON_NONE)
                .setPlayerError(null).setIsLoading(pendingPlayWhenReady)
        }
        val snapshot = state.build()
        val status = when {
            failed || snapshot.playerError != null -> RadioMediaStatus.ERROR
            snapshot.playWhenReady && snapshot.playbackState == Player.STATE_BUFFERING -> RadioMediaStatus.CONNECTING
            snapshot.playWhenReady && snapshot.playbackState == Player.STATE_READY &&
                snapshot.playbackSuppressionReason == Player.PLAYBACK_SUPPRESSION_REASON_NONE -> RadioMediaStatus.PLAYING
            else -> RadioMediaStatus.PAUSED
        }
        // Only the session-facing view changes. Never replace/prepare the ExoPlayer's source.
        // Use each item's station metadata, so a pending target cannot inherit the old station.
        val playlist = snapshot.playlist.map { item ->
            val metadata = decorateMetadata(item.mediaItem.mediaMetadata, status).buildUpon()
                .setDurationMs(null).build()
            item.buildUpon()
                .setMediaItem(item.mediaItem.buildUpon().setMediaMetadata(metadata).build())
                .setMediaMetadata(metadata)
                .setLiveConfiguration(LIVE_CONFIGURATION).setIsDynamic(true).setIsSeekable(false)
                .setDurationUs(C.TIME_UNSET).setDefaultPositionUs(0).setPositionInFirstPeriodUs(0)
                .setPresentationStartTimeMs(C.TIME_UNSET).setWindowStartTimeMs(C.TIME_UNSET)
                .setElapsedRealtimeEpochOffsetMs(C.TIME_UNSET).setPeriods(emptyList())
                .build()
        }
        // There is no song-relative progress for radio. Media3 exports unknown positions and
        // duration to the platform session when the timeline window is live.
        state.setPlaylist(playlist).setCurrentAd(C.INDEX_UNSET, C.INDEX_UNSET)
            .setContentPositionMs(PositionSupplier.ZERO).setContentBufferedPositionMs(PositionSupplier.ZERO)
            .setTotalBufferedDurationMs(PositionSupplier.ZERO)
        if (snapshot.hasPositionDiscontinuity) state.setPositionDiscontinuity(snapshot.positionDiscontinuityReason, 0)
        return state.build()
    }

    override fun handleSetPlayWhenReady(playWhenReady: Boolean): ListenableFuture<*> {
        if (playWhenReady) onPlay() else onPause()
        return Futures.immediateVoidFuture()
    }

    override fun handlePrepare(): ListenableFuture<*> {
        // The service resolves/prepares its selected target when play is requested.
        // Preparing the old underlying item here would bypass that target.
        return Futures.immediateVoidFuture()
    }

    override fun handleStop(): ListenableFuture<*> {
        onStop()
        return Futures.immediateVoidFuture()
    }

    override fun handleSeek(mediaItemIndex: Int, positionMs: Long, seekCommand: Int): ListenableFuture<*> {
        when (seekCommand) {
            Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM -> onNext()
            Player.COMMAND_SEEK_TO_PREVIOUS, Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM -> onPrevious()
        }
        return Futures.immediateVoidFuture()
    }

    companion object {
        private val LIVE_CONFIGURATION = MediaItem.LiveConfiguration.Builder().build()
    }
}
