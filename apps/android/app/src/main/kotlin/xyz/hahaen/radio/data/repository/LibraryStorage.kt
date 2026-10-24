package xyz.hahaen.radio.data.repository

import androidx.room.withTransaction
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import xyz.hahaen.radio.data.local.LibraryEntity
import xyz.hahaen.radio.data.local.PendingEntity
import xyz.hahaen.radio.data.local.RadioDatabase

/** The transaction boundary is shared by Room and deterministic repository tests. */
internal interface LibraryStorage {
    fun observe(owner: String): Flow<LibraryEntity?>
    fun pendingCount(owner: String): Flow<Int>
    suspend fun library(owner: String): LibraryEntity?
    suspend fun pending(owner: String): List<PendingEntity>
    suspend fun pendingSize(owner: String): Int
    suspend fun save(entity: LibraryEntity)
    suspend fun enqueue(entity: PendingEntity)
    suspend fun acknowledgeThrough(owner: String, id: Long)
    suspend fun <T> transaction(block: suspend () -> T): T
}

internal class RoomLibraryStorage(private val database: RadioDatabase) : LibraryStorage {
    private val dao = database.dao()
    override fun observe(owner: String) = dao.observeRevision(owner).map { library(owner) }
    override fun pendingCount(owner: String) = dao.pendingCount(owner)
    override suspend fun library(owner: String): LibraryEntity? = database.withTransaction {
        val revision = dao.libraryRevision(owner) ?: return@withTransaction null
        val length = dao.libraryLength(owner) ?: return@withTransaction null
        require(length <= 24 * 1024 * 1024) { "COLLECTION_TOO_LARGE" }
        // SQLite can store a large collection, but Android CursorWindow cannot return one huge row.
        val text = StringBuilder()
        for (start in 1..length step 131_072) text.append(dao.librarySlice(owner, start, 131_072))
        LibraryEntity(owner, revision, text.toString())
    }
    override suspend fun pending(owner: String) = dao.pending(owner)
    override suspend fun pendingSize(owner: String) = dao.pendingSize(owner)
    override suspend fun save(entity: LibraryEntity) = dao.save(entity)
    override suspend fun enqueue(entity: PendingEntity) = dao.enqueue(entity)
    override suspend fun acknowledgeThrough(owner: String, id: Long) = dao.acknowledgeThrough(owner, id)
    override suspend fun <T> transaction(block: suspend () -> T): T = database.withTransaction(block)
}
