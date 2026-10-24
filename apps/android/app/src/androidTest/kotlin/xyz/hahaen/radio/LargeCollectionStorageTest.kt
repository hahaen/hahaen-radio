package xyz.hahaen.radio

import androidx.room.Room
import androidx.room.withTransaction
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test
import xyz.hahaen.radio.data.local.*
import xyz.hahaen.radio.data.repository.RoomLibraryStorage
import xyz.hahaen.radio.domain.ListeningCollection
import xyz.hahaen.radio.domain.SavedStation

class LargeCollectionStorageTest {
    @Test fun maximumCollectionCanBeReadAndObservedBeyondCursorWindowSize() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val database = Room.inMemoryDatabaseBuilder(context, RadioDatabase::class.java).build()
        try {
            val storage = RoomLibraryStorage(database)
            val stations = (1..5000).map { index ->
                SavedStation("20000000-0000-4000-8000-${index.toString().padStart(12, '0')}", "海".repeat(512), "CN", index.toLong())
            }
            val text = Json.encodeToString(ListeningCollection(favorites = stations))
            assertTrue(text.toByteArray().size > 2 * 1024 * 1024)
            val entity = LibraryEntity("large-fixture", 12, text)
            storage.save(entity)
            assertEquals(entity, storage.library("large-fixture"))
            assertEquals(entity, storage.observe("large-fixture").first())
            assertNull(storage.library("another-owner"))
        } finally { database.close() }
    }

    @Test fun acknowledgmentOverSqliteVariableLimitPreservesOtherOwnerAndLaterOperations() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val database = Room.inMemoryDatabaseBuilder(context, RadioDatabase::class.java).build()
        try {
            val dao = database.dao()
            database.withTransaction {
                repeat(1200) { dao.enqueue(PendingEntity(owner = "account-a", json = "{}")) }
                dao.enqueue(PendingEntity(owner = "account-b", json = "{}"))
            }
            val sentThrough = dao.pending("account-a").last().id
            dao.enqueue(PendingEntity(owner = "account-a", json = "later"))
            dao.acknowledgeThrough("account-a", sentThrough)
            assertEquals(listOf("later"), dao.pending("account-a").map { it.json })
            assertEquals(1, dao.pending("account-b").size)
        } finally { database.close() }
    }
}
