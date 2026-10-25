package xyz.hahaen.radio.feature

import android.content.Intent
import android.os.PowerManager
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.os.LocaleListCompat
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.animation.*
import androidx.compose.animation.core.tween
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation3.runtime.*
import androidx.navigation3.ui.NavDisplay
import kotlinx.coroutines.delay
import kotlinx.serialization.Serializable
import xyz.hahaen.radio.BuildConfig
import xyz.hahaen.radio.R
import xyz.hahaen.radio.app.theme.*
import xyz.hahaen.radio.data.local.ListeningPreferences
import xyz.hahaen.radio.data.repository.AccountState
import xyz.hahaen.radio.domain.*
import xyz.hahaen.radio.graphics.RadioScene
import xyz.hahaen.radio.graphics.StaticRadioScene
import xyz.hahaen.radio.data.repository.LibraryRepository
import xyz.hahaen.radio.playback.PlaybackConnection
import java.time.ZonedDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@Serializable private enum class Screen : NavKey { HOME, SEARCH, LIBRARY, SETTINGS, ACCOUNT, IMMERSIVE }

@Composable fun RadioApp(model: RadioViewModel, controls: PlaybackConnection) = HaenTheme {
    val playback by controls.state.collectAsStateWithLifecycle()
    val localPreferences by model.preferences.state.collectAsStateWithLifecycle(ListeningPreferences())
    val accountPinned by model.library.pinned.collectAsStateWithLifecycle()
    val preferences = localPreferences.copy(pinned = accountPinned ?: localPreferences.pinned)
    val account by model.library.account.collectAsStateWithLifecycle()
    val ownedCollection by model.library.ownedCollections.collectAsStateWithLifecycle()
    val pending by model.library.pending.collectAsStateWithLifecycle()
    val stations by model.catalog.scene.collectAsStateWithLifecycle()
    val notice by model.notice.collectAsStateWithLifecycle()
    val backStack = rememberNavBackStack(Screen.HOME)
    val screen = backStack.last() as Screen
    var graphicsFailed by rememberSaveable { mutableStateOf(false) }
    val context = LocalContext.current
    val imeVisible = WindowInsets.ime.getBottom(LocalDensity.current) > 0
    val systemPowerSave = context.getSystemService(PowerManager::class.java).isPowerSaveMode
    fun navigate(next: Screen) { if (backStack.last() != next) backStack.add(next) }
    fun back() { if (backStack.size > 1) backStack.removeLastOrNull() }
    Box(Modifier.fillMaxSize().background(Ink)) {
        Scaffold(containerColor = Color.Transparent, contentColor = Warm,
            topBar = { Header(screen, ::back, ::navigate) },
            bottomBar = {
                if (screen != Screen.HOME && screen != Screen.IMMERSIVE && !imeVisible) MiniPlayer(playback, controls) { backStack.clear(); backStack.add(Screen.HOME) }
            }) { padding ->
            // Surface intercepts touches to siblings behind it, even with a transparent color.
            // Keep the scene inside Scaffold so unhandled touches can hit the AndroidView.
            Box(Modifier.fillMaxSize()) {
                if (screen == Screen.HOME || screen == Screen.IMMERSIVE) {
                    if (preferences.graphics && !graphicsFailed) RadioScene(stations, playback,
                        if (screen == Screen.IMMERSIVE) preferences.scene else "globe",
                        preferences.powerSave || preferences.reduceMotion || systemPowerSave,
                        Modifier.fillMaxSize(), controls::select, { graphicsFailed = true })
                    else StaticRadioScene(screen == Screen.IMMERSIVE, preferences.scene, playback.station)
                    Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Ink.copy(alpha = .1f), Color.Transparent, Ink.copy(alpha = .97f)))))
                }
                NavDisplay(backStack = backStack, onBack = ::back, modifier = Modifier.padding(padding).consumeWindowInsets(padding).imePadding(),
                    transitionSpec = {
                        if (preferences.reduceMotion) fadeIn(tween(90)) togetherWith fadeOut(tween(90))
                        else (fadeIn(tween(220)) + slideInHorizontally(tween(220)) { it / 16 }) togetherWith fadeOut(tween(140))
                    },
                    popTransitionSpec = {
                        if (preferences.reduceMotion) fadeIn(tween(90)) togetherWith fadeOut(tween(90))
                        else (fadeIn(tween(180)) + slideInHorizontally(tween(180)) { -it / 16 }) togetherWith fadeOut(tween(140))
                    },
                    predictivePopTransitionSpec = { _ ->
                        if (preferences.reduceMotion) fadeIn(tween(90)) togetherWith fadeOut(tween(90))
                        else (fadeIn(tween(180)) + slideInHorizontally(tween(180)) { -it / 16 }) togetherWith
                            (fadeOut(tween(180)) + slideOutHorizontally(tween(180)) { it / 16 })
                    }, entryProvider = { key ->
                    NavEntry(key) {
                        // Entries survive an unchanged back stack; derive from State here so
                        // current playback and identity changes invalidate this content.
                        val collection = if (ownedCollection.first == (account.user?.id ?: LibraryRepository.GUEST))
                            ownedCollection.second else ListeningCollection()
                        val favorite = playback.station?.id?.let { id -> collection.favorites.any { it.id == id } } == true
                        when (key as Screen) {
                            Screen.HOME, Screen.IMMERSIVE -> ListeningScreen(playback, controls, favorite, preferences,
                                immersive = key == Screen.IMMERSIVE,
                                libraryError = account.error?.takeIf { it == "queue_full" || it == "storage" },
                                onFavorite = { playback.station?.let(model::favorite) },
                                onPin = { model.preference("pinned", !preferences.pinned) },
                                onImmersive = { navigate(Screen.IMMERSIVE) }, onScene = model::scene,
                                graphicsFailed = graphicsFailed, onRetryGraphics = { graphicsFailed = false },
                                catalogNotice = if (notice != null) notice else if (stations.isEmpty()) "loading" else null,
                                onRetryCatalog = { model.dismissNotice(); model.loadScene() })
                            Screen.SEARCH -> SearchScreen(model, playback, controls::select)
                            Screen.LIBRARY -> LibraryScreen(collection, playback, account.error, model, controls::select) { navigate(Screen.SEARCH) }
                            Screen.SETTINGS -> SettingsScreen(preferences, playback, account, model, controls) { navigate(Screen.ACCOUNT) }
                            Screen.ACCOUNT -> AccountScreen(account, pending, model)
                        }
                    }
                })
            }
        }
    }
}

