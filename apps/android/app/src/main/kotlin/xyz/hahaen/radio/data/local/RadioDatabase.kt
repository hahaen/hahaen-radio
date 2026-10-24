package xyz.hahaen.radio.data.local

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Entity(tableName = "libraries")
data class LibraryEntity(@PrimaryKey val owner: String, val revision: Int, val json: String)
@Entity(tableName = "pending_operations", indices = [Index("owner")])
data class PendingEntity(@PrimaryKey(autoGenerate = true) val id: Long = 0, val owner: String, val json: String)
@Entity(tableName = "catalog_cache")
data class CatalogEntity(@PrimaryKey val key: String, val json: String, val updatedAt: Long)

@Dao interface RadioDao {
    @Query("SELECT * FROM libraries WHERE owner = :owner") fun observe(owner: String): Flow<LibraryEntity?>
    @Query("SELECT * FROM libraries WHERE owner = :owner") suspend fun library(owner: String): LibraryEntity?
    @Query("SELECT revision FROM libraries WHERE owner = :owner") fun observeRevision(owner: String): Flow<Int?>
    @Query("SELECT revision FROM libraries WHERE owner = :owner") suspend fun libraryRevision(owner: String): Int?
    @Query("SELECT length(json) FROM libraries WHERE owner = :owner") suspend fun libraryLength(owner: String): Int?
    @Query("SELECT substr(json, :start, :count) FROM libraries WHERE owner = :owner") suspend fun librarySlice(owner: String, start: Int, count: Int): String?
    @Upsert suspend fun save(entity: LibraryEntity)
    @Insert suspend fun enqueue(entity: PendingEntity)
    @Query("SELECT * FROM pending_operations WHERE owner = :owner ORDER BY id") suspend fun pending(owner: String): List<PendingEntity>
    @Query("DELETE FROM pending_operations WHERE owner = :owner AND id IN (:ids)") suspend fun acknowledge(owner: String, ids: List<Long>)
    @Query("DELETE FROM pending_operations WHERE owner = :owner AND id <= :id") suspend fun acknowledgeThrough(owner: String, id: Long)
    @Query("SELECT COUNT(*) FROM pending_operations WHERE owner = :owner") suspend fun pendingSize(owner: String): Int
    @Query("SELECT COUNT(*) FROM pending_operations WHERE owner = :owner") fun pendingCount(owner: String): Flow<Int>
    @Query("SELECT * FROM catalog_cache WHERE `key` = :key") suspend fun cache(key: String): CatalogEntity?
    @Query("SELECT updatedAt FROM catalog_cache WHERE `key` = :key") suspend fun cacheUpdatedAt(key: String): Long?
    @Query("SELECT length(json) FROM catalog_cache WHERE `key` = :key") suspend fun cacheLength(key: String): Int?
    @Query("SELECT substr(json, :start, :count) FROM catalog_cache WHERE `key` = :key") suspend fun cacheSlice(key: String, start: Int, count: Int): String?
    @Upsert suspend fun cache(entity: CatalogEntity)
    @Query("DELETE FROM catalog_cache WHERE `key` LIKE 'scene:%' AND `key` NOT LIKE :keepPrefix") suspend fun pruneSceneCache(keepPrefix: String)
    @Query("DELETE FROM catalog_cache WHERE `key` LIKE 'scene:%' AND `key` NOT LIKE :currentPrefix AND `key` NOT LIKE :previousPrefix") suspend fun prunePartialScenes(currentPrefix: String, previousPrefix: String)
    @Query("DELETE FROM catalog_cache WHERE `key` IN ('scene', 'scene-version')") suspend fun deleteLegacySceneCache()
}

@Database(entities = [LibraryEntity::class, PendingEntity::class, CatalogEntity::class], version = 1, exportSchema = true)
abstract class RadioDatabase : RoomDatabase() { abstract fun dao(): RadioDao }
