package xyz.hahaen.radio

import android.os.Looper
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.SimpleBasePlayer
import androidx.media3.common.util.UnstableApi
import androidx.test.platform.app.InstrumentationRegistry
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import org.junit.Assert.*
import org.junit.Test
import xyz.hahaen.radio.playback.RadioSessionPlayer
import xyz.hahaen.radio.playback.RadioMediaStatus

@UnstableApi
class RadioSessionPlayerTest {
    @Test fun standardSetterAndPlayPauseUseTheSameServicePolicyAndKeepPendingTarget() = onMain {
        val raw = TestPlayer()
        val target = MediaItem.Builder().setMediaId("station-b")
            .setMediaMetadata(MediaMetadata.Builder().setTitle("Station B").build()).build()
        var plays = 0
        var pauses = 0
        lateinit var wrapper: RadioSessionPlayer
        wrapper = RadioSessionPlayer(raw,
            onPlay = { plays++; wrapper.updatePending(target, true) },
            onPause = { pauses++; wrapper.updatePending(target, false) },
            onStop = {}, onNext = {}, onPrevious = {})
        try {
            wrapper.updatePending(target, true)
            assertEquals(Player.STATE_BUFFERING, wrapper.playbackState)
            assertEquals("station-b", wrapper.currentMediaItem?.mediaId)
            assertFalse(wrapper.isPlaying)
            assertTrue(raw.currentTimeline.isEmpty())
            wrapper.playWhenReady = false
            assertEquals(1, pauses)
            assertEquals(Player.STATE_IDLE, wrapper.playbackState)
            assertEquals("station-b", wrapper.currentMediaItem?.mediaId)
            wrapper.play()
            assertEquals(1, plays)
            assertTrue(wrapper.playWhenReady)
            wrapper.pause()
            assertEquals(2, pauses)
            assertFalse(wrapper.playWhenReady)
            assertEquals(0, raw.directPlaybackChanges)
        } finally { wrapper.release() }
    }

    @Test fun commandEventsRetainRadioSkipCommandsWhenUnderlyingAvailabilityChanges() = onMain {
        val raw = TestPlayer()
        var next = 0
        var previous = 0
        val wrapper = RadioSessionPlayer(raw, {}, {}, {}, { next++ }, { previous++ })
        val events = mutableListOf<Player.Commands>()
        wrapper.addListener(object : Player.Listener {
            override fun onAvailableCommandsChanged(availableCommands: Player.Commands) { events += availableCommands }
        })
        try {
            assertTrue(wrapper.isCommandAvailable(Player.COMMAND_SEEK_TO_NEXT))
            raw.replaceCommands(TestPlayer.commands.buildUpon().add(Player.COMMAND_SET_VOLUME).build())
            // Invalidating a service-owned preparation state also flushes the latest underlying
            // state, without relying on a later playback event to restore command availability.
            wrapper.updatePending(MediaItem.Builder().setMediaId("pending").build(), true)
            assertTrue(events.isNotEmpty())
            assertTrue(events.all { it.contains(Player.COMMAND_SEEK_TO_NEXT) && it.contains(Player.COMMAND_SEEK_TO_PREVIOUS) })
            assertEquals(wrapper.availableCommands, events.last())
            wrapper.seekToNext(); wrapper.seekToNextMediaItem()
            wrapper.seekToPrevious(); wrapper.seekToPreviousMediaItem()
            assertEquals(2, next)
            assertEquals(2, previous)
            assertFalse(wrapper.isCommandAvailable(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM))
        } finally { wrapper.release() }
    }

    @Test fun resolvingTargetHandsBackToTheRealPlayerWithoutStartingIt() = onMain {
        val raw = TestPlayer()
        val wrapper = RadioSessionPlayer(raw, {}, {}, {}, {}, {})
        try {
            wrapper.updatePending(MediaItem.Builder().setMediaId("pending").build(), true)
            assertEquals(Player.STATE_BUFFERING, wrapper.playbackState)
            wrapper.updatePending(null, false)
            assertEquals(Player.STATE_IDLE, wrapper.playbackState)
            assertTrue(wrapper.currentTimeline.isEmpty())
            assertFalse(wrapper.isPlaying)
            assertEquals(0, raw.directPlaybackChanges)
        } finally { wrapper.release() }
    }

    @Test fun radioTimelineHasNoSongDurationOrAdvancingPositionWithoutChangingTheSource() = onMain {
        val raw = TestPlayer()
        val station = stationItem("station-a", "Station A", "City A")
        raw.replaceState(radioState(station))
        val wrapper = RadioSessionPlayer(raw, {}, {}, {}, {}, {})
        try {
            assertTrue(wrapper.isPlaying)
            assertTrue(wrapper.isCurrentMediaItemLive)
            assertTrue(wrapper.isCurrentMediaItemDynamic)
            assertFalse(wrapper.isCurrentMediaItemSeekable)
            assertEquals(C.TIME_UNSET, wrapper.duration)
            assertEquals(0L, wrapper.currentPosition)
            assertEquals(0L, wrapper.bufferedPosition)
            assertNull(wrapper.mediaMetadata.durationMs)
            assertFalse(wrapper.isCommandAvailable(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM))
            assertTrue(wrapper.isCommandAvailable(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM))
            assertTrue(wrapper.isCommandAvailable(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM))

            assertFalse(raw.isCurrentMediaItemLive)
            assertTrue(raw.isCurrentMediaItemSeekable)
            assertEquals(180_000L, raw.duration)
            assertEquals(42_000L, raw.currentPosition)
            assertEquals(station, raw.currentMediaItem)
            assertEquals(0, raw.directPlaybackChanges)
        } finally { wrapper.release() }
    }

