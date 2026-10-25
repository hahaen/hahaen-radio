package xyz.hahaen.radio.feature

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import xyz.hahaen.radio.data.local.Preferences
import xyz.hahaen.radio.data.repository.*
import xyz.hahaen.radio.domain.Station
import javax.inject.Inject

data class SearchState(
    val query: String = "", val genres: Set<String>? = null, val languages: Set<String>? = null,
    val bitrate: Int = 0, val favoritesOnly: Boolean = false, val owner: String = LibraryRepository.GUEST,
    val items: List<Station> = emptyList(), val total: Int = 0, val offset: Int = 0,
    val loading: Boolean = false, val error: String? = null,
)

@HiltViewModel class RadioViewModel @Inject constructor(
    val catalog: CatalogRepository, val library: LibraryRepository, val preferences: Preferences,
    @ApplicationContext context: Context,
) : ViewModel() {
    private val mutableSearch = MutableStateFlow(SearchState())
    val search = mutableSearch.asStateFlow()
    private val mutableNotice = MutableStateFlow<String?>(null)
    val notice = mutableNotice.asStateFlow()
    private var searchJob: Job? = null
    private var searchGeneration = 0
    private val connectivity = context.getSystemService(ConnectivityManager::class.java)
    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) { library.refresh() }
    }
    init {
        connectivity.registerDefaultNetworkCallback(networkCallback)
        search()
        viewModelScope.launch { library.restoreSession(); library.synchronize() }
        loadScene()
        viewModelScope.launch {
            combine(
                library.account.map { it.user?.id ?: LibraryRepository.GUEST }.distinctUntilChanged(),
                library.ownedCollections.map { (owner, collection) -> owner to collection.favorites.map { it.id }.toSet() }.distinctUntilChanged(),
                catalog.scene,
            ) { owner, favorites, scene -> Triple(owner, favorites, scene) }.collect {
                if (mutableSearch.value.favoritesOnly) search()
            }
        }
        viewModelScope.launch { while (isActive) { delay(60000); if (library.pending.value > 0) library.synchronize() } }
    }
    fun loadScene() { viewModelScope.launch { try { catalog.loadScene() } catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { mutableNotice.value = "catalog" } } }
    fun search(
        query: String = mutableSearch.value.query, genres: Set<String>? = mutableSearch.value.genres,
        languages: Set<String>? = mutableSearch.value.languages, bitrate: Int = mutableSearch.value.bitrate,
        favoritesOnly: Boolean = mutableSearch.value.favoritesOnly,
    ) {
        searchJob?.cancel()
        val expected = ++searchGeneration
        val owner = library.account.value.user?.id ?: LibraryRepository.GUEST
        val request = SearchState(query = query.take(200), genres = genres?.toSet(), languages = languages?.take(32)?.toSet(),
            bitrate = bitrate, favoritesOnly = favoritesOnly, owner = owner, loading = true)
        if (request.genres?.isEmpty() == true || request.languages?.isEmpty() == true ||
            (favoritesOnly && favoriteIds(owner).isEmpty())) {
            mutableSearch.value = request.copy(loading = false)
            return
        }
        mutableSearch.value = request
        searchJob = viewModelScope.launch { delay(250); fetch(expected, request, false) }
    }

    private fun favoriteIds(owner: String): Set<String> = library.ownedCollections.value
        .takeIf { it.first == owner }?.second?.favorites?.map { it.id }?.toSet() ?: emptySet()

    fun more() {
        val request = search.value
        if (request.loading || request.offset >= request.total) return
        val expected = searchGeneration
        mutableSearch.value = request.copy(loading = true, error = null)
        searchJob = viewModelScope.launch { fetch(expected, request, true) }
    }

    fun retry() { if (search.value.items.isEmpty()) search() else more() }

    private suspend fun fetch(expected: Int, request: SearchState, append: Boolean) {
        fun current() = searchGeneration == expected && (!request.favoritesOnly ||
            request.owner == (library.account.value.user?.id ?: LibraryRepository.GUEST))
        if (!current()) return
        try {
            val offset = if (append) request.offset else 0
            val (items, total) = if (request.favoritesOnly) {
                val favorites = favoriteIds(request.owner)
                val available = catalog.scene.value
                val cached = withContext(Dispatchers.Default) { available.filter { it.id in favorites } }
                val missing = favorites - cached.map { it.id }.toSet()
                if (!current()) return
                val source = cached + if (missing.isEmpty()) emptyList() else catalog.lookup(missing.toList())
                val matches = withContext(Dispatchers.Default) {
                    filterStations(source, request.query, request.genres, request.languages, request.bitrate, favorites)
                }
                matches.drop(offset).take(30) to matches.size
            } else {
                val page = catalog.search(request.query, request.genres?.joinToString(","),
                    request.languages?.joinToString(","), request.bitrate, offset)
                page.items.map { it.model() } to page.total
            }
            if (!current()) return
            mutableSearch.value = request.copy(items = ((if (append) request.items else emptyList()) + items).distinctBy { it.id },
                total = total, offset = offset + items.size, loading = false, error = null)
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (error: Exception) {
            if (current()) mutableSearch.update { it.copy(loading = false, error = errorCode(error)) }
        }
    }
    fun favorite(station: Station) { viewModelScope.launch { library.favorite(station) } }
    fun clearHistory() { viewModelScope.launch { library.clearHistory() } }
    fun preference(key: String, value: Boolean) { viewModelScope.launch {
        if (key == "pinned" && library.account.value.user != null) library.setPinned(value)
        else preferences.boolean(key, value)
    } }
    fun scene(value: String) { viewModelScope.launch { preferences.scene(value) } }
    fun login(username: String, password: String) { viewModelScope.launch { library.login(username, password) } }
    fun logout(keepPending: Boolean) { viewModelScope.launch { library.logout(keepPending) } }
    fun dismissNotice() { mutableNotice.value = null }
    override fun onCleared() { connectivity.unregisterNetworkCallback(networkCallback) }
}
