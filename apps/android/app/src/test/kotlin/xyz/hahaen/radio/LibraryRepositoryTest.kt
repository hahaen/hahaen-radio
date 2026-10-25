package xyz.hahaen.radio

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.Json
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response
import xyz.hahaen.radio.data.local.*
import xyz.hahaen.radio.data.remote.*
import xyz.hahaen.radio.data.repository.*
import xyz.hahaen.radio.domain.*
import java.io.IOException

@OptIn(ExperimentalCoroutinesApi::class)
class LibraryRepositoryTest {
    private val json = Json { encodeDefaults = true; ignoreUnknownKeys = true }
    private val accountA = AccountUser("10000000-0000-4000-8000-000000000001", "listener_a")
    private val accountB = AccountUser("10000000-0000-4000-8000-000000000002", "listener_b")
    private val stationA = Station("20000000-0000-4000-8000-000000000001", "Station A", "CN")
    private val stationB = Station("20000000-0000-4000-8000-000000000002", "Station B", "US")
    private val stationC = Station("20000000-0000-4000-8000-000000000003", "Station C", "GB")
    private fun Station.saved() = SavedStation(id, name, countryCode, 100)
    private fun http(code: Int) = HttpException(Response.error<Unit>(code, "{}".toResponseBody()))
    private fun FakeStorage.seed(owner: String, collection: ListeningCollection, revision: Int = 0) {
        libraries.value = libraries.value + (owner to LibraryEntity(owner, revision, json.encodeToString(collection)))
    }
    private fun FakeStorage.queue(owner: String, operation: LibraryOperation) {
        rows.value = rows.value + PendingEntity(nextId++, owner, json.encodeToString(operation))
    }
    private fun FakeStorage.collection(owner: String) = libraries.value[owner]?.let { json.decodeFromString<ListeningCollection>(it.json) } ?: ListeningCollection()

    @Test fun pinEditsSurviveOfflineRestartAndStayBoundToTheAccount() = runTest {
        val storage = FakeStorage()
        var offline = true
        var remote = Library(1, ListeningCollection(favorites = listOf(stationA.saved())))
        val api = FakeApi().apply {
            onLibrary = { if (offline) throw IOException("OFFLINE") else remote }
            onSave = { Library(it.revision + 1, it.collection).also { result -> remote = result } }
            onLogin = { SessionDto(accountB) }
        }
        val firstScope = CoroutineScope(backgroundScope.coroutineContext + Job())
        val session = FakeSession(accountA)
        val repository = LibraryRepository(storage, api, session, json, firstScope)
        assertTrue(repository.setPinned(true))
        runCurrent()
        assertTrue(storage.collection(accountA.id).pinned)
        assertEquals(1, storage.pending(accountA.id).size)
        firstScope.cancel()
        val restored = LibraryRepository(storage, api, session, json, backgroundScope)
        runCurrent()
        assertEquals(true, restored.pinned.value)
        offline = false
        assertTrue(restored.synchronize())
        runCurrent()
        assertTrue(remote.collection.pinned)
        assertEquals(listOf(stationA.saved()), remote.collection.favorites)
        assertTrue(storage.pending(accountA.id).isEmpty())
        remote = remote.copy(revision = remote.revision + 1, collection = remote.collection.copy(pinned = false))
        assertTrue(restored.synchronize())
        runCurrent()
        assertEquals(false, restored.pinned.value)
        assertTrue(restored.logout(false))
        runCurrent()
        assertNull(restored.pinned.value)
        assertTrue(restored.login("listener_b", "test-only-password"))
        runCurrent()
        assertEquals(false, restored.pinned.value)
        assertFalse(storage.collection(accountB.id).pinned)
    }

    @Test fun loginAndLocalEditsAutomaticallySynchronizeWithoutManualRequests() = runTest {
        val storage = FakeStorage()
        var remote = Library(2, ListeningCollection(favorites = listOf(stationA.saved())))
        val api = FakeApi().apply {
            onLogin = { SessionDto(accountA) }
            onLibrary = { remote }
            onSave = { Library(it.revision + 1, it.collection).also { result -> remote = result } }
        }
        val repository = LibraryRepository(storage, api, FakeSession(null), json, backgroundScope)
        assertTrue(repository.login("listener_a", "test-only-password"))
        runCurrent()
        assertEquals(listOf(stationA.id), storage.collection(accountA.id).favorites.map { it.id })
        assertTrue(repository.favorite(stationB))
        runCurrent()
        assertEquals(setOf(stationA.id, stationB.id), remote.collection.favorites.map { it.id }.toSet())
        assertTrue(storage.pending(accountA.id).isEmpty())
    }