@Composable private fun Header(screen: Screen, back: () -> Unit, navigate: (Screen) -> Unit) {
    val home = screen == Screen.HOME
    val fontScale = LocalDensity.current.fontScale
    BoxWithConstraints(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 12.dp, vertical = 8.dp)) {
        val stacked = home && (fontScale > 1.5f || (maxWidth < 340.dp && fontScale > 1.15f))
        Column {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                if (!home) IconAction(Icons.AutoMirrored.Filled.ArrowBack, R.string.back, back)
                Column(Modifier.weight(1f).padding(start = if (home) 8.dp else 4.dp)) {
                    if (home || screen == Screen.IMMERSIVE) {
                        BrandName()
                        if (home) Text(stringResource(R.string.tagline), color = Muted, style = MaterialTheme.typography.labelSmall)
                    } else Text(stringResource(when(screen) {
                        Screen.SEARCH -> R.string.search; Screen.LIBRARY -> R.string.library
                        Screen.SETTINGS -> R.string.settings; else -> R.string.account
                    }), style = MaterialTheme.typography.titleLarge)
                }
                if (home && !stacked) HeaderTools(navigate)
            }
            if (stacked) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) { HeaderTools(navigate) }
        }
    }
}

@Composable private fun BrandName() {
    val brand = stringResource(R.string.app_name)
    val latinStart = brand.indexOf("HAEN").coerceAtLeast(0)
    Text(buildAnnotatedString {
        append(brand.take(latinStart))
        withStyle(SpanStyle(fontFamily = BodyFont, fontWeight = FontWeight.Medium)) { append(brand.drop(latinStart)) }
    }, fontFamily = DisplayFont, fontSize = 21.sp, lineHeight = 29.sp)
}

@Composable private fun RowScope.HeaderTools(navigate: (Screen) -> Unit) {
    IconAction(Icons.Outlined.Search, R.string.search, { navigate(Screen.SEARCH) }, subtle = true)
    IconAction(Icons.Outlined.FavoriteBorder, R.string.library, { navigate(Screen.LIBRARY) }, subtle = true)
    IconAction(Icons.Outlined.Tune, R.string.settings, { navigate(Screen.SETTINGS) }, subtle = true)
}

@Composable private fun pageGutter(minimum: Int = 20) =
    maxOf(minimum.dp, (LocalConfiguration.current.screenWidthDp.dp - 640.dp) / 2)

