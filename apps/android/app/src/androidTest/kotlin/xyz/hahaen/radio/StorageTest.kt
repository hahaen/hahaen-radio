package xyz.hahaen.radio

import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import xyz.hahaen.radio.data.local.*

class StorageTest {
    @Test fun accountIsolationAndPendingChangesSurviveReopen() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val name = "storage-test.db"
        context.deleteDatabase(name)
        var database = Room.databaseBuilder(context,RadioDatabase::class.java,name).build()
        try {
            database.dao().save(LibraryEntity("guest",0,"{\"favorites\":[]}"))
            database.dao().save(LibraryEntity("account-a",5,"{\"favorites\":[1]}"))
            database.dao().enqueue(PendingEntity(owner="account-a",json="remove-A"))
            database.close()
            database = Room.databaseBuilder(context,RadioDatabase::class.java,name).build()
            assertEquals(5,database.dao().library("account-a")!!.revision)
            assertEquals(0,database.dao().library("guest")!!.revision)
            assertNull(database.dao().library("account-b"))
            assertTrue(database.dao().pending("account-b").isEmpty())
            val pending = database.dao().pending("account-a")
            assertEquals(1,pending.size)
            database.dao().acknowledge("account-b",pending.map { it.id })
            assertEquals(1,database.dao().pending("account-a").size)
        } finally { database.close(); context.deleteDatabase(name) }
    }
}
