import { useEffect, useMemo, useRef, useState } from 'react';
import { Globe2, ListMusic, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Genre, StationPreview } from '@haen/contracts';
import {
  groupStations,
  type StationGroup,
  type ExplorationChoice,
  type SceneExpectation,
} from './model';
import type { PickReason } from './globe';
import { GlobePanel } from './GlobePanel';
import { GenreAtlas } from './GenreAtlas';
import styles from './exploration.module.css';
type Selection = { kind: 'place'; id: string } | { kind: 'genre'; genre: Genre } | null;
export function Exploration({
  stations,
  station,
  pinned,
  selectionVersion,
  loading,
  error,
  stale,
  progress,
  onRetry,
  onSelect,
}: {
  stations: StationPreview[];
  station: StationPreview | null;
  pinned: boolean;
  selectionVersion: number;
  loading: boolean;
  error: boolean;
  stale: boolean;
  progress: { loaded: number; total: number };
  onRetry(): void;
  onSelect(station: StationPreview, reason: ExplorationChoice, expected?: SceneExpectation): void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'globe' | 'genres'>('globe');
  const [selection, setSelection] = useState<Selection>(null),
    [offset, setOffset] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const origin = useRef<HTMLElement | null>(null);
  const rememberOrigin = () => {
    origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  };
  const close = () => {
    setSelection(null);
    origin.current?.focus({ preventScroll: true });
    origin.current?.scrollIntoView({ block: 'nearest' });
  };
  const groups = useMemo(() => groupStations(stations), [stations]);
  const group =
    selection?.kind === 'place' ? groups.find((value) => value.id === selection.id) : null;
  const members =
    selection?.kind === 'genre'
      ? stations.filter((value) => value.genre === selection.genre)
      : (group?.stations ?? []);
  const located = groups.reduce((count, value) => count + value.stations.length, 0);
  const title =
    selection?.kind === 'genre'
      ? t('genre.' + selection.genre)
      : (group?.stations[0]?.city ??
        (group?.stations[0]?.nearbyCity
          ? t('nearby', { city: group.stations[0].nearbyCity })
          : t('coordinatePlace')));
  const pageOffset = Math.min(offset, Math.max(0, Math.floor((members.length - 1) / 12) * 12));
  const choosePlace = (value: StationGroup, reason: PickReason) => {
    if (reason === 'dwell' && pinned) return;
    if (reason === 'click' && value.stations.length > 1) {
      rememberOrigin();
      setOffset(0);
      setSelection({ kind: 'place', id: value.id });
      return;
    }
    const candidate = value.stations.find((item) => item.id === station?.id) ?? value.stations[0];
    if (candidate && candidate.id !== station?.id)
      onSelect(candidate, reason === 'dwell' ? 'dwell' : 'point', {
        stationId: station?.id ?? null,
        version: selectionVersion,
      });
  };
  const expand = (genre: Genre) => {
    rememberOrigin();
    setOffset(0);
    setSelection({ kind: 'genre', genre });
  };
  useEffect(() => {
    if (selection) {
      heading.current?.focus({ preventScroll: true });
      heading.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [selection]);
  return (
    <section className={styles.exploration} aria-label={t('exploration')}>
      <div className={styles.modeTabs} role="group" aria-label={t('viewMode')}>
        <button
          aria-pressed={mode === 'globe'}
          onClick={() => {
            setSelection(null);
            setMode('globe');
          }}
        >
          <Globe2 size={18} aria-hidden="true" />
          {t('globeView')}
        </button>
        <button
          aria-pressed={mode === 'genres'}
          onClick={() => {
            setSelection(null);
            setMode('genres');
          }}
        >
          <ListMusic size={18} aria-hidden="true" />
          {t('genreView')}
        </button>
      </div>
      <GlobePanel
        groups={groups}
        station={station}
        pinned={pinned}
        selectionVersion={selectionVersion}
        active={mode === 'globe'}
        onPick={choosePlace}
      />
      {mode === 'genres' && <GenreAtlas stations={stations} onChoose={expand} />}
      <div className={styles.dataState} aria-live="polite">
        {loading ? (
          t(progress.total ? 'sceneLoading' : 'scenePreparing', {
            loaded: progress.loaded,
            total: progress.total,
          })
        ) : error ? (
          <>
            {t('sceneUnavailable')} <button onClick={onRetry}>{t('retry')}</button>
          </>
        ) : stale ? (
          t('sceneStale')
        ) : (
          t('locatedCount', { located, total: stations.length })
        )}
      </div>
      {selection && (
        <section className={styles.groupList} aria-labelledby="place-heading">
          <div className={styles.groupHeading}>
            <h3 id="place-heading" tabIndex={-1} ref={heading}>
              {title}
            </h3>
            <button aria-label={t('closePlace')} onClick={close}>
              <X size={20} aria-hidden="true" />
            </button>
          </div>
          <p>{t('placeStationCount', { count: members.length })}</p>
          {members.length === 0 ? (
            <p>{t('placeEmpty')}</p>
          ) : (
            <ul>
              {members.slice(pageOffset, pageOffset + 12).map((item) => (
                <li key={item.id}>
                  <button
                    aria-current={station?.id === item.id ? 'true' : undefined}
                    onClick={() => onSelect(item, 'listen')}
                  >
                    {t('listenStation', { name: item.name })}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {members.length > 12 && (
            <nav aria-label={t('placePagination')}>
              <button
                disabled={pageOffset === 0}
                onClick={() => setOffset(Math.max(0, pageOffset - 12))}
              >
                {t('earlier')}
              </button>
              <span>{Math.floor(pageOffset / 12) + 1}</span>
              <button
                disabled={pageOffset + 12 >= members.length}
                onClick={() => setOffset(pageOffset + 12)}
              >
                {t('later')}
              </button>
            </nav>
          )}
          {group && members.length > 1 && (
            <button
              className={styles.nearbyNext}
              onClick={() => {
                const index = members.findIndex((item) => item.id === station?.id);
                const candidate = members[(index + 1) % members.length];
                if (candidate) onSelect(candidate, 'nearby');
              }}
            >
              {t(group.stations[0]?.city ? 'nextCityStation' : 'nextNearbyStation')}
            </button>
          )}
        </section>
      )}
      <p className={styles.mapSource}>
        <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener noreferrer">
          Natural Earth
        </a>
      </p>
    </section>
  );
}
