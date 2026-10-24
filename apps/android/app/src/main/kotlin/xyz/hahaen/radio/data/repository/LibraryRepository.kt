package xyz.hahaen.radio.data.repository

import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import retrofit2.HttpException
import xyz.hahaen.radio.data.local.LibraryEntity
import xyz.hahaen.radio.data.local.PendingEntity
import xyz.hahaen.radio.data.local.RadioDatabase
import xyz.hahaen.radio.data.remote.*
import xyz.hahaen.radio.domain.*
import java.util.Locale
import javax.inject.Inject
import javax.inject.Singleton

data class AccountState(val user: AccountUser? = null, val syncing: Boolean = false, val error: String? = null)

@Singleton class LibraryRepository internal constructor(
    private val storage: LibraryStorage, private val api: RadioApi,
    private val session: SessionStore, private val json: Json, private val scope: CoroutineScope,
) {
    @Inject constructor(database: RadioDatabase, api: RadioApi, session: SecureSession, json: Json) :
        this(RoomLibraryStorage(database), api, session, json, CoroutineScope(SupervisorJob() + Dispatchers.IO))

    // Only local state and database transactions run under gate; slow sync never blocks a local edit.
    private val gate = Mutex()
    private val authGate = Mutex()
    private val syncGate = Mutex()
    private val logoutGate = Mutex()
    private val ioContext = scope.coroutineContext.minusKey(Job)
    private val requests = Channel<Unit>(Channel.CONFLATED)
    private var identityGeneration = 0L
    private var transitioning = false
    private var activeSync: Job? = null
    private val mutableAccount = MutableStateFlow(AccountState(session.user()))
    val account = mutableAccount.asStateFlow()
    private val owner = account.map { it.user?.id ?: GUEST }.distinctUntilChanged()

    @OptIn(ExperimentalCoroutinesApi::class)
    val ownedCollections = owner.flatMapLatest { key ->
        storage.observe(key).map { entity ->
            key to try { decode(entity).collection }
            catch (_: Exception) {
                mutableAccount.update { if ((it.user?.id ?: GUEST) == key) it.copy(error = "storage") else it }
                ListeningCollection()
            }
        }.catch { error ->
            if (error is CancellationException) throw error
            mutableAccount.update { if ((it.user?.id ?: GUEST) == key) it.copy(error = "storage") else it }
            emit(key to ListeningCollection())
        }
    }.stateIn(scope, SharingStarted.Eagerly, (account.value.user?.id ?: GUEST) to ListeningCollection())
    val collection = combine(account, ownedCollections) { state, data ->
        if (data.first == (state.user?.id ?: GUEST)) data.second else ListeningCollection()
    }.stateIn(scope, SharingStarted.Eagerly, ListeningCollection())

    @OptIn(ExperimentalCoroutinesApi::class)
    private val ownedPending = owner.flatMapLatest { key -> storage.pendingCount(key).map { key to it } }
    val pending = combine(account, ownedPending) { state, data ->
        if (data.first == (state.user?.id ?: GUEST)) data.second else 0
    }.stateIn(scope, SharingStarted.Eagerly, 0)

    init {
        scope.launch {
            for (request in requests) {
                try { synchronize() }
                catch (_: CancellationException) { currentCoroutineContext().ensureActive() }
            }
        }
    }

    private fun decode(entity: LibraryEntity?): Library = entity?.let {
        Library(it.revision, json.decodeFromString<ListeningCollection>(it.json)).validated()
    } ?: Library()
    private fun save(owner: String, library: Library) = LibraryEntity(owner, library.revision, json.encodeToString(library.collection))
    fun refresh() { requests.trySend(Unit) }

    private suspend fun beginTransition() = gate.withLock {
        transitioning = true
        identityGeneration++
        activeSync?.cancel()
        activeSync = null
        mutableAccount.update { it.copy(syncing = true, error = null) }
    }

    private suspend fun endTransition() = withContext(NonCancellable) {
        gate.withLock {
            transitioning = false
            mutableAccount.update { it.copy(syncing = false) }
        }
    }

    suspend fun restoreSession() = withContext(ioContext) {
        authGate.withLock {
            beginTransition()
            try {
                val user = api.session().user?.validated()
                gate.withLock {
                    session.setUser(user)
                    mutableAccount.value = AccountState(user)
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) {
                gate.withLock { mutableAccount.update { it.copy(error = errorCode(error)) } }
            } finally { endTransition() }
        }
    }

    suspend fun login(username: String, password: String): Boolean = withContext(ioContext) {
        authGate.withLock {
            if (mutableAccount.value.user != null) return@withLock false
            beginTransition()
            try {
                session.clear()
                val user = api.login(Credentials(username.trim().lowercase(Locale.ROOT), password)).user
                    ?.validated() ?: throw InvalidLibraryData()
                gate.withLock {
                    session.setUser(user)
                    mutableAccount.value = AccountState(user)
                }
                true
            } catch (cancelled: CancellationException) {
                // A cancelled response may already have delivered Set-Cookie through OkHttp.
                session.clear()
                mutableAccount.value = AccountState()
                throw cancelled
            } catch (error: Exception) {
                session.clear()
                mutableAccount.value = AccountState(error = errorCode(error))
                false
            } finally { endTransition(); refresh() }
        }
    }

    /** Keeping queued changes is an explicit UI choice; they remain attached to this account. */
    suspend fun logout(keepPending: Boolean): Boolean = withContext(ioContext) {
        if (!keepPending && !synchronize() && mutableAccount.value.user != null) return@withContext false
        authGate.withLock {
            // An edit initiated on the account screen cannot slip into the guest library while exiting.
            logoutGate.withLock {
                val user = gate.withLock {
                    val current = mutableAccount.value.user ?: return@withContext true
                    if (!keepPending && storage.pendingSize(current.id) > 0) return@withContext false
                    current
                }
                beginTransition()
                try {
                    try { api.logout(Owner(user.id)) }
                    catch (cancelled: CancellationException) { throw cancelled }
                    catch (error: Exception) {
                        // A revoked/expired server session is already logged out.
                        if (!keepPending && !(error is HttpException && error.code() == 401)) {
                            mutableAccount.update { it.copy(error = errorCode(error)) }
                            return@withContext false
                        }
                    }
                    gate.withLock {
                        session.clear()
                        mutableAccount.value = AccountState()
                    }
                    true
                } finally { endTransition() }
            }
        }
    }

    suspend fun favorite(station: Station): Boolean = mutate { current ->
        LibraryOperation(if (current.favorites.any { it.id.equals(station.id, ignoreCase = true) }) "favorite.remove" else "favorite.add", station.saved())
    }
    suspend fun heard(station: Station): Boolean = mutate { LibraryOperation("history.add", station.saved()) }
    suspend fun clearHistory(): Boolean = mutate { LibraryOperation("history.clear") }
    private fun Station.saved() = SavedStation(id.lowercase(Locale.ROOT), name.trim().take(512), countryCode, System.currentTimeMillis())

    private suspend fun mutate(operation: (ListeningCollection) -> LibraryOperation): Boolean {
        val expectedOwner = mutableAccount.value.user?.id ?: GUEST
        return withContext(ioContext) {
            val success = logoutGate.withLock {
                gate.withLock mutation@ {
                    val key = mutableAccount.value.user?.id ?: GUEST
                    if (key != expectedOwner) return@mutation false
                    try {
                        storage.transaction {
                            val old = decode(storage.library(key))
                            val change = operation(old.collection).validated()
                            if (key != GUEST && storage.pendingSize(key) >= MAX_PENDING_OPERATIONS) throw PendingLimitReached()
                            storage.save(save(key, old.copy(collection = applyOperations(old.collection, listOf(change)))))
                            if (key != GUEST) storage.enqueue(PendingEntity(owner = key, json = json.encodeToString(change)))
                        }
                        mutableAccount.update { if (it.error == "storage" || it.error == "queue_full") it.copy(error = null) else it }
                        true
                    } catch (cancelled: CancellationException) { throw cancelled }
                    catch (error: Exception) {
                        mutableAccount.update { it.copy(error = when (error) {
                            is PendingLimitReached -> "queue_full"
                            is InvalidLibraryData -> "invalid_data"
                            else -> "storage"
                        }) }
                        false
                    }
                }
            }
            if (success) refresh()
            success
        }
    }

    suspend fun synchronize(): Boolean = withContext(ioContext) {
        coroutineScope {
            syncGate.withLock sync@ {
                val job = currentCoroutineContext().job
                val snapshot = gate.withLock snapshot@ {
                    val user = mutableAccount.value.user ?: return@snapshot null
                    if (transitioning) return@snapshot null
                    activeSync = job
                    mutableAccount.update { it.copy(syncing = true, error = null) }
                    user to identityGeneration
                } ?: return@sync (mutableAccount.value.user == null)
                val (user, generation) = snapshot
                fun current() = generation == identityGeneration && mutableAccount.value.user?.id == user.id && !transitioning
                try {
                    repeat(3) { attempt ->
                        val queued = gate.withLock snapshot@ {
                            if (!current()) return@snapshot null
                            storage.pending(user.id)
                        } ?: return@sync false
                        val remote = api.library(user.id).validated()
                        val merged = applyOperations(remote.collection, queued.map { json.decodeFromString<LibraryOperation>(it.json).validated() })
                        val result = try {
                            if (queued.isEmpty()) remote else {
                                val request = SaveLibrary(user.id, remote.revision, merged)
                                if (json.encodeToString(request).toByteArray(Charsets.UTF_8).size > MAX_LIBRARY_BYTES) throw InvalidLibraryData()
                                api.saveLibrary(request).validated().also { if (it.revision < remote.revision) throw InvalidLibraryData() }
                            }
                        } catch (error: HttpException) {
                            if (error.code() == 409 && attempt < 2) return@repeat else throw error
                        }
                        gate.withLock {
                            currentCoroutineContext().ensureActive()
                            if (!current()) return@sync false
                            storage.transaction {
                                val sentThrough = queued.lastOrNull()?.id ?: 0
                                // The user can edit while GET/POST is pending. Keep and replay every later operation.
                                val remaining = storage.pending(user.id).filter { it.id > sentThrough }
                                val local = result.copy(collection = applyOperations(result.collection,
                                    remaining.map { json.decodeFromString<LibraryOperation>(it.json).validated() }))
                                storage.save(save(user.id, local))
                                if (sentThrough > 0) storage.acknowledgeThrough(user.id, sentThrough)
                            }
                            mutableAccount.update { it.copy(error = null) }
                        }
                        return@sync true
                    }
                    false
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (error: Exception) {
                    gate.withLock {
                        if (current()) {
                            if (error is HttpException && error.code() == 401) {
                                session.clear()
                                identityGeneration++
                                mutableAccount.value = AccountState(error = "expired")
                            } else mutableAccount.update { it.copy(error = errorCode(error)) }
                        }
                    }
                    false
                } finally {
                    withContext(NonCancellable) {
                        gate.withLock {
                            if (activeSync == job) {
                                activeSync = null
                                mutableAccount.update { it.copy(syncing = false) }
                            }
                        }
                    }
                }
            }
        }
    }

    companion object {
        const val GUEST = "guest"
        const val MAX_PENDING_OPERATIONS = 10_000
        private const val MAX_LIBRARY_BYTES = 24 * 1024 * 1024
    }
}

private class PendingLimitReached : Exception()

fun errorCode(error: Exception): String = when (error) {
    is InvalidLibraryData -> "invalid_data"
    is HttpException -> when (error.code()) {
        400, 413 -> "invalid_data"
        401 -> "credentials"
        409 -> "conflict"
        429 -> "limited"
        503 -> "unavailable"
        else -> "network"
    }
    else -> "offline"
}