    @Test fun foregroundPollingPullsRemoteChangesWithNoPendingEditsAndStopsWhenCancelled() = runTest {
        val storage = FakeStorage()
        var remote = Library()
        var reads = 0
        val api = FakeApi().apply { onLibrary = { reads++; remote } }
        val repository = LibraryRepository(storage, api, FakeSession(accountA), json, backgroundScope)
        val polling = backgroundScope.launch { repository.syncWhileActive() }
        runCurrent()
        assertEquals(1, reads)
        remote = Library(1, ListeningCollection(favorites = listOf(stationB.saved())))
        advanceTimeBy(30_000)
        runCurrent()
        assertEquals(listOf(stationB.id), storage.collection(accountA.id).favorites.map { it.id })
        assertEquals(2, reads)
        polling.cancelAndJoin()
        advanceTimeBy(60_000)
        runCurrent()
        assertEquals(2, reads)
    }

    @Test fun localEditDuringSlowSyncReturnsAndIsReplayedWithoutAcknowledgingIt() = runTest {
        val storage = FakeStorage()
        storage.seed(accountA.id, ListeningCollection(favorites = listOf(stationA.saved())))
        storage.queue(accountA.id, LibraryOperation("favorite.add", stationA.saved()))
        val get = CompletableDeferred<Library>()
        val save = CompletableDeferred<Library>()
        var request: SaveLibrary? = null
        var reads = 0
        val api = FakeApi().apply {
            onLibrary = { if (++reads == 1) get.await() else awaitCancellation() }
            onSave = { request = it; save.await() }
        }
        val repository = LibraryRepository(storage, api, FakeSession(accountA), json, backgroundScope)
        val syncing = async { repository.synchronize() }
        runCurrent()
        assertTrue(repository.favorite(stationB))
        assertEquals(setOf(stationA.id, stationB.id), storage.collection(accountA.id).favorites.map { it.id }.toSet())
        get.complete(Library(4))
        runCurrent()
        assertEquals(listOf(stationA.id), request!!.collection.favorites.map { it.id })
        save.complete(Library(5, request!!.collection))
        assertTrue(syncing.await())
        assertEquals(setOf(stationA.id, stationB.id), storage.collection(accountA.id).favorites.map { it.id }.toSet())
        assertEquals(listOf(stationB.id), storage.pending(accountA.id).map { json.decodeFromString<LibraryOperation>(it.json).station!!.id })
    }

    @Test fun conflictRefetchPreservesRemoteAdditionsAndReappliesDeletion() = runTest {
        val storage = FakeStorage()
        storage.queue(accountA.id, LibraryOperation("favorite.remove", stationA.saved()))
        val song = SavedSong("Artist", "Title", 12)
        var reads = 0
        var writes = 0
        val api = FakeApi().apply {
            onLibrary = {
                val favorites = if (++reads == 1) listOf(stationA.saved(), stationB.saved()) else listOf(stationA.saved(), stationB.saved(), stationC.saved())
                Library(reads, ListeningCollection(favorites, listOf(song)))
            }
            onSave = { if (++writes == 1) throw http(409) else Library(it.revision + 1, it.collection) }
        }
        val repository = LibraryRepository(storage, api, FakeSession(accountA), json, backgroundScope)
        assertTrue(repository.synchronize())
        assertEquals(2, reads)
        assertEquals(2, writes)
        assertEquals(listOf(stationB.id, stationC.id), storage.collection(accountA.id).favorites.map { it.id })
        assertEquals(listOf(song), storage.collection(accountA.id).songs)
        assertTrue(storage.pending(accountA.id).isEmpty())
    }

    @Test fun conflictsHaveThreeAttemptBoundAndKeepPendingIntent() = runTest {
        val storage = FakeStorage()
        storage.queue(accountA.id, LibraryOperation("favorite.remove", stationA.saved()))
        var writes = 0
        val api = FakeApi().apply { onSave = { writes++; throw http(409) } }
        val repository = LibraryRepository(storage, api, FakeSession(accountA), json, backgroundScope)
        assertFalse(repository.synchronize())
        assertEquals(3, writes)
        assertEquals(1, storage.pending(accountA.id).size)
        assertEquals("conflict", repository.account.value.error)
        assertFalse(repository.account.value.syncing)
    }