@Composable private fun IconAction(icon: ImageVector, label: Int, action: () -> Unit,
    selected: Boolean = false, enabled: Boolean = true, subtle: Boolean = false) {
    val toggle = label == R.string.favorite || label == R.string.unfavorite || label == R.string.pin || label == R.string.unpin
    IconButton(onClick = action, enabled = enabled,
        modifier = Modifier.size(48.dp).semantics { if (toggle) this.selected = selected }) {
        Box(Modifier.size(38.dp).clip(CircleShape).background(if (subtle) Panel.copy(alpha = .75f) else Color.Transparent),
            contentAlignment = Alignment.Center) {
            Icon(icon, stringResource(label), tint = when { !enabled -> Muted.copy(alpha = .38f); selected -> Coral; else -> Warm },
                modifier = Modifier.size(22.dp))
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun ListeningScreen(playback: PlaybackState, controls: PlaybackConnection, favorite: Boolean,
    preferences: ListeningPreferences, immersive: Boolean, libraryError: String?,
    onFavorite: () -> Unit, onPin: () -> Unit, onImmersive: () -> Unit, onScene: (String) -> Unit,
    graphicsFailed: Boolean, onRetryGraphics: () -> Unit, catalogNotice: String?, onRetryCatalog: () -> Unit) {
    val context = LocalContext.current
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val compact = maxHeight < 430.dp
        val wide = compact && maxWidth >= 600.dp
        val gutter = if (maxWidth < 360.dp) 16.dp else 24.dp
        val centeredInfo = immersive && !wide
        val alignment = if (centeredInfo) Alignment.CenterHorizontally else Alignment.Start
        val information: @Composable ColumnScope.() -> Unit = {
            if (graphicsFailed) {
                Text(stringResource(R.string.graphics_fallback), color = Muted, style = MaterialTheme.typography.bodySmall)
                TextButton(onClick = onRetryGraphics) { Text(stringResource(R.string.graphics_retry), color = Warm) }
            }
            if (catalogNotice != null && catalogNotice != "loading" && !immersive) TextButton(onClick = onRetryCatalog) {
                Text(stringResource(R.string.catalog_error), style = MaterialTheme.typography.bodySmall, color = Muted)
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (playback.station != null) NightSignal(playback.playing && !playback.connecting,
                    motionAllowed = !preferences.reduceMotion && !preferences.powerSave)
                Text(stringResource(when { playback.connecting -> R.string.connecting; playback.playing -> R.string.playing;
                    playback.station != null -> R.string.paused; else -> R.string.idle }),
                    color = if(playback.playing) Coral else Muted, style = MaterialTheme.typography.bodySmall)
            }
            Spacer(Modifier.height(10.dp))
            Text(playback.station?.name ?: stringResource(R.string.welcome), fontFamily = DisplayFont,
                fontSize = if (compact || (playback.station?.name?.length ?: 0) > 36) 28.sp else 34.sp,
                lineHeight = if (compact || (playback.station?.name?.length ?: 0) > 36) 36.sp else 44.sp,
                textAlign = if (centeredInfo) TextAlign.Center else TextAlign.Start)
            playback.station?.let { station ->
                Spacer(Modifier.height(10.dp))
                Text(station.location.ifEmpty { stringResource(R.string.precision_unknown) }, color = Muted,
                    style = MaterialTheme.typography.bodyMedium, textAlign = if (centeredInfo) TextAlign.Center else TextAlign.Start)
                FlowRow(Modifier.fillMaxWidth().padding(top = 6.dp),
                    horizontalArrangement = if (centeredInfo) Arrangement.spacedBy(12.dp, Alignment.CenterHorizontally) else Arrangement.spacedBy(12.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(listOfNotNull(genreLabel(station.genre), station.bitrate?.let { "$it kbps" }).joinToString(" · "),
                        color = Muted, style = MaterialTheme.typography.bodySmall)
                    Text(stringResource(when(station.locationPrecision) { "coordinates" -> R.string.precision_exact;
                        "country", "region" -> R.string.precision_region; else -> R.string.precision_unknown }),
                        color = SeaGlass, style = MaterialTheme.typography.bodySmall)
                }
            }
            playback.error?.let { ErrorText(it) }
            libraryError?.let { ErrorText(it) }
            if (playback.sleepRemainingMs > 0) Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(Icons.Outlined.Bedtime, null, Modifier.size(14.dp), tint = Muted)
                Text(stringResource(R.string.sleep_remaining, ((playback.sleepRemainingMs + 59999) / 60000).toInt()),
                    color = Muted, style = MaterialTheme.typography.bodySmall)
            }
        }
        val transport: @Composable () -> Unit = {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(24.dp, Alignment.CenterHorizontally),
                verticalAlignment = Alignment.CenterVertically) {
                IconAction(Icons.Default.SkipPrevious, R.string.previous, controls::previous)
                val playLabel = stringResource(if(playback.playing || playback.connecting) R.string.pause else R.string.play)
                FilledIconButton(onClick = controls::toggle, modifier = Modifier.size(if (compact) 64.dp else 72.dp)
                    .semantics { contentDescription = playLabel }, shape = CircleShape,
                    colors = IconButtonDefaults.filledIconButtonColors(containerColor = Coral, contentColor = Ink)) {
                    if(playback.connecting) CircularProgressIndicator(Modifier.size(26.dp), color = Ink, strokeWidth = 2.dp)
                    else Icon(if(playback.playing) Icons.Default.Pause else Icons.Default.PlayArrow, null, Modifier.size(32.dp))
                }
                IconAction(Icons.Default.SkipNext, R.string.next, controls::next)
            }
        }
        val secondary: @Composable () -> Unit = {
            Box(Modifier.fillMaxWidth().padding(top = 8.dp), contentAlignment = Alignment.Center) {
                Row(Modifier.widthIn(max = 320.dp).fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly,
                    verticalAlignment = Alignment.CenterVertically) {
                    IconAction(if(favorite) Icons.Default.Favorite else Icons.Outlined.FavoriteBorder,
                        if(favorite) R.string.unfavorite else R.string.favorite, onFavorite, favorite, enabled = playback.station != null)
                    if (!immersive) IconAction(Icons.Outlined.Album, R.string.immersive, onImmersive)
                    IconAction(Icons.Outlined.Share, R.string.share, {
                        playback.station?.let { station -> context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"; putExtra(Intent.EXTRA_TEXT, "${station.name}\nhttps://hahaen.xyz/radio/?station=${station.id}")
                        }, null)) }
                    }, enabled = playback.station != null)
                    IconAction(Icons.Outlined.PushPin, if(preferences.pinned) R.string.unpin else R.string.pin,
                        onPin, preferences.pinned, enabled = playback.station != null)
                }
            }
        }
        Column(Modifier.fillMaxSize().padding(horizontal = gutter), horizontalAlignment = alignment) {
            if (immersive) Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally)) {
                listOf("aurora" to R.string.aurora, "ocean" to R.string.ocean, "mountains" to R.string.mountains).forEach { (key, label) ->
                    NightPill(stringResource(label), preferences.scene == key, { onScene(key) })
                }
            } else if (!compact) Clock()
            if (wide) {
                Row(Modifier.fillMaxWidth().weight(1f).padding(vertical = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(24.dp), verticalAlignment = Alignment.CenterVertically) {
                    NightOverflowColumn(Modifier.weight(1f).fillMaxHeight(), horizontalAlignment = alignment, content = information)
                    Box(Modifier.width(248.dp).fillMaxHeight(), contentAlignment = Alignment.Center) {
                        NightOverflowColumn(Modifier.fillMaxWidth()) {
                            transport()
                            secondary()
                        }
                    }
                }
            } else {
                Column(Modifier.fillMaxWidth().weight(1f).padding(top = if (compact) 8.dp else 24.dp),
                    horizontalAlignment = alignment, verticalArrangement = Arrangement.Bottom) {
                    NightOverflowColumn(Modifier.fillMaxWidth().weight(1f, fill = false),
                        horizontalAlignment = alignment, content = information)
                    Spacer(Modifier.height(if (compact) 8.dp else 20.dp))
                    transport()
                    secondary()
                    Spacer(Modifier.height(if (compact) 8.dp else 20.dp))
                }
            }
        }
    }
}

