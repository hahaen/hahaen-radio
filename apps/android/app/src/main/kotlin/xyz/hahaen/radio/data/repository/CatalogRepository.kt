package xyz.hahaen.radio.data.repository

import androidx.room.withTransaction
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import xyz.hahaen.radio.data.local.*
import xyz.hahaen.radio.data.remote.*
import xyz.hahaen.radio.domain.Station
import java.util.Locale
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.random.Random

@Singleton class CatalogRepository @Inject constructor(private val api: RadioApi, private val db: RadioDatabase, private val json: Json) {
    private val sceneGate = Mutex()
    private var loadedIdentity: String? = null
    private val mutableScene = MutableStateFlow<List<Station>>(emptyList())
    val scene = mutableScene.asStateFlow()
    val manifest = MutableStateFlow<ManifestDto?>(null)
    suspend fun search(q: String, genre: String?, language: String?, bitrate: Int, offset: Int) =
        api.stations(q.take(200), genre, language, bitrate, offset)
    suspend fun station(id: String): StationDto = readStationDetail(api, id)
    suspend fun random(exclude: String? = null): Station {
        val count = api.stations(limit = 1, excludeIds = exclude)
        check(count.total > 0) { "NO_STATIONS" }
        return api.stations(limit = 1, offset = Random.nextInt(count.total.coerceAtMost(200001)), excludeIds = exclude).items.first().model()
    }

    suspend fun lookup(ids: List<String>): List<Station> = withContext(Dispatchers.IO) {
        lookupStations(api, ids)
    }

    private fun validate(manifest: ManifestDto) {
        require(validStationId(manifest.version) && manifest.format == 1)
        require(manifest.restrictionsRevision?.matches(Regex("[a-f0-9]{64}")) == true)
        require(manifest.stationCount in 0..200_000 && manifest.playableCount in 0..manifest.stationCount && manifest.chunks.size <= 200)
        require(manifest.chunks.map { it.index }.distinct().size == manifest.chunks.size)
        require(manifest.chunks.all { it.index in 0..199 && it.count in 0..1000 })
        require(manifest.chunks.sumOf { it.count } == manifest.stationCount)
    }
    private fun identity(manifest: ManifestDto) = "${manifest.version}:${manifest.restrictionsRevision}"

    private suspend fun readCache(key: String): CatalogEntity? = db.withTransaction {
        val updatedAt = db.dao().cacheUpdatedAt(key) ?: return@withTransaction null
        val length = db.dao().cacheLength(key) ?: return@withTransaction null
        require(length <= 24 * 1024 * 1024) { "CACHE_TOO_LARGE" }
        val text = StringBuilder()
        for (start in 1..length step 131_072) text.append(db.dao().cacheSlice(key, start, 131_072))
        CatalogEntity(key, text.toString(), updatedAt)
    }

    private fun decodeChunk(entity: CatalogEntity?, manifest: ManifestDto, ref: ChunkRef): List<Station>? = entity?.let {
        runCatching {
            val chunk = json.decodeFromString<SceneChunkDto>(it.json)
            checkChunk(chunk, manifest, ref)
            chunk.entries.map(::decodeSceneEntry)
        }.getOrNull()
    }
    private fun checkChunk(chunk: SceneChunkDto, manifest: ManifestDto, ref: ChunkRef) {
        require(chunk.format == 1 && chunk.version == manifest.version && chunk.index == ref.index &&
            chunk.restrictionsRevision == manifest.restrictionsRevision && chunk.entries.size == ref.count)
    }

    private suspend fun cached(manifest: ManifestDto): List<Station>? {
        val stations = ArrayList<Station>(manifest.stationCount)
        for (ref in manifest.chunks) {
            currentCoroutineContext().ensureActive()
            stations += decodeChunk(readCache("scene:${identity(manifest)}:${ref.index}"), manifest, ref) ?: return null
        }
        return stations.filter { it.availability == "available" }.distinctBy { it.id }
    }

    suspend fun loadScene() = withContext(Dispatchers.IO) {
        sceneGate.withLock {
            // Older development builds put the whole catalog in one row that exceeded CursorWindow.
            db.dao().deleteLegacySceneCache()
            val previous = readCache("scene-manifest-v1")?.let { entity ->
                runCatching { json.decodeFromString<ManifestDto>(entity.json).also(::validate) }.getOrNull()
            }
            if (loadedIdentity == null && previous != null) {
                cached(previous)?.let { stations ->
                    manifest.value = previous
                    mutableScene.value = stations
                    loadedIdentity = identity(previous)
                }
            }
            try {
                val current = api.sceneManifest().also(::validate)
                manifest.value = current
                if (loadedIdentity == identity(current)) return@withLock
                // Retain the last complete snapshot as fallback and at most one new partial version.
                db.dao().prunePartialScenes("scene:${identity(current)}:%", "scene:${previous?.let(::identity) ?: "none"}:%")
                val stations = ArrayList<Station>(current.stationCount)
                for (ref in current.chunks) {
                    currentCoroutineContext().ensureActive()
                    val key = "scene:${identity(current)}:${ref.index}"
                    val fromCache = decodeChunk(readCache(key), current, ref)
                    val items = fromCache ?: api.sceneChunk(current.version, ref.index).let { chunk ->
                        checkChunk(chunk, current, ref)
                        val decoded = chunk.entries.map(::decodeSceneEntry)
                        db.dao().cache(CatalogEntity(key, json.encodeToString(chunk), System.currentTimeMillis()))
                        decoded
                    }
                    stations += items
                }
                val distinct = stations.filter { it.availability == "available" }.distinctBy { it.id }
                db.withTransaction {
                    db.dao().cache(CatalogEntity("scene-manifest-v1", json.encodeToString(current), System.currentTimeMillis()))
                    db.dao().pruneSceneCache("scene:${identity(current)}:%")
                }
                mutableScene.value = distinct
                loadedIdentity = identity(current)
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) { if (loadedIdentity == null) throw error }
        }
    }
}

/** Contract-bounded lookup also lets the favorite filter operate without a downloaded globe. */
internal suspend fun lookupStations(api: RadioApi, ids: List<String>): List<Station> {
    require(ids.size <= 5000) { "LOOKUP_LIMIT" }
    val unique = ids.map { it.lowercase(Locale.ROOT) }.distinct()
    require(unique.all(::validStationId)) { "LOOKUP_ID" }
    val result = LinkedHashMap<String, Station>()
    for (batch in unique.chunked(100)) {
        currentCoroutineContext().ensureActive()
        val response = api.lookup(StationLookup(batch))
        require(response.items.size <= 100 && response.missing.size <= 100)
        val answered = response.items.map { it.id } + response.missing
        require(answered.size == batch.size && answered.toSet() == batch.toSet()) { "LOOKUP_RESPONSE_IDS" }
        for (item in response.items) {
            require(item.name.length in 1..512 && item.countryCode?.matches(Regex("[A-Z]{2}")) != false)
            require(item.latitude?.let { it.isFinite() && it in -90.0..90.0 } != false &&
                item.longitude?.let { it.isFinite() && it in -180.0..180.0 } != false)
            require(item.languages.size <= 32 && item.languages.all { it.length in 1..64 })
            require(item.bitrate?.let { it in 1..10_000 } != false)
            result[item.id] = item.model()
        }
    }
    return unique.mapNotNull(result::get)
}
