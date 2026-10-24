package xyz.hahaen.radio

import org.junit.Assert.*
import org.junit.Test
import xyz.hahaen.radio.domain.*

class LibraryMergeTest {
    private val a = SavedStation("00000000-0000-4000-8000-000000000001", "A", "CN", 100)
    private val b = SavedStation("00000000-0000-4000-8000-000000000002", "B", null, 200)
    @Test fun offlineDeletionSurvivesConflictWithoutRemovingOtherDeviceAdditions() {
        val remote = ListeningCollection(favorites = listOf(a,b), songs = listOf(SavedSong("Artist","Song",1)))
        val merged = applyOperations(remote, listOf(LibraryOperation("favorite.remove",a)))
        assertEquals(listOf(b),merged.favorites)
        assertEquals(remote.songs, merged.songs)
    }
    @Test fun retryIsIdempotentAndNewestHistoryWins() {
        val remote = ListeningCollection(history = listOf(a.copy(savedAt = 500)))
        val changes = listOf(LibraryOperation("history.add",a),LibraryOperation("favorite.add",b))
        val merged = applyOperations(remote,changes)
        assertEquals(500,merged.history.single().savedAt)
        assertEquals(merged,applyOperations(merged,changes))
    }
    @Test fun clearThenListenKeepsOnlySubsequentHistory() {
        val merged = applyOperations(ListeningCollection(history=listOf(a)), listOf(LibraryOperation("history.clear"),LibraryOperation("history.add",b)))
        assertEquals(listOf(b),merged.history)
    }
    @Test fun historyIsBoundedAndOrderedAfterOfflineReplay() {
        val changes = (0..150).map { LibraryOperation("history.add",a.copy(id="station-$it",savedAt=it.toLong())) }
        val result = applyOperations(ListeningCollection(),changes).history
        assertEquals(100,result.size)
        assertEquals(150L,result.first().savedAt)
        assertEquals(51L,result.last().savedAt)
    }
}
