import {
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type Ref,
} from 'react';
import { regionsVersion, subscribeRegions } from './regions';
import { useTranslation } from 'react-i18next';
import type { StationPreview } from '@haen/contracts';
import {
  groupStations,
  type StationGroup,
  type ExplorationChoice,
  type SceneExpectation,
} from './model';
import type { PickReason } from './globe';
import { GlobePanel } from './GlobePanel';
import styles from './exploration.module.css';
import { Modal } from '../app/Modal';
import { countryName } from './location';
type Selection = { kind: 'place'; id: string } | null;
export interface ExplorationHandle {
  close(): void;
}
export function Exploration({
  onInteract,
  interactionVersion = 0,
  mapInfoTarget = null,
  countryPlaceTarget = null,
  stations,
  station,
  playing = false,
  pinned,
  selectionVersion,
  loading,
  error,
  progress,
  onRetry,
  onSearch,
  onSelect,
  visible = true,
  welcome = false,
  showHints = true,
  powerSave = false,
  ref,
}: {
  onInteract?(): void;
  interactionVersion?: number;
  mapInfoTarget?: HTMLElement | null;
  countryPlaceTarget?: HTMLElement | null;
  stations: StationPreview[];
  station: StationPreview | null;
  playing?: boolean;
  pinned: boolean;
  selectionVersion: number;
  loading: boolean;
  error: boolean;
  progress: { loaded: number; total: number };
  onRetry(): void;
  onSearch(): void;
  onSelect(station: StationPreview, reason: ExplorationChoice, expected?: SceneExpectation): void;
  visible?: boolean;
  welcome?: boolean;
  showHints?: boolean;
  powerSave?: boolean;
  ref?: Ref<ExplorationHandle>;
}) {
  const { t, i18n } = useTranslation();
  const [selection, setSelection] = useState<Selection>(null),
    [offset, setOffset] = useState(0);
  const origin = useRef<HTMLElement | null>(null);
  const rememberOrigin = () => {
    origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  };
  const close = useCallback(() => {
    setSelection(null);
    origin.current?.focus({ preventScroll: true });
    origin.current?.scrollIntoView({ block: 'nearest' });
  }, []);
  useImperativeHandle(
    ref,
    () => ({
      close: () => {
        if (selection) close();
      },
    }),
    [close, selection],
  );
  const regionsReady = useSyncExternalStore(subscribeRegions, regionsVersion);
  const groups = useMemo(() => {
    void regionsReady;
    return groupStations(stations);
  }, [stations, regionsReady]);
  const group =
    selection?.kind === 'place' ? groups.find((value) => value.id === selection.id) : null;
  const members = group?.stations ?? [];
  const located = groups.reduce((count, value) => count + value.stations.length, 0);
  const countryLocated = groups
    .filter((value) => value.precision === 'country')
    .reduce((count, value) => count + value.stations.length, 0);
  const regionLocated = groups
    .filter((value) => value.precision === 'region')
    .reduce((count, value) => count + value.stations.length, 0);
  const title =
    group?.precision === 'country'
      ? t('countryPlace', {
          country: countryName(group.stations[0]?.countryCode ?? null, i18n.language),
        })
      : group?.precision === 'region'
        ? t('regionPlace', {
            region: i18n.language === 'en' ? group.regionNameEn : group.regionName,
          })
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
  const dataNote = (
    <>
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
        ) : (
          <>
            <span>{t('locatedCount', { located, total: stations.length })}</span>
            {countryLocated > 0 && (
              <span> · {t('countryLocatedCount', { count: countryLocated })}</span>
            )}
            {regionLocated > 0 && (
              <span> · {t('regionLocatedCount', { count: regionLocated })}</span>
            )}
            {located < stations.length && (
              <button onClick={onSearch}>
                {t('browseUnlocated', { count: stations.length - located })}
              </button>
            )}
          </>
        )}
      </div>
    </>
  );
  return (
    <section
      className={styles.exploration}
      data-welcome={welcome}
      data-mode="globe"
      aria-label={t('exploration')}
    >
      <GlobePanel
        interactionVersion={interactionVersion}
        mapInfoTarget={mapInfoTarget}
        countryPlaceTarget={countryPlaceTarget}
        onInteract={() => {
          setSelection(null);
          onInteract?.();
        }}
        attention={loading || error}
        details={dataNote}
        groups={groups}
        expandedId={selection?.kind === 'place' ? selection.id : null}
        powerSave={powerSave}
        station={station}
        playing={playing}
        pinned={pinned}
        selectionVersion={selectionVersion}
        active={visible}
        showHints={showHints}
        onPick={choosePlace}
      />
      {selection && (
        <Modal title={title} onClose={close}>
          <section className={styles.groupList} aria-label={title}>
            <p>{t('placeStationCount', { count: members.length })}</p>
            {group?.precision === 'region' && <p>{t('regionMapHint')}</p>}
            {members.length === 0 ? (
              <p>{t('placeEmpty')}</p>
            ) : (
              <ul>
                {members.slice(pageOffset, pageOffset + 12).map((item) => (
                  <li key={item.id}>
                    <button
                      aria-label={t('listenStation', { name: item.name })}
                      aria-current={station?.id === item.id ? 'true' : undefined}
                      onClick={() => onSelect(item, 'listen')}
                    >
                      {item.name}
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
                {t(
                  group.precision === 'region'
                    ? 'nextRegionStation'
                    : group.precision === 'country'
                      ? 'nextCountryStation'
                      : group.stations[0]?.city
                        ? 'nextCityStation'
                        : 'nextNearbyStation',
                )}
              </button>
            )}
          </section>
        </Modal>
      )}
    </section>
  );
}