@Composable private fun Clock() {
    var time by remember { mutableStateOf(ZonedDateTime.now(ZoneId.of("Asia/Shanghai"))) }
    LaunchedEffect(Unit) { while (true) { delay(1000); time = ZonedDateTime.now(ZoneId.of("Asia/Shanghai")) } }
    Column(Modifier.padding(top = 10.dp)) {
        Text(time.format(DateTimeFormatter.ofPattern("HH:mm:ss")), fontFamily = MonoFont, fontSize = 18.sp)
        Text(time.format(DateTimeFormatter.ofPattern("yyyy.MM.dd  EEE")), color = Muted, fontSize = 11.sp)
    }
}

@Composable private fun MiniPlayer(playback: PlaybackState, controls: PlaybackConnection, open: () -> Unit) {
    val fontScale = LocalDensity.current.fontScale
    val status = stringResource(when {
        playback.connecting -> R.string.connecting
        playback.playing -> R.string.playing
        playback.station != null -> R.string.paused
        else -> R.string.tagline
    })
    val playLabel = stringResource(when {
        playback.playing || playback.connecting -> R.string.pause
        playback.station == null -> R.string.choose_station
        else -> R.string.play
    })
    BoxWithConstraints(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = pageGutter(12), vertical = 8.dp)) {
        val stacked = (fontScale > 1.4f && maxWidth < 480.dp) || (maxWidth < 320.dp && fontScale > 1.15f)
        val identity: @Composable (Modifier) -> Unit = { modifier ->
            Row(modifier.heightIn(min = 64.dp).clip(RoundedCornerShape(12.dp))
                .clickable(role = Role.Button, onClick = open).padding(horizontal = 8.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                NightStationMark()
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(playback.station?.name ?: stringResource(R.string.app_name), color = Warm,
                        maxLines = if (stacked) 2 else 1, overflow = TextOverflow.Ellipsis,
                        style = MaterialTheme.typography.titleMedium.copy(fontSize = 15.sp, lineHeight = 21.sp))
                    Text(listOfNotNull(status, playback.station?.countryCode).joinToString(" · "),
                        maxLines = if (stacked) 2 else 1, overflow = TextOverflow.Ellipsis,
                        color = if (playback.playing) SeaGlass else Muted, style = MaterialTheme.typography.labelSmall)
                }
            }
        }
        val transport: @Composable () -> Unit = {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilledIconButton(onClick = controls::toggle,
                    modifier = Modifier.size(48.dp).semantics { contentDescription = playLabel }, shape = CircleShape,
                    colors = IconButtonDefaults.filledIconButtonColors(containerColor = Coral, contentColor = Ink)) {
                    if (playback.connecting) CircularProgressIndicator(Modifier.size(20.dp), color = Ink, strokeWidth = 2.dp)
                    else Icon(if (playback.playing) Icons.Default.Pause else Icons.Default.PlayArrow, null, Modifier.size(25.dp))
                }
                IconAction(Icons.Default.SkipNext, R.string.next, controls::next)
            }
        }
        Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(20.dp), color = Panel.copy(alpha = .97f),
            contentColor = Warm, border = BorderStroke(1.dp, SeaGlass.copy(alpha = .23f)), shadowElevation = 8.dp) {
            val panel = Modifier.background(Brush.linearGradient(listOf(Surface.copy(alpha = .55f), Color.Transparent)))
                .padding(horizontal = 6.dp, vertical = 6.dp)
            if (stacked) Column(panel) {
                identity(Modifier.fillMaxWidth())
                Row(Modifier.fillMaxWidth().padding(top = 4.dp, bottom = 4.dp), horizontalArrangement = Arrangement.End) { transport() }
            } else Row(panel, verticalAlignment = Alignment.CenterVertically) {
                identity(Modifier.weight(1f))
                Spacer(Modifier.width(8.dp))
                transport()
            }
        }
    }
}

