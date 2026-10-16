import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useStore } from 'zustand';
import { useLocation } from 'react-router';
import {
  MapPin,
  Pause,
  Pin,
  PinOff,
  Play,
  Search,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
  Star,
  Share2,
  Library as LibraryIcon,
  Settings2,
  Timer,
  Disc3,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { StationPreview } from '@haen/contracts';
import { observeLanguage, setLanguage } from '../locales/i18n';
import { createPlayerController, type PlayerState } from '../audio/controller';
import { lookupStations, randomStation, searchStations } from '../services/catalog';
import { useListeningLibrary } from '../library/use-library';
import { defaultFilters, type ListeningFilters } from '../library/model';
import { sharedStation, shareStation } from '../library/share';
import { LibraryPanel } from '../library/LibraryPanel';
import { Filters } from '../library/Filters';
import { loadSceneCatalog } from '../catalog/load';
import { createStationCollection, pickStation } from '../catalog/collection';
import { Exploration, type ExplorationHandle } from '../graphics/Exploration';
import { createSleepController, formatRemaining } from '../platform/sleep';
import { connectMediaSession } from '../platform/media-session';
import { connectShortcuts } from '../platform/shortcuts';
import { connectIdleImmersion } from '../platform/idle';
import { SettingsPanel } from './SettingsPanel';
import { Immersive } from './Immersive';
import { explorationAutoplay } from '../graphics/model';
import { StationFacts } from './StationFacts';
import styles from './App.module.css';

const EMPTY_STATIONS: StationPreview[] = [];

function usePlayback() {
  const [controller] = useState(() => createPlayerController());
  useEffect(() => {
    controller.attach();
    const online = () => controller.setOnline(navigator.onLine);
    online();
    window.addEventListener('online', online);
    window.addEventListener('offline', online);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', online);
      controller.detach();
    };
  }, [controller]);
  return controller;
}
function statusKey(state: PlayerState) {
  if (state.resolving) return state.intent ? 'loadingStation' : 'loadingPaused';
  const requests = {
    network: 'requestNetwork',
    'not-found': 'requestNotFound',
    unavailable: 'requestUnavailable',
    empty: 'requestEmpty',
    offline: 'failureOffline',
  };
  if (state.requestFailure) return requests[state.requestFailure];
  if (state.playback.status === 'failed') {
    const failures = {
      network: 'failureNetwork',
      timeout: 'failureTimeout',
      unsupported: 'failureUnsupported',
      unavailable: 'failureUnavailable',
      offline: 'failureOffline',
    };
    return failures[state.playback.failure ?? 'unavailable'];
  }
  const statuses = {
    idle: 'playbackIdle',
    connecting: 'playbackConnecting',
    playing: 'playbackPlaying',
    buffering: 'playbackBuffering',
    paused: 'playbackPaused',
    blocked: 'playbackBlocked',
  };
  return statuses[state.playback.status];
}
export function App() {
  const { t, i18n } = useTranslation();
  const player = usePlayback();
  const state = useStore(player.store);
  const library = useListeningLibrary(player);
  const personal = useStore(library.store);
  const search = personal.filters.q;
  const [searchInput, setSearchInput] = useState({ base: search, value: search });
  const draft = searchInput.base === search ? searchInput.value : search;
  const setDraft = (value: string) => setSearchInput({ base: search, value });
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false),
    [immersive, setImmersive] = useState(false);
  const [languageFailed, setLanguageFailed] = useState(false);
  const exploration = useRef<ExplorationHandle>(null);
  const searchAfterExit = useRef(false);
  const immersionOrigin = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!immersive && searchAfterExit.current) {
      searchAfterExit.current = false;
      document.getElementById('station-search')?.focus();
      immersionOrigin.current = null;
    } else if (!immersive && immersionOrigin.current) {
      if (immersionOrigin.current.isConnected)
        immersionOrigin.current.focus({ preventScroll: true });
      immersionOrigin.current = null;
    }
  }, [immersive]);
  const [sleepController] = useState(() => createSleepController(library, player.pause));
  const sleep = useStore(sleepController.store);
  useEffect(() => sleepController.attach(), [sleepController]);
  useEffect(() => observeLanguage(), []);
  useEffect(
    () => connectMediaSession(player, { brand: '声屿 HAEN', genre: (id) => t('genre.' + id) }),
    [player, t, i18n.language],
  );
  const chooseLanguage = (value: 'zh' | 'en') => {
    void setLanguage(value).then((saved) => setLanguageFailed(!saved));
  };
  const enterImmersive = useCallback(() => {
    if (immersive || !player.store.getState().station) return;
    if (document.activeElement instanceof HTMLElement)
      immersionOrigin.current = document.activeElement;
    player.invalidateSelection();
    setImmersive(true);
  }, [player, immersive]);
  const [actionMessage, setActionMessage] = useState(''),
    [manualLink, setManualLink] = useState('');
  const favoriteCurrent = useCallback(() => {
    const station = player.store.getState().station;
    if (station) {
      try {
        library.toggleFavorite(station);
      } catch {
        setActionMessage('libraryCapacity');
      }
    }
  }, [player, library]);
  const [lastEntry] = useState(personal.lastStation);
  const route = useLocation();
  const shared = useMemo(() => sharedStation(route.search), [route.search]);
  useEffect(() => {
    const id = shared.invalid ? null : (shared.id ?? lastEntry?.id);
    if (id) void player.open(id, false);
  }, [player, shared.id, shared.invalid, lastEntry]);
  const [offset, setOffset] = useState(0);
  const filters = useMemo(
    () => ({
      q: search,
      ...(personal.filters.genres !== null ? { genres: personal.filters.genres } : {}),
      ...(personal.filters.languages !== null ? { languages: personal.filters.languages } : {}),
      minBitrate: personal.filters.minBitrate,
    }),
    [personal.filters, search],
  );
  const favoriteIds = useMemo(
    () => new Set(personal.favorites.map((item) => item.id)),
    [personal.favorites],
  );
  const savedLookup = useQuery({
    queryKey: ['saved-stations', [...favoriteIds].sort()],
    queryFn: ({ signal }) => lookupStations([...favoriteIds], signal),
    enabled: favoriteIds.size > 0 && (libraryOpen || personal.filters.favoritesOnly),
    retry: 0,
    staleTime: 30000,
  });
  const [progress, setProgress] = useState({ loaded: 0, total: 0 });
  const scene = useQuery({
    queryKey: ['scene-catalog'],
    queryFn: ({ signal }) =>
      loadSceneCatalog(signal, (loaded, total) => setProgress({ loaded, total })),
    retry: 0,
    staleTime: 60000,
    refetchInterval: 300000,
  });
  const catalogSource =
    scene.data?.stations ??
    (personal.filters.favoritesOnly ? (savedLookup.data?.items ?? EMPTY_STATIONS) : undefined);
  const collection = useMemo(
    () => (catalogSource ? createStationCollection(catalogSource) : undefined),
    [catalogSource],
  );
  const candidates = useMemo(
    () =>
      collection
        ?.filter(filters)
        .filter((station) => !personal.filters.favoritesOnly || favoriteIds.has(station.id)),
    [collection, filters, personal.filters.favoritesOnly, favoriteIds],
  );
  const candidatesRef = useRef<StationPreview[] | undefined>(undefined);
  useEffect(() => {
    candidatesRef.current = candidates;
  }, [candidates]);

  const pageRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    player.setExplorer(async (signal, exclude) =>
      candidatesRef.current
        ? pickStation(candidatesRef.current, exclude)
        : await randomStation(filters, signal, exclude),
    );
  }, [player, filters]);
  useEffect(() => {
    const page = pageRef.current;
    const footer = footerRef.current;
    if (!page || !footer || typeof ResizeObserver === 'undefined') return;
    const measure = () =>
      page.style.setProperty(
        '--player-height',
        String(footer.getBoundingClientRect().height) + 'px',
      );
    const observer = new ResizeObserver(measure);
    observer.observe(footer);
    measure();
    return () => {
      observer.disconnect();
      page.style.removeProperty('--player-height');
    };
  }, []);
  const remoteStations = useQuery({
    queryKey: ['stations', filters, offset],
    enabled: candidates === undefined,
    queryFn: ({ signal }) => searchStations(filters, offset, 30, signal),
    retry: 1,
    staleTime: 30000,
  });
  const pageOffset = candidates
    ? Math.min(offset, Math.max(0, Math.floor((candidates.length - 1) / 30) * 30))
    : offset;
  const stations = {
    data: candidates
      ? {
          items: candidates.slice(pageOffset, pageOffset + 30),
          total: candidates.length,
          offset: pageOffset,
          limit: 30,
        }
      : remoteStations.data,
    isPending:
      candidates === undefined
        ? remoteStations.isPending
        : !scene.data &&
          personal.filters.favoritesOnly &&
          favoriteIds.size > 0 &&
          savedLookup.isPending,
    isError:
      candidates === undefined
        ? remoteStations.isError
        : !scene.data && personal.filters.favoritesOnly && savedLookup.isError,
    isFetching:
      candidates === undefined
        ? remoteStations.isFetching
        : !scene.data && personal.filters.favoritesOnly && savedLookup.isFetching,
    refetch:
      personal.filters.favoritesOnly && !scene.data ? savedLookup.refetch : remoteStations.refetch,
  };
  const outsideFilter = !!(
    state.station &&
    !stations.isPending &&
    !stations.isError &&
    candidates &&
    !candidates.some((station) => station.id === state.station!.id)
  );
  const countryNames = useMemo(
    () => new Intl.DisplayNames([i18n.language === 'en' ? 'en' : 'zh-CN'], { type: 'region' }),
    [i18n.language],
  );
  const location = (station: StationPreview) =>
    [
      station.city ??
        (station.nearbyCity ? t('nearby', { city: station.nearbyCity }) : station.region),
      station.countryCode ? countryNames.of(station.countryCode) : null,
    ]
      .filter(Boolean)
      .join(' / ') || t('unknownLocation');
  const active = state.resolving
    ? state.intent
    : ['playing', 'connecting', 'buffering'].includes(state.playback.status);
  const status = t(statusKey(state));
  const failed = state.requestFailure !== null || state.playback.status === 'failed';
  const toggle = () => {
    if (active) player.pause();
    else if (!state.station) void player.start();
    else if (failed) player.retry();
    else player.play();
  };
  useEffect(
    () =>
      connectShortcuts({
        toggle: () => {
          const current = player.store.getState();
          if (
            current.resolving
              ? current.intent
              : ['playing', 'connecting', 'buffering'].includes(current.playback.status)
          )
            player.pause();
          else if (!current.station && !current.resolving) void player.start();
          else if (current.requestFailure || current.playback.status === 'failed') player.retry();
          else player.play();
        },
        previous: () => player.previous(),
        next: () => {
          void player.next();
        },
        view: () => {
          player.invalidateSelection();
          exploration.current?.close();
          library.setPreferences({
            view: library.store.getState().preferences.view === 'globe' ? 'genres' : 'globe',
          });
        },
        search: () => {
          if (immersive) {
            searchAfterExit.current = true;
            setImmersive(false);
          } else document.getElementById('station-search')?.focus();
        },
        favorite: favoriteCurrent,
        pin: () => {
          const current = player.store.getState();
          if (current.station) player.setPinned(!current.pinned);
        },
        mute: () => player.setMuted(!player.store.getState().playback.muted),
        enter: enterImmersive,
        escape: () => {
          if (immersive) setImmersive(false);
          else exploration.current?.close();
        },
      }),
    [player, library, favoriteCurrent, enterImmersive, immersive],
  );
  useEffect(() => {
    if (!personal.preferences.idleImmersive || immersive || libraryOpen || settingsOpen) return;
    return connectIdleImmersion(
      enterImmersive,
      () => player.store.getState().playback.status === 'playing',
    );
  }, [
    personal.preferences.idleImmersive,
    immersive,
    libraryOpen,
    settingsOpen,
    enterImmersive,
    player,
  ]);
  const reset = () => {
    player.invalidateSelection();
    setDraft('');
    library.setFilters(defaultFilters());
    setOffset(0);
  };
  const changeFilters = (value: ListeningFilters) => {
    player.invalidateSelection();
    library.setFilters(value);
    setDraft(value.q);
    setOffset(0);
  };
  const shortStatus =
    'playback' + state.playback.status[0]!.toUpperCase() + state.playback.status.slice(1);
  return (
    <div ref={pageRef} className={styles.page}>
      <div hidden={immersive}>
        <a className={styles.skip} href="#main">
          {t('skip')}
        </a>
        <header className={styles.header}>
          <a className={styles.brand} href="#main" aria-label="声屿 HAEN">
            {t('brand')} <span>HAEN</span>
          </a>
          <button
            className={styles.findStation}
            onClick={() => document.getElementById('station-search')?.focus()}
          >
            <Search size={18} aria-hidden="true" />
            {t('findStation')}
          </button>
          <button
            className={styles.openLibrary}
            aria-label={t('myListening')}
            onClick={(event) => {
              event.currentTarget.focus({ preventScroll: true });
              player.invalidateSelection();
              setLibraryOpen(true);
            }}
          >
            <LibraryIcon size={20} aria-hidden="true" />
            <span>{t('myListening')}</span>
          </button>
          <div className={styles.languages} role="group" aria-label={t('language')}>
            <button
              lang="zh-CN"
              aria-pressed={i18n.language === 'zh'}
              onClick={() => {
                chooseLanguage('zh');
              }}
            >
              中文
            </button>
            <button
              lang="en"
              aria-pressed={i18n.language === 'en'}
              onClick={() => {
                chooseLanguage('en');
              }}
            >
              EN
            </button>
          </div>
        </header>
        {(personal.storageProblem || languageFailed) && (
          <p className={styles.storageWarning} role="alert">
            {t('storage.' + (personal.storageProblem ?? 'unavailable'))}
          </p>
        )}
        <main id="main" tabIndex={-1} className={styles.main}>
          <section className={styles.current} aria-label={t('selectedStation')}>
            <h1>{state.station?.name ?? t('headline')}</h1>
            {shared.invalid && <p className={styles.note}>{t('invalidShare')}</p>}
            {state.station ? (
              <>
                <p className={styles.location}>
                  <MapPin size={18} aria-hidden="true" />
                  {location(state.station)}
                </p>
                <p className={styles.metadata}>
                  {t('genre.' + state.station.genre)}
                  <span>
                    {state.station.bitrate
                      ? String(state.station.bitrate) + ' kbps'
                      : t('unknownBitrate')}
                  </span>
                </p>
                <StationFacts station={state.station} detail={state.detail} />
                <div className={styles.stationActions}>
                  <button
                    aria-label={t(
                      favoriteIds.has(state.station.id) ? 'unfavoriteStation' : 'favoriteStation',
                      { name: state.station.name },
                    )}
                    aria-pressed={favoriteIds.has(state.station.id)}
                    onClick={() => {
                      if (!state.station) return;
                      try {
                        library.toggleFavorite(state.station);
                      } catch {
                        setActionMessage('libraryCapacity');
                      }
                    }}
                  >
                    <Star
                      size={20}
                      fill={favoriteIds.has(state.station.id) ? 'currentColor' : 'none'}
                      aria-hidden="true"
                    />
                    {t(favoriteIds.has(state.station.id) ? 'favorited' : 'favorite')}
                  </button>
                  <button
                    onClick={(event) => {
                      event.currentTarget.focus({ preventScroll: true });
                      enterImmersive();
                    }}
                  >
                    <Disc3 size={20} aria-hidden="true" />
                    {t('immersiveListening')}
                  </button>
                  <button
                    onClick={() => {
                      if (!state.station) return;
                      void shareStation(state.station.id, state.station.name).then((result) => {
                        if (result === 'cancelled') return;
                        if (result === 'shared' || result === 'copied') {
                          setActionMessage(result === 'copied' ? 'linkCopied' : 'linkShared');
                          setManualLink('');
                        } else {
                          setManualLink(result);
                          setActionMessage('copyLinkManually');
                        }
                      });
                    }}
                  >
                    <Share2 size={20} aria-hidden="true" />
                    {t('share')}
                  </button>
                </div>
              </>
            ) : (
              <p className={styles.description}>{t('chooseStation')}</p>
            )}
            <p className={styles.note} aria-live="polite">
              {actionMessage ? t(actionMessage) : ''}
            </p>
            {manualLink && (
              <input
                className={styles.manualLink}
                aria-label={t('stationShareLink')}
                value={manualLink}
                readOnly
                onFocus={(event) => event.currentTarget.select()}
              />
            )}
            <p
              role="status"
              className={[styles.status, failed ? styles.error : ''].join(' ')}
              data-state={state.playback.status}
            >
              {status}
            </p>
            {state.autoSkips > 0 && (
              <p className={styles.note}>{t('autoSkip', { count: state.autoSkips })}</p>
            )}
            {state.playback.attempt > 0 && state.detail && (
              <p className={styles.note}>
                {t('attempt', {
                  number: state.playback.attempt,
                  total: state.detail.streams.length,
                })}
              </p>
            )}
            {state.pinned && <p className={styles.note}>{t('pinHint')}</p>}
            {outsideFilter && <p className={styles.note}>{t('outsideFilter')}</p>}
            {failed && (
              <button className={styles.textButton} onClick={() => player.retry()}>
                {t('retry')}
              </button>
            )}
            {state.requestFailure && (shared.id || lastEntry) && (
              <button
                className={styles.textButton}
                onClick={() => {
                  void player.start();
                }}
              >
                {t('continueExploring')}
              </button>
            )}
          </section>
          <div className={styles.scene}>
            <Exploration
              ref={exploration}
              mode={personal.preferences.view}
              onModeChange={(view) => {
                player.invalidateSelection();
                library.setPreferences({ view });
              }}
              visible={!immersive}
              showHints={personal.preferences.showHints}
              stations={candidates ?? EMPTY_STATIONS}
              station={state.station}
              pinned={state.pinned}
              selectionVersion={state.selectionVersion}
              loading={scene.isPending}
              error={scene.isError && !scene.data}
              stale={scene.data?.stale ?? false}
              progress={progress}
              onRetry={() => {
                void scene.refetch();
              }}
              onSelect={(station, reason, expected) => {
                const current = player.store.getState();
                const autoplay = explorationAutoplay(
                  reason,
                  {
                    stationId: current.station?.id ?? null,
                    selectionVersion: current.selectionVersion,
                    intent: current.intent,
                    pinned: current.pinned,
                    resolving: current.resolving,
                  },
                  expected,
                );
                if (autoplay !== null) void player.select(station, autoplay);
              }}
            />
          </div>
          <section className={styles.directory} aria-labelledby="directory-title">
            <h2 id="directory-title" tabIndex={-1}>
              {t('explore')}
            </h2>
            <form
              className={styles.search}
              role="search"
              onSubmit={(event) => {
                event.preventDefault();
                player.invalidateSelection();
                library.setFilters({ ...personal.filters, q: draft.trim() });
                setOffset(0);
              }}
            >
              <Search aria-hidden="true" size={20} />
              <input
                type="search"
                id="station-search"
                aria-label={t('search')}
                placeholder={t('searchPlaceholder')}
                value={draft}
                maxLength={200}
                onChange={(event) => setDraft(event.target.value)}
              />
              {draft && (
                <button type="button" aria-label={t('clearSearch')} onClick={reset}>
                  <X size={18} aria-hidden="true" />
                </button>
              )}
              <button type="submit" className={styles.searchSubmit}>
                {t('searchSubmit')}
              </button>
            </form>
            <Filters
              value={personal.filters}
              manifest={scene.data?.manifest}
              onChange={changeFilters}
            />
            <div className={styles.directoryState} aria-live="polite" data-testid="directory-state">
              {stations.isPending ? (
                t('directoryLoading')
              ) : stations.isError ? (
                <>
                  <p>{t('directoryError')}</p>
                  <button
                    className={styles.textButton}
                    onClick={() => {
                      void stations.refetch();
                    }}
                  >
                    {t('retry')}
                  </button>
                </>
              ) : stations.data ? (
                t('directoryCount', { count: stations.data.total })
              ) : (
                t('directoryLoading')
              )}
            </div>
            {!stations.isPending &&
              !stations.isError &&
              stations.data &&
              stations.data.items.length === 0 && (
                <div className={styles.empty}>
                  <p>{t('noResults')}</p>
                  <button className={styles.textButton} onClick={reset}>
                    {t('resetSearch')}
                  </button>
                </div>
              )}
            <ul
              className={styles.stationList}
              aria-label={t('stationList')}
              aria-busy={stations.isFetching}
            >
              {stations.data?.items.map((station) => (
                <li key={station.id}>
                  <button
                    className={styles.station}
                    data-station-id={station.id}
                    aria-label={t('listenStation', { name: station.name })}
                    aria-current={state.station?.id === station.id ? 'true' : undefined}
                    onClick={() => {
                      void player.select(station);
                    }}
                  >
                    <span className={styles.stationText}>
                      <span className={styles.stationName}>{station.name}</span>
                      <span className={styles.stationLocation}>{location(station)}</span>
                    </span>
                    <span className={styles.stationKind}>{t('genre.' + station.genre)}</span>
                    <Play size={18} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            {stations.data && stations.data.total > 30 && (
              <nav className={styles.pagination} aria-label={t('stationList')}>
                <button
                  disabled={pageOffset === 0 || stations.isFetching}
                  onClick={() => setOffset(Math.max(0, pageOffset - 30))}
                >
                  {t('earlier')}
                </button>
                <span>{t('pageNumber', { page: Math.floor(pageOffset / 30) + 1 })}</span>
                <button
                  disabled={pageOffset + 30 >= stations.data.total || stations.isFetching}
                  onClick={() => setOffset(pageOffset + 30)}
                >
                  {t('later')}
                </button>
              </nav>
            )}
            <p className={styles.source}>{t('directorySource')}</p>
            <p className={styles.source}>
              {t('geographySource')}{' '}
              <a href="https://www.geonames.org/" target="_blank" rel="noopener noreferrer">
                GeoNames
              </a>
              {' · '}
              <a
                href="https://creativecommons.org/licenses/by/4.0/"
                target="_blank"
                rel="noopener noreferrer"
              >
                CC BY 4.0
              </a>
            </p>
          </section>
        </main>
      </div>
      {immersive && (
        <Immersive
          station={state.station}
          location={state.station ? location(state.station) : ''}
          status={status}
          playbackState={state.playback.status}
          favorite={!!state.station && favoriteIds.has(state.station.id)}
          onFavorite={favoriteCurrent}
          onExit={() => setImmersive(false)}
        />
      )}
      {libraryOpen && (
        <LibraryPanel
          library={library}
          lookup={savedLookup.data}
          lookupError={savedLookup.isError}
          checking={savedLookup.isFetching}
          onRefresh={() => {
            void savedLookup.refetch();
          }}
          onOpen={(id) => {
            void player.open(id, true);
            setLibraryOpen(false);
          }}
          onClose={() => setLibraryOpen(false)}
        />
      )}
      {settingsOpen && (
        <SettingsPanel
          library={library}
          player={player}
          manifest={scene.data?.manifest}
          sleep={sleep}
          languageFailed={languageFailed}
          onLanguage={chooseLanguage}
          onLanguages={(languages) => changeFilters({ ...personal.filters, languages })}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      <footer ref={footerRef} className={styles.player} aria-label={t('player')}>
        <div className={styles.playerStation}>
          <div className={styles.playerSummary}>
            <span className={styles.playerTitle} title={state.station?.name}>
              {state.station?.name ?? t('tagline')}
            </span>
            <button
              className={styles.settingsButton}
              aria-label={t('listeningSettings')}
              onClick={(event) => {
                event.currentTarget.focus({ preventScroll: true });
                player.invalidateSelection();
                setSettingsOpen(true);
              }}
            >
              <Settings2 size={20} aria-hidden="true" />
            </button>
          </div>
          <div className={styles.playerSecondary}>
            <span className={styles.playerStatus}>
              {state.resolving
                ? t(state.intent ? 'loadingStation' : 'loadingPaused')
                : t(shortStatus, { defaultValue: status })}
            </span>
            {sleep.active && (
              <button
                className={styles.sleepBadge}
                aria-label={t('sleepRemaining', { time: formatRemaining(sleep.remaining) })}
                onClick={(event) => {
                  event.currentTarget.focus({ preventScroll: true });
                  player.invalidateSelection();
                  setSettingsOpen(true);
                }}
              >
                <Timer size={16} aria-hidden="true" />
                {formatRemaining(sleep.remaining)}
              </button>
            )}
          </div>
        </div>
        <div className={styles.transport}>
          <button
            aria-label={t('previousStation')}
            disabled={!state.canGoBack}
            onClick={() => player.previous()}
          >
            <SkipBack size={20} aria-hidden="true" />
          </button>
          <button
            className={styles.playButton}
            aria-label={active ? t('pause') : state.station ? t('play') : t('start')}
            disabled={!state.station && (!stations.data?.total || stations.isPending)}
            onClick={toggle}
          >
            {active ? (
              <Pause size={24} aria-hidden="true" />
            ) : (
              <Play size={24} aria-hidden="true" />
            )}
          </button>
          <button
            aria-label={t('nextStation')}
            disabled={!stations.data?.total}
            onClick={() => {
              void player.next();
            }}
          >
            <SkipForward size={20} aria-hidden="true" />
          </button>
          <button
            aria-label={state.pinned ? t('unpin') : t('pin')}
            aria-pressed={state.pinned}
            disabled={!state.station}
            onClick={() => player.setPinned(!state.pinned)}
          >
            {state.pinned ? (
              <PinOff size={20} aria-hidden="true" />
            ) : (
              <Pin size={20} aria-hidden="true" />
            )}
          </button>
        </div>
        <div className={styles.volume}>
          <button
            aria-label={state.playback.muted ? t('unmute') : t('mute')}
            aria-pressed={state.playback.muted}
            onClick={() => player.setMuted(!state.playback.muted)}
          >
            {state.playback.muted ? (
              <VolumeX size={20} aria-hidden="true" />
            ) : (
              <Volume2 size={20} aria-hidden="true" />
            )}
          </button>
          {state.playback.volumeControllable ? (
            <input
              type="range"
              aria-label={t('volume')}
              min={0}
              max={1}
              step={0.01}
              value={state.playback.volume}
              onChange={(event) => player.setVolume(Number(event.target.value))}
            />
          ) : (
            <span className={styles.note}>{t('systemVolume')}</span>
          )}
        </div>
      </footer>
    </div>
  );
}
