import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useStore } from 'zustand';
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
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { StationPreview } from '@haen/contracts';
import { setLanguage } from '../locales/i18n';
import { createPlayerController, type PlayerState } from '../audio/controller';
import { randomStation, searchStations } from '../services/catalog';
import { loadSceneCatalog } from '../catalog/load';
import { createStationCollection, pickStation } from '../catalog/collection';
import { Exploration } from '../graphics/Exploration';
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
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const filters = useMemo(() => ({ q: search }), [search]);
  const [progress, setProgress] = useState({ loaded: 0, total: 0 });
  const scene = useQuery({
    queryKey: ['scene-catalog'],
    queryFn: ({ signal }) =>
      loadSceneCatalog(signal, (loaded, total) => setProgress({ loaded, total })),
    retry: 0,
    staleTime: 60000,
    refetchInterval: 300000,
  });
  const collection = useMemo(
    () => (scene.data ? createStationCollection(scene.data.stations) : undefined),
    [scene.data],
  );
  const candidates = useMemo(() => collection?.filter(filters), [collection, filters]);
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
    queryKey: ['stations', search, offset],
    enabled: candidates === undefined,
    queryFn: ({ signal }) => searchStations(filters, offset, 30, signal),
    retry: 1,
    staleTime: 30000,
  });
  const stations = {
    data: candidates
      ? {
          items: candidates.slice(offset, offset + 30),
          total: candidates.length,
          offset,
          limit: 30,
        }
      : remoteStations.data,
    isPending: candidates === undefined && remoteStations.isPending,
    isError: candidates === undefined && remoteStations.isError,
    isFetching: candidates === undefined && remoteStations.isFetching,
    refetch: remoteStations.refetch,
  };
  const outsideFilter = !!(
    state.station &&
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
  const reset = () => {
    player.invalidateSelection();
    setDraft('');
    setSearch('');
    setOffset(0);
  };
  const shortStatus =
    'playback' + state.playback.status[0]!.toUpperCase() + state.playback.status.slice(1);
  return (
    <div ref={pageRef} className={styles.page}>
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
        <div className={styles.languages} role="group" aria-label={t('language')}>
          <button
            lang="zh-CN"
            aria-pressed={i18n.language === 'zh'}
            onClick={() => {
              void setLanguage('zh');
            }}
          >
            中文
          </button>
          <button
            lang="en"
            aria-pressed={i18n.language === 'en'}
            onClick={() => {
              void setLanguage('en');
            }}
          >
            EN
          </button>
        </div>
      </header>
      <main id="main" tabIndex={-1} className={styles.main}>
        <section className={styles.current} aria-label={t('selectedStation')}>
          <h1>{state.station?.name ?? t('headline')}</h1>
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
            </>
          ) : (
            <p className={styles.description}>{t('chooseStation')}</p>
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
              {t('attempt', { number: state.playback.attempt, total: state.detail.streams.length })}
            </p>
          )}
          {state.pinned && <p className={styles.note}>{t('pinHint')}</p>}
          {outsideFilter && <p className={styles.note}>{t('outsideFilter')}</p>}
          {failed && (
            <button className={styles.textButton} onClick={() => player.retry()}>
              {t('retry')}
            </button>
          )}
        </section>
        <div className={styles.scene}>
          <Exploration
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
              setSearch(draft.trim());
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
                disabled={offset === 0 || stations.isFetching}
                onClick={() => setOffset(Math.max(0, offset - 30))}
              >
                {t('earlier')}
              </button>
              <span>{t('pageNumber', { page: Math.floor(offset / 30) + 1 })}</span>
              <button
                disabled={offset + 30 >= stations.data.total || stations.isFetching}
                onClick={() => setOffset(offset + 30)}
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
      <footer ref={footerRef} className={styles.player} aria-label={t('player')}>
        <div className={styles.playerStation}>
          <span className={styles.playerTitle} title={state.station?.name}>
            {state.station?.name ?? t('tagline')}
          </span>
          <span className={styles.playerStatus}>
            {state.resolving
              ? t(state.intent ? 'loadingStation' : 'loadingPaused')
              : t(shortStatus, { defaultValue: status })}
          </span>
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