@Composable private fun SearchScreen(model: RadioViewModel, playback: PlaybackState, select: (String) -> Unit) {
    val rawState by model.search.collectAsStateWithLifecycle()
    val account by model.library.account.collectAsStateWithLifecycle()
    val ownedCollection by model.library.ownedCollections.collectAsStateWithLifecycle()
    val owner = account.user?.id ?: LibraryRepository.GUEST
    val state = if (rawState.favoritesOnly && rawState.owner != owner) rawState.copy(items = emptyList(), total = 0,
        offset = 0, loading = false, error = null) else rawState
    val emptyFavorites = ownedCollection.first != owner || ownedCollection.second.favorites.isEmpty()
    val manifest by model.catalog.manifest.collectAsStateWithLifecycle()
    val keyboard = LocalSoftwareKeyboardController.current
    val focus = LocalFocusManager.current
    val imeVisible = WindowInsets.ime.getBottom(LocalDensity.current) > 0
    var filters by rememberSaveable { mutableStateOf(false) }
    val activeFilters = listOf(state.genres != null, state.languages != null, state.bitrate > 0, state.favoritesOnly).count { it }
    Column(Modifier.fillMaxSize().padding(horizontal = pageGutter())) {
        NightField(state.query, onValueChange = { model.search(query = it) }, label = R.string.search_hint,
            leadingIcon = Icons.Outlined.Search,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(onSearch = { keyboard?.hide() }),
            trailingIcon = { if (state.query.isNotEmpty()) IconAction(Icons.Outlined.Close, R.string.clear, { model.search(query = "") }) })
        Row(Modifier.fillMaxWidth().padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(if (state.loading && state.items.isEmpty()) stringResource(R.string.searching) else stringResource(R.string.results, state.total),
                Modifier.weight(1f), color = Muted, style = MaterialTheme.typography.bodySmall)
            TextButton(onClick = {
                filters = !filters
                if (filters) { focus.clearFocus(); keyboard?.hide() }
            }, modifier = Modifier.heightIn(min = 48.dp)) {
                Icon(Icons.Outlined.Tune, null, Modifier.size(16.dp), tint = if (activeFilters > 0) Coral else Muted)
                Spacer(Modifier.width(6.dp))
                Text(if (activeFilters == 0) stringResource(R.string.filters) else stringResource(R.string.active_filters, activeFilters),
                    color = if (filters || activeFilters > 0) Warm else Muted)
                Icon(if (filters) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore, null,
                    Modifier.padding(start = 4.dp).size(18.dp), tint = Muted)
            }
        }
        if (filters && !imeVisible) Column(Modifier.heightIn(max = 240.dp).clip(RoundedCornerShape(16.dp)).background(Panel)
            .border(1.dp, Border, RoundedCornerShape(16.dp))
            .verticalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 8.dp)) {
            Text(stringResource(R.string.filter_genres), color = Muted, style = MaterialTheme.typography.labelMedium)
            MultiChoiceRow(browsableGenres.map { id ->
                id to listOfNotNull(genreLabel(id), manifest?.genres?.find { it.id == id }?.count?.toString()).joinToString("  ")
            }, state.genres, R.string.all_genres, 11) { model.search(genres = it) }
            Text(stringResource(R.string.filter_languages), color = Muted, style = MaterialTheme.typography.labelMedium,
                modifier = Modifier.padding(top = 8.dp))
            MultiChoiceRow(manifest?.languages?.map { it.id to "${languageLabel(it.id)}  ${it.count}" } ?: emptyList(),
                state.languages, R.string.all_languages, 32) { model.search(languages = it) }
            if ((state.languages?.size ?: 0) >= 32) Text(stringResource(R.string.language_selection_limit), color = Muted,
                style = MaterialTheme.typography.bodySmall)
            Text(stringResource(R.string.bitrate), color = Muted, style = MaterialTheme.typography.labelMedium,
                modifier = Modifier.padding(top = 8.dp))
            ChoiceRow(listOf(0,128,192,320).map { it.toString() to if(it == 0) stringResource(R.string.all_bitrates) else "$it kbps" },
                state.bitrate.toString()) { model.search(bitrate = it.toInt()) }
            SettingSwitch(R.string.favorites_only, R.string.favorites_only_note, state.favoritesOnly) { model.search(favoritesOnly = it) }
            TextButton(onClick = { model.search(genres = null, languages = null, bitrate = 0, favoritesOnly = false) }) {
                Text(stringResource(R.string.reset_filters), color = Muted)
            }
        }
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(bottom = 16.dp)) {
            items(state.items, key = { it.id }) { station ->
                StationRow(station, { keyboard?.hide(); select(station.id) }, active = playback.station?.id == station.id)
            }
            item {
                when {
                    state.loading -> NightLoading(R.string.searching)
                    state.error != null -> Column(Modifier.fillMaxWidth().padding(vertical = 16.dp)) {
                        ErrorText(state.error!!)
                        TextButton(onClick = model::retry) { Text(stringResource(R.string.retry)) }
                    }
                    state.items.isEmpty() -> NightEmptyState(
                        if (state.favoritesOnly && emptyFavorites) R.string.empty_favorites else R.string.empty_search,
                        if (state.favoritesOnly && emptyFavorites) Icons.Outlined.FavoriteBorder else Icons.Outlined.Search,
                        if (state.favoritesOnly && emptyFavorites) R.string.explore else R.string.reset_filters,
                        { model.search(query = "", genres = null, languages = null, bitrate = 0, favoritesOnly = false) })
                    state.offset < state.total -> TextButton(onClick = model::more,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) { Text(stringResource(R.string.load_more), color = Warm) }
                }
            }
        }
    }
}