    @Test fun pendingMetadataAndFailureNeverInheritThePreviousStationOrLoseBrandArtwork() = onMain {
        val raw = TestPlayer()
        raw.replaceState(radioState(stationItem("station-a", "Station A", "City A")))
        val artwork = byteArrayOf(1, 2, 3)
        val wrapper = RadioSessionPlayer(raw, {}, {}, {}, {}, {}, decorateMetadata = { metadata, status ->
            metadata.buildUpon().setSubtitle(status.name)
                .setArtworkData(artwork, MediaMetadata.PICTURE_TYPE_FRONT_COVER).build()
        })
        val target = stationItem("station-b", "Station B", "City B")
        try {
            wrapper.updatePending(target, true)
            assertEquals("Station B", wrapper.mediaMetadata.title)
            assertEquals("City B", wrapper.mediaMetadata.artist)
            assertEquals(RadioMediaStatus.CONNECTING.name, wrapper.mediaMetadata.subtitle)
            assertTrue(wrapper.isCurrentMediaItemLive)
            assertArrayEquals(artwork, wrapper.mediaMetadata.artworkData)

            // Late events from the still-visible old source cannot relabel the target.
            raw.replaceState(radioState(stationItem("station-a", "Old source update", "Old location")))
            wrapper.updatePending(target, false, failed = true)
            assertEquals("station-b", wrapper.currentMediaItem?.mediaId)
            assertEquals("Station B", wrapper.mediaMetadata.title)
            assertEquals("City B", wrapper.mediaMetadata.artist)
            assertEquals(RadioMediaStatus.ERROR.name, wrapper.mediaMetadata.subtitle)
            assertFalse(wrapper.playWhenReady)
            assertArrayEquals(artwork, wrapper.mediaMetadata.artworkData)

            wrapper.updatePending(target, false)
            assertEquals(RadioMediaStatus.PAUSED.name, wrapper.mediaMetadata.subtitle)
            raw.replaceState(radioState(target))
            wrapper.updatePending(null, true)
            assertEquals("Station B", wrapper.mediaMetadata.title)
            assertEquals(RadioMediaStatus.PLAYING.name, wrapper.mediaMetadata.subtitle)
            assertArrayEquals(artwork, wrapper.mediaMetadata.artworkData)
            assertEquals(0, raw.directPlaybackChanges)
        } finally { wrapper.release() }
    }

    @Test fun focusSuppressionIsPresentedAsPausedWhilePreservingResumeIntent() = onMain {
        val raw = TestPlayer()
        raw.replaceState(radioState(stationItem("station-a", "Station A", "City A"))
            .buildUpon().setPlaybackSuppressionReason(Player.PLAYBACK_SUPPRESSION_REASON_TRANSIENT_AUDIO_FOCUS_LOSS).build())
        val wrapper = RadioSessionPlayer(raw, {}, {}, {}, {}, {}, decorateMetadata = { metadata, status ->
            metadata.buildUpon().setSubtitle(status.name).build()
        })
        try {
            assertTrue(wrapper.playWhenReady)
            assertFalse(wrapper.isPlaying)
            assertEquals(Player.PLAYBACK_SUPPRESSION_REASON_TRANSIENT_AUDIO_FOCUS_LOSS, wrapper.playbackSuppressionReason)
            assertEquals(RadioMediaStatus.PAUSED.name, wrapper.mediaMetadata.subtitle)
            assertEquals(0, raw.directPlaybackChanges)
        } finally { wrapper.release() }
    }

    private fun stationItem(id: String, title: String, location: String) = MediaItem.Builder().setMediaId(id)
        .setMediaMetadata(MediaMetadata.Builder().setTitle(title).setArtist(location).setDurationMs(180_000L).build()).build()

    private fun radioState(item: MediaItem) = SimpleBasePlayer.State.Builder()
        .setAvailableCommands(TestPlayer.commands.buildUpon().add(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM).build())
        .setPlaylist(listOf(SimpleBasePlayer.MediaItemData.Builder(item.mediaId).setMediaItem(item)
            .setDurationUs(180_000_000L).setIsSeekable(true).build()))
        .setPlaybackState(Player.STATE_READY).setPlayWhenReady(true, Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST)
        .setContentPositionMs(SimpleBasePlayer.PositionSupplier { 42_000L })
        .setContentBufferedPositionMs(SimpleBasePlayer.PositionSupplier { 48_000L }).build()

    private fun onMain(block: () -> Unit) = InstrumentationRegistry.getInstrumentation().runOnMainSync { block() }

    private class TestPlayer : SimpleBasePlayer(Looper.getMainLooper()) {
        private var snapshot = State.Builder().setAvailableCommands(commands).build()
        var directPlaybackChanges = 0
        override fun getState(): State = snapshot
        fun replaceState(value: State) {
            snapshot = value
            invalidateState()
        }
        fun replaceCommands(value: Player.Commands) {
            snapshot = snapshot.buildUpon().setAvailableCommands(value).build()
            invalidateState()
        }
        override fun handleSetPlayWhenReady(playWhenReady: Boolean): ListenableFuture<*> {
            directPlaybackChanges++
            snapshot = snapshot.buildUpon().setPlayWhenReady(playWhenReady, Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST).build()
            return Futures.immediateVoidFuture()
        }
        override fun handleRelease(): ListenableFuture<*> = Futures.immediateVoidFuture()
        companion object {
            val commands: Player.Commands = Player.Commands.Builder().addAll(Player.COMMAND_PLAY_PAUSE,
                Player.COMMAND_GET_TIMELINE, Player.COMMAND_GET_CURRENT_MEDIA_ITEM, Player.COMMAND_GET_METADATA,
                Player.COMMAND_RELEASE).build()
        }
    }
}