    @Test fun offlineLogoutWithKeepCancelsSyncAndSeparatesGuestAndNextAccount() = runTest {
        val storage = FakeStorage()
        storage.seed(accountA.id, ListeningCollection(favorites = listOf(stationA.saved())))
        storage.seed(LibraryRepository.GUEST, ListeningCollection(favorites = listOf(stationB.saved())))
        storage.queue(accountA.id, LibraryOperation("favorite.add", stationA.saved()))
        val session = FakeSession(accountA)
        val api = FakeApi().apply {
            onLibrary = { awaitCancellation() }
            onLogout = { throw IOException("OFFLINE") }
            onLogin = { SessionDto(accountB) }
        }
        val repository = LibraryRepository(storage, api, session, json, backgroundScope)
        val syncing = async { repository.synchronize() }
        runCurrent()
        assertTrue(repository.logout(keepPending = true))
        runCurrent()
        assertTrue(syncing.isCancelled)
        assertNull(session.user())
        assertNull(repository.account.value.user)
        assertEquals(listOf(stationB.id), repository.collection.value.favorites.map { it.id })
        assertTrue(repository.login("listener_b", "test-only-password"))
        runCurrent()
        assertEquals(accountB, repository.account.value.user)
        assertTrue(repository.collection.value.favorites.isEmpty())
        assertEquals(1, storage.pending(accountA.id).size)
        assertTrue(storage.pending(accountB.id).isEmpty())
        assertEquals(listOf(stationA.id), storage.collection(accountA.id).favorites.map { it.id })
    }

    @Test fun expiredSessionKeepsAccountQueueAndRevertsToGuest() = runTest {
        val storage = FakeStorage()
        storage.seed(LibraryRepository.GUEST, ListeningCollection(favorites = listOf(stationB.saved())))
        storage.queue(accountA.id, LibraryOperation("favorite.add", stationA.saved()))
        val session = FakeSession(accountA)
        val api = FakeApi().apply { onLibrary = { throw http(401) } }
        val repository = LibraryRepository(storage, api, session, json, backgroundScope)
        assertFalse(repository.synchronize())
        runCurrent()
        assertNull(session.user())
        assertNull(repository.account.value.user)
        assertEquals("expired", repository.account.value.error)
        assertEquals(1, storage.pending(accountA.id).size)
        assertEquals(listOf(stationB.id), repository.collection.value.favorites.map { it.id })
        assertEquals(0, repository.pending.value)
    }

    @Test fun canceledLoginClearsCookieWhichArrivedBeforeBody() = runTest {
        val session = FakeSession(null)
        val api = FakeApi().apply { onLogin = { session.setUser(accountA); awaitCancellation() } }
        val repository = LibraryRepository(FakeStorage(), api, session, json, backgroundScope)
        val login = launch { repository.login("listener_a", "test-only-password") }
        runCurrent()
        assertNotNull(session.user())
        login.cancelAndJoin()
        assertNull(session.user())
        assertNull(repository.account.value.user)
        assertFalse(repository.account.value.syncing)
    }

    @Test fun defaultLogoutDoesNotDiscardOfflineChanges() = runTest {
        val storage = FakeStorage()
        storage.queue(accountA.id, LibraryOperation("favorite.add", stationA.saved()))
        val session = FakeSession(accountA)
        val api = FakeApi().apply { onLibrary = { throw IOException("OFFLINE") } }
        val repository = LibraryRepository(storage, api, session, json, backgroundScope)
        assertFalse(repository.logout(keepPending = false))
        assertEquals(accountA, repository.account.value.user)
        assertEquals(accountA, session.user())
        assertEquals(1, storage.pending(accountA.id).size)
        assertEquals("offline", repository.account.value.error)
    }

    @Test fun queueLimitRejectsWholeMutationWithoutDiscardingOlderDeletion() = runTest {
        val storage = FakeStorage()
        val deletion = json.encodeToString(LibraryOperation("favorite.remove", stationA.saved()))
        storage.rows.value = List(LibraryRepository.MAX_PENDING_OPERATIONS) { PendingEntity(it + 1L, accountA.id, deletion) }
        val api = FakeApi().apply { onLibrary = { awaitCancellation() } }
        val repository = LibraryRepository(storage, api, FakeSession(accountA), json, backgroundScope)
        assertFalse(repository.favorite(stationB))
        assertTrue(storage.collection(accountA.id).favorites.isEmpty())
        assertEquals(LibraryRepository.MAX_PENDING_OPERATIONS, storage.pending(accountA.id).size)
        assertEquals("queue_full", repository.account.value.error)
    }