@Composable private fun MultiChoiceRow(items: List<Pair<String, String>>, selected: Set<String>?, allLabel: Int,
    maximum: Int, choose: (Set<String>?) -> Unit) {
    LazyRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        item { NightPill(stringResource(allLabel), selected == null, { choose(null) }) }
        item { NightPill(stringResource(R.string.select_none), selected?.isEmpty() == true, { choose(emptySet()) }) }
        items(items, key = { it.first }) { (id, label) ->
            val checked = selected?.contains(id) == true
            NightPill(label, checked, {
                choose(if (checked) selected.orEmpty() - id else selected.orEmpty() + id)
            }, enabled = checked || (selected?.size ?: 0) < maximum)
        }
    }
}

@Composable private fun ChoiceRow(items: List<Pair<String,String>>, selected: String, choose: (String) -> Unit) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items.forEach { (id,label) -> NightPill(label, selected == id, { choose(id) }) }
    }
}

@Composable private fun StationRow(station: Station, select: () -> Unit, active: Boolean = false, trailing: (@Composable () -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().heightIn(min = 76.dp).clip(RoundedCornerShape(10.dp))
        .background(if (active) Surface.copy(alpha = .55f) else Color.Transparent)
        .clickable(role = Role.Button, onClick = select).semantics { selected = active }
        .padding(vertical = 12.dp, horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.padding(horizontal = 6.dp).size(6.dp).clip(CircleShape).background(if (active) Coral else SeaGlass))
        Column(Modifier.weight(1f).padding(horizontal = 10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(station.name, color = if (active) Warm else Warm.copy(alpha = .94f), style = MaterialTheme.typography.bodyLarge,
                fontWeight = if (active) FontWeight.Medium else FontWeight.Normal, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(listOf(station.location, genreLabel(station.genre)).filter { it.isNotEmpty() }.joinToString(" · "), color = Muted,
                style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        if (trailing != null) trailing()
        else Icon(Icons.Default.PlayArrow, null, Modifier.padding(horizontal = 12.dp).size(20.dp), tint = if (active) Coral else Muted)
    }
    HorizontalDivider(color = Border, modifier = Modifier.padding(start = 32.dp))
}

@Composable private fun LibraryScreen(collection: ListeningCollection, playback: PlaybackState, accountError: String?, model: RadioViewModel,
    select: (String) -> Unit, explore: () -> Unit) {
    var history by rememberSaveable { mutableStateOf(false) }
    var confirmClear by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().padding(horizontal = pageGutter())) {
        Row(Modifier.fillMaxWidth()) {
            listOf(false to R.string.favorites, true to R.string.history).forEach { (tab,label) ->
                val chosen = history == tab
                Column(Modifier.weight(1f).selectable(chosen, role = Role.Tab, onClick = { history = tab }),
                    horizontalAlignment = Alignment.CenterHorizontally) {
                    Row(Modifier.heightIn(min = 56.dp).padding(horizontal = 8.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(stringResource(label), color = if (chosen) Warm else Muted, style = MaterialTheme.typography.labelLarge)
                        Text((if (tab) collection.history.size else collection.favorites.size).toString(), color = if (chosen) Coral else Muted,
                            style = MaterialTheme.typography.labelMedium, fontFamily = MonoFont)
                    }
                    HorizontalDivider(color = if (chosen) Coral else Border, thickness = if (chosen) 2.dp else 1.dp)
                }
            }
        }
        accountError?.let { ErrorText(it) }
        val items = if(history) collection.history else collection.favorites
        if (history && items.isNotEmpty()) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            TextButton(onClick = { confirmClear = true }) {
                Icon(Icons.Outlined.DeleteOutline, null, Modifier.size(16.dp), tint = Muted)
                Text(stringResource(R.string.clear_history), Modifier.padding(start = 6.dp), color = Muted)
            }
        }
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(top = 8.dp, bottom = 16.dp)) {
            if (items.isEmpty()) item {
                NightEmptyState(if (history) R.string.empty_history else R.string.empty_favorites,
                    if (history) Icons.Outlined.History else Icons.Outlined.FavoriteBorder, R.string.explore, explore)
            }
            items(items, key = { it.id }) { saved ->
                if (history) StationRow(saved.station(), { select(saved.id) }, active = playback.station?.id == saved.id)
                else StationRow(saved.station(), { select(saved.id) }, active = playback.station?.id == saved.id) {
                    IconAction(Icons.Default.Favorite, R.string.unfavorite, { model.favorite(saved.station()) }, true)
                }
            }
        }
    }
    if (confirmClear) NightDialog(R.string.confirm_clear,
        confirm = { model.clearHistory(); confirmClear = false }, dismiss = { confirmClear = false })
}

@Composable private fun SettingsScreen(preferences: ListeningPreferences, playback: PlaybackState, accountState: AccountState,
    model: RadioViewModel, controls: PlaybackConnection, account: () -> Unit) {
    val language = LocalConfiguration.current.locales[0].language
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = pageGutter(24)).padding(bottom = 24.dp)) {
        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Panel)
            .border(1.dp, Border, RoundedCornerShape(16.dp))
            .clickable(role = Role.Button, onClick = account).padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(42.dp).clip(CircleShape).background(Surface), contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.Person, null, Modifier.size(22.dp), tint = SeaGlass)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(stringResource(R.string.account), style = MaterialTheme.typography.titleMedium)
                Text(accountState.user?.username ?: stringResource(R.string.account_guest_summary), color = Muted,
                    style = MaterialTheme.typography.bodySmall)
            }
            Icon(Icons.Outlined.ChevronRight, null, Modifier.size(20.dp), tint = Muted)
        }
        SectionLabel(R.string.display)
        SettingSwitch(R.string.graphics, R.string.graphics_note, preferences.graphics) { model.preference("graphics", it) }
        SettingSwitch(R.string.power_save, R.string.power_save_note, preferences.powerSave) { model.preference("power_save", it) }
        SettingSwitch(R.string.reduce_motion, R.string.reduce_motion_note, preferences.reduceMotion) { model.preference("reduce_motion", it) }
        SectionLabel(R.string.language)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            NightPill("中文", language == "zh", { AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags("zh-CN")) }, Modifier.weight(1f))
            NightPill("English", language == "en", { AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags("en")) }, Modifier.weight(1f))
        }
        SectionLabel(R.string.sleep)
        Text(stringResource(R.string.sleep_note), color = Muted, style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.padding(bottom = 8.dp))
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(15,30,60,90).forEach { minutes ->
                OutlinedButton(onClick = { controls.sleep(minutes) }, modifier = Modifier.heightIn(min = 48.dp),
                    shape = CircleShape, border = BorderStroke(1.dp, Border),
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp)) {
                    Text(stringResource(R.string.sleep_minutes, minutes), color = Warm)
                }
            }
        }
        if (playback.sleepRemainingMs > 0) {
            Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Outlined.Bedtime, null, Modifier.size(18.dp), tint = Coral)
                Text(stringResource(R.string.sleep_remaining, ((playback.sleepRemainingMs + 59999) / 60000).toInt()),
                    color = Warm, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                TextButton(onClick = { controls.sleep(0) }) { Text(stringResource(R.string.sleep_off), color = Muted) }
            }
        }
        SectionLabel(R.string.about)
        Text(stringResource(R.string.app_name), fontFamily = DisplayFont, fontSize = 22.sp)
        Text(stringResource(R.string.version, BuildConfig.VERSION_NAME), color = Muted, style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.padding(top = 4.dp, bottom = 16.dp))
        Text(stringResource(R.string.privacy), color = Muted, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable private fun AccountScreen(account: AccountState, pending: Int, model: RadioViewModel) {
    var username by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var passwordVisible by remember { mutableStateOf(false) }
    var confirmKeep by remember { mutableStateOf(false) }
    val keyboard = LocalSoftwareKeyboardController.current
    val focus = LocalFocusManager.current
    val canLogin = !account.syncing && username.trim().matches(Regex("[a-zA-Z0-9_]{3,32}")) && password.length >= 6
    fun login() { if (canLogin) { keyboard?.hide(); focus.clearFocus(); model.login(username, password) } }
    LaunchedEffect(account.user?.id) { if (account.user != null) { password = ""; passwordVisible = false } }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = pageGutter(24)).padding(bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Box(Modifier.size(52.dp).border(1.dp, Border, CircleShape).background(Panel, CircleShape),
                contentAlignment = Alignment.Center) {
                Icon(if (account.user == null) Icons.Outlined.PersonOutline else Icons.Outlined.VerifiedUser,
                    null, Modifier.size(24.dp), tint = SeaGlass)
            }
            Text(account.user?.username ?: stringResource(R.string.guest), Modifier.weight(1f),
                style = MaterialTheme.typography.titleLarge)
        }
        if (account.user == null) {
            Text(stringResource(R.string.guest_note), color = Muted, style = MaterialTheme.typography.bodyMedium)
            HorizontalDivider(color = Border, modifier = Modifier.padding(vertical = 8.dp))
            Text(stringResource(R.string.account_signin_title), style = MaterialTheme.typography.titleMedium)
            NightField(username, { username = it.take(32) }, R.string.username,
                leadingIcon = Icons.Outlined.Person,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii, autoCorrectEnabled = false, imeAction = ImeAction.Next),
                keyboardActions = KeyboardActions(onNext = { focus.moveFocus(androidx.compose.ui.focus.FocusDirection.Down) }))
            NightField(password, { password = it.take(128) }, R.string.password, leadingIcon = Icons.Outlined.Lock,
                visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { login() }),
                trailingIcon = { IconAction(if (passwordVisible) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
                    if (passwordVisible) R.string.hide_password else R.string.show_password, { passwordVisible = !passwordVisible }) })
            Text(stringResource(R.string.login_requirements), color = Muted, style = MaterialTheme.typography.bodySmall)
            account.error?.let { ErrorText(it) }
            Button(onClick = ::login, enabled = canLogin, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
                shape = CircleShape, contentPadding = PaddingValues(horizontal = 24.dp, vertical = 14.dp)) {
                if (account.syncing) { CircularProgressIndicator(Modifier.size(18.dp), color = Muted, strokeWidth = 1.5.dp); Spacer(Modifier.width(8.dp)) }
                Text(stringResource(if (account.syncing) R.string.connecting else R.string.login))
            }
            Text(stringResource(R.string.login_note), color = Muted, style = MaterialTheme.typography.bodySmall)
        } else {
            NightNotice(if (pending == 0 && !account.syncing && account.error == null) Icons.Outlined.CloudDone else Icons.Outlined.Sync,
                stringResource(if (account.syncing) R.string.syncing else if (pending > 0) R.string.pending else if (account.error != null) R.string.sync_needed else R.string.synced, pending))
            Text(stringResource(R.string.account_sync_note), color = Muted, style = MaterialTheme.typography.bodyMedium)
            account.error?.let { ErrorText(it) }
            OutlinedButton(onClick = model.library::refresh, enabled = !account.syncing,
                modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp), border = BorderStroke(1.dp, SeaGlass.copy(alpha = .5f))) {
                if (account.syncing) CircularProgressIndicator(Modifier.size(18.dp), color = Muted, strokeWidth = 1.5.dp)
                else Icon(Icons.Outlined.Sync, null, Modifier.size(18.dp), tint = Warm)
                Text(stringResource(R.string.sync), Modifier.padding(start = 8.dp), color = Warm)
            }
            Spacer(Modifier.height(8.dp))
            HorizontalDivider(color = Border)
            Text(stringResource(R.string.logout_note), color = Muted, style = MaterialTheme.typography.bodySmall)
            OutlinedButton(onClick = { model.logout(false) }, enabled = !account.syncing,
                modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp), shape = CircleShape,
                border = BorderStroke(1.dp, Border),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = Warm),
                contentPadding = PaddingValues(horizontal = 24.dp, vertical = 14.dp)) { Text(stringResource(R.string.logout)) }
            if (pending > 0 || account.error != null) TextButton(onClick = { confirmKeep = true }, enabled = !account.syncing,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text(stringResource(R.string.logout_keep), color = Muted) }
        }
    }
    if (confirmKeep) NightDialog(R.string.logout_keep, R.string.logout_note,
        confirm = { model.logout(true); confirmKeep = false }, dismiss = { confirmKeep = false })
}

