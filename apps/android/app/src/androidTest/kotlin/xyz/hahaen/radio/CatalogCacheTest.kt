package xyz.hahaen.radio

import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import xyz.hahaen.radio.data.local.RadioDatabase
import xyz.hahaen.radio.data.remote.*
import xyz.hahaen.radio.data.repository.CatalogRepository
import xyz.hahaen.radio.domain.Library
import java.io.IOException

class CatalogCacheTest {
    private val json = Json { encodeDefaults = true; ignoreUnknownKeys = true }
    private fun database() = Room.inMemoryDatabaseBuilder(InstrumentationRegistry.getInstrumentation().targetContext, RadioDatabase::class.java).build()

    @Test fun failedDownloadResumesCachedChunksAndRestrictionChangeInvalidatesSameVersion() = runBlocking {
        val db = database()
        try {
            val api = CatalogFixture(2)
            val repository = CatalogRepository(api, db, json)
            api.failIndex = 1
            assertTrue(runCatching { repository.loadScene() }.isFailure)
            assertTrue(repository.scene.value.isEmpty())
            api.failIndex = null
            repository.loadScene()
            assertEquals(2, repository.scene.value.size)
            assertEquals(1, api.chunkCalls[0])
            assertEquals(2, api.chunkCalls[1])
            val oldRevision = api.restrictions
            api.restrictions = "b".repeat(64)
            api.blockFirst = true
            repository.loadScene()
            assertEquals(1, repository.scene.value.size)
            assertEquals(2, api.chunkCalls[0])
            assertNull(db.dao().cacheUpdatedAt("scene:${api.version}:$oldRevision:0"))
            api.offline = true
            val recreated = CatalogRepository(api, db, json)
            recreated.loadScene()
            assertEquals(repository.scene.value, recreated.scene.value)
        } finally { db.close() }
    }

    @Test fun largeCompactChunkCanBeRestoredOfflineWithoutOversizedCursorRow() = runBlocking {
        val db = database()
        try {
            val api = CatalogFixture(1, large = true)
            val repository = CatalogRepository(api, db, json)
            repository.loadScene()
            assertEquals(1000, repository.scene.value.size)
            val chunk = api.sceneChunk(api.version, 0)
            assertTrue(json.encodeToString(chunk).toByteArray().size > 2 * 1024 * 1024)
            api.offline = true
            val recreated = CatalogRepository(api, db, json)
            recreated.loadScene()
            assertEquals(repository.scene.value, recreated.scene.value)
        } finally { db.close() }
    }

    private class CatalogFixture(private val chunks: Int, private val large: Boolean = false) : RadioApi {
        val version = "30000000-0000-4000-8000-000000000001"
        var restrictions = "a".repeat(64)
        var failIndex: Int? = null
        var blockFirst = false
        var offline = false
        val chunkCalls = mutableMapOf<Int, Int>()
        private val perChunk = if (large) 1000 else 1
        override suspend fun sceneManifest(): ManifestDto {
            if (offline) throw IOException("FIXTURE_OFFLINE")
            return ManifestDto(version, chunks * perChunk, chunks * perChunk - if (blockFirst) 1 else 0,
                1, emptyList(), emptyList(), List(chunks) { ChunkRef(it, perChunk) }, 1, restrictions)
        }
        override suspend fun sceneChunk(version: String, index: Int): SceneChunkDto {
            chunkCalls[index] = (chunkCalls[index] ?: 0) + 1
            if (offline || index == failIndex) throw IOException("FIXTURE_OFFLINE")
            val entries = List(perChunk) { row ->
                val stationIndex = index * perChunk + row
                buildJsonArray {
                    add("20000000-0000-4000-8000-${(stationIndex + 1).toString().padStart(12, '0')}")
                    add(if (large) "海".repeat(512) else "Station $stationIndex")
                    add("CN")
                    repeat(3) { add(if (large) JsonPrimitive("城".repeat(255)) else JsonNull) }
                    add(30.0); add(120.0); add("coordinates"); add("jazz")
                    add(buildJsonArray { add("zh") }); add(128)
                    add(if (blockFirst && stationIndex == 0) "blocked" else "available")
                }
            }
            return SceneChunkDto(1, version, index, restrictions, entries)
        }
        override suspend fun session(): SessionDto = error("Not used")
        override suspend fun login(credentials: Credentials): SessionDto = error("Not used")
        override suspend fun logout(owner: Owner): SessionDto = error("Not used")
        override suspend fun library(userId: String): Library = error("Not used")
        override suspend fun saveLibrary(body: SaveLibrary): Library = error("Not used")
        override suspend fun stations(q: String, genres: String?, languages: String?, bitrate: Int, offset: Int, limit: Int, playable: Boolean, excludeIds: String?): StationPage = error("Not used")
        override suspend fun station(id: String): StationDto = error("Not used")
        override suspend fun manifest(): ManifestDto = error("Not used")
        override suspend fun lookup(body: StationLookup): StationLookupResult = error("Not used")
        override suspend fun chunk(version: String, index: Int): ChunkDto = error("Not used")
    }
}