    @Test fun malformedRemoteCollectionNeverReplacesLastLocalCopyOrAcknowledgesQueue() = runTest {
        val storage = FakeStorage()
        storage.seed(accountA.id, ListeningCollection(favorites = listOf(stationB.saved())))
        storage.queue(accountA.id, LibraryOperation("favorite.remove", stationA.saved()))
        val api = FakeApi().apply { onLibrary = { Library(2, ListeningCollection(favorites = listOf(stationA.saved(), stationA.saved()))) } }
        val repository = LibraryRepository(storage, api, FakeSession(accountA), json, backgroundScope)
        assertFalse(repository.synchronize())
        assertEquals("invalid_data", repository.account.value.error)
        assertEquals(listOf(stationB.id), storage.collection(accountA.id).favorites.map { it.id })
        assertEquals(1, storage.pending(accountA.id).size)
    }

    @Test fun restoredRevokedSessionClearsPersistedIdentity() = runTest {
        val session = FakeSession(accountA)
        val repository = LibraryRepository(FakeStorage(), FakeApi(), session, json, backgroundScope)
        repository.restoreSession()
        assertNull(session.user())
        assertNull(repository.account.value.user)
    }

    private class FakeSession(private var current: AccountUser?) : SessionStore {
        override fun user() = current
        override fun setUser(user: AccountUser?) { current = user }
        override fun clear() { current = null }
    }

    private class FakeStorage : LibraryStorage {
        val libraries = MutableStateFlow<Map<String, LibraryEntity>>(emptyMap())
        val rows = MutableStateFlow<List<PendingEntity>>(emptyList())
        var nextId = 1L
        override fun observe(owner: String): Flow<LibraryEntity?> = libraries.map { it[owner] }
        override fun pendingCount(owner: String): Flow<Int> = rows.map { all -> all.count { it.owner == owner } }
        override suspend fun library(owner: String) = libraries.value[owner]
        override suspend fun pending(owner: String) = rows.value.filter { it.owner == owner }
        override suspend fun pendingSize(owner: String) = rows.value.count { it.owner == owner }
        override suspend fun save(entity: LibraryEntity) { libraries.value = libraries.value + (entity.owner to entity) }
        override suspend fun enqueue(entity: PendingEntity) { rows.value = rows.value + entity.copy(id = nextId++) }
        override suspend fun acknowledgeThrough(owner: String, id: Long) { rows.value = rows.value.filterNot { it.owner == owner && it.id <= id } }
        override suspend fun <T> transaction(block: suspend () -> T): T = block()
    }

    private class FakeApi : RadioApi {
        var onLibrary: suspend (String) -> Library = { Library() }
        var onSave: suspend (SaveLibrary) -> Library = { Library(it.revision + 1, it.collection) }
        var onLogin: suspend (Credentials) -> SessionDto = { SessionDto(null) }
        var onLogout: suspend (Owner) -> SessionDto = { SessionDto(null) }
        override suspend fun session() = SessionDto(null)
        override suspend fun login(credentials: Credentials) = onLogin(credentials)
        override suspend fun logout(owner: Owner) = onLogout(owner)
        override suspend fun library(userId: String) = onLibrary(userId)
        override suspend fun saveLibrary(body: SaveLibrary) = onSave(body)
        override suspend fun stations(q: String, genres: String?, languages: String?, bitrate: Int, offset: Int, limit: Int, playable: Boolean, excludeIds: String?): StationPage = error("Not used")
        override suspend fun randomChina(): RandomStationResult = error("Not used")
        override suspend fun station(id: String): StationDto = error("Not used")
        override suspend fun manifest(): ManifestDto = error("Not used")
        override suspend fun sceneManifest(): ManifestDto = error("Not used")
        override suspend fun sceneChunk(version: String, index: Int): SceneChunkDto = error("Not used")
        override suspend fun lookup(body: StationLookup): StationLookupResult = error("Not used")
        override suspend fun chunk(version: String, index: Int): ChunkDto = error("Not used")
    }
}