@Composable private fun SectionLabel(label: Int) {
    Text(stringResource(label), color = Muted, style = MaterialTheme.typography.labelMedium,
        modifier = Modifier.padding(top = 24.dp, bottom = 10.dp))
}

@Composable private fun SettingSwitch(label: Int, description: Int, value: Boolean, change: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 72.dp).toggleable(value, role = Role.Switch, onValueChange = change)
        .padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(stringResource(label), style = MaterialTheme.typography.bodyLarge)
            Text(stringResource(description), color = Muted, style = MaterialTheme.typography.bodySmall)
        }
        Switch(value, onCheckedChange = null, colors = SwitchDefaults.colors(
            checkedThumbColor = Ink, checkedTrackColor = SeaGlass, checkedBorderColor = Color.Transparent,
            uncheckedThumbColor = Muted, uncheckedTrackColor = Panel, uncheckedBorderColor = SeaGlass.copy(alpha = .5f)))
    }
    HorizontalDivider(color = Border)
}

@Composable private fun ErrorText(code: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(Icons.Outlined.Info, null, Modifier.padding(top = 2.dp).size(16.dp), tint = MaterialTheme.colorScheme.error)
        Text(stringResource(when(code) { "stream" -> R.string.stream_error; "credentials" -> R.string.credentials_error;
            "expired" -> R.string.expired_error; "conflict" -> R.string.conflict_error; "limited" -> R.string.limited_error;
            "unavailable" -> R.string.unavailable_error; "queue_full" -> R.string.queue_full_error;
            "storage" -> R.string.storage_error; "invalid_data" -> R.string.invalid_data_error; else -> R.string.network_error }),
            color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
    }
}
