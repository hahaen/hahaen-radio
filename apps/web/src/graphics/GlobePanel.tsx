import { applicationPath } from '../platform/paths';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { StationPreview } from '@haen/contracts';
import type { GlobeController, PickReason } from './globe';
import type { StationGroup } from './model';
import { loadLand } from './land';
import { mapPosition, countryName } from './location';
import styles from './exploration.module.css';
import { MapNotes } from './MapNotes';
export function GlobePanel({
  onInteract,
  interactionVersion = 0,
  groups,
  details,
  station,
  playing = false,
  pinned,
  selectionVersion,
  active,
  onPick,
  showHints = true,
  powerSave = false,
  expandedId = null,
  attention = false,
}: {
  onInteract?(): void;
  interactionVersion?: number;
  groups: StationGroup[];
  details: ReactNode;
  station: StationPreview | null;
  playing?: boolean;
  pinned: boolean;
  selectionVersion: number;
  active: boolean;
  onPick(group: StationGroup, reason: PickReason): void;
  showHints?: boolean;
  powerSave?: boolean;
  expandedId?: string | null;
  attention?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const host = useRef<HTMLDivElement>(null),
    engine = useRef<GlobeController | null>(null);
  const selectionLabel = useRef<HTMLDivElement>(null);
  const latest = useRef({
    groups,
    station,
    playing,
    pinned,
    active,
    onPick,
    onInteract,
    powerSave,
    expandedId,
    label: t('globeCanvas'),
  });
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable' | 'lost'>('loading');
  const [generation, setGeneration] = useState(0),
    [preview, setPreview] = useState<StationGroup | null>(null);
  const position = station ? mapPosition(station) : null;
  const selectedGroup = useMemo(
    () =>
      station
        ? groups.find((group) => group.stations.some((item) => item.id === station.id))
        : null,
    [groups, station],
  );
  useEffect(() => {
    latest.current = {
      groups,
      station,
      playing,
      pinned,
      active,
      onPick,
      onInteract,
      powerSave,
      expandedId,
      label: t('globeCanvas'),
    };
  }, [groups, station, playing, pinned, active, onPick, onInteract, powerSave, expandedId, t]);
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    const controller = new AbortController();
    let instance: GlobeController | undefined;
    void Promise.all([import('./globe'), loadLand(controller.signal)])
      .then(([module, land]) => {
        if (controller.signal.aborted) return;
        instance = module.createGlobe(container, land, {
          interact: () => latest.current.onInteract?.(),
          label: latest.current.label,
          selectionLabel: selectionLabel.current,
          pick: (group, reason) => latest.current.onPick(group, reason),
          preview: setPreview,
          lost: () => setState('lost'),
          restored: () => {
            setState('loading');
            setPreview(null);
            setGeneration((value) => value + 1);
          },
        });
        engine.current = instance;
        const value = latest.current;
        instance.setData(value.groups);
        instance.setSelection(value.station);
        instance.setPinned(value.pinned);
        instance.setPlaying(value.playing);
        instance.setActive(value.active);
        instance.setPowerSave(value.powerSave);
        instance.setExpanded(value.expandedId);
        setState('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          container.replaceChildren();
          setState('unavailable');
        }
      });
    return () => {
      controller.abort();
      instance?.destroy();
      if (engine.current === instance) engine.current = null;
    };
  }, [generation]);
  useEffect(() => {
    engine.current?.setPowerSave(powerSave);
  }, [powerSave]);
  useEffect(() => {
    engine.current?.setExpanded(expandedId);
  }, [expandedId]);
  useEffect(() => {
    engine.current?.setData(groups);
  }, [groups]);
  useEffect(() => {
    engine.current?.setSelection(station);
  }, [station]);
  useEffect(() => {
    engine.current?.setPlaying(playing);
  }, [playing]);
  useEffect(() => {
    engine.current?.setPinned(pinned);
  }, [pinned]);
  useEffect(() => {
    engine.current?.cancelSelection();
  }, [selectionVersion]);
  useEffect(() => {
    engine.current?.setActive(active);
  }, [active]);
  useEffect(() => {
    const canvas = host.current?.querySelector('canvas');
    if (!canvas) return;
    canvas.setAttribute('aria-label', t('globeCanvas'));
  }, [state, t]);
  return (
    <div
      className={styles.globePanel}
      data-testid="globe-panel"
      data-state={state}
      hidden={!active}
    >
      <div className={styles.globeStage}>
        <div
          ref={host}
          className={styles.canvasHost}
          aria-hidden={state !== 'ready'}
          inert={state !== 'ready'}
        />
        <div
          ref={selectionLabel}
          className={styles.selectionLabel}
          aria-hidden="true"
          data-testid="selected-station-label"
        >
          {station && (
            <div className={styles.selectionCopy}>
              <span className={styles.selectionCaption}>
                {pinned ? t('selectionPinned') : t('selectedStation')}
                <span>
                  {t('genre.' + station.genre)}
                  {station.bitrate !== null && station.bitrate > 0
                    ? ` · ${station.bitrate} kbps`
                    : ''}
                </span>
              </span>
              <strong>{station.name}</strong>
            </div>
          )}
        </div>
        {state === 'ready' ? (
          <span className={styles.reticle} aria-hidden="true" />
        ) : (
          <div className={styles.fallback}>
            <img src={applicationPath('geography/world.svg')} alt="" />
            <p aria-live="polite">
              {t(
                state === 'loading'
                  ? 'globeLoading'
                  : state === 'lost'
                    ? 'globeLost'
                    : 'globeUnavailable',
              )}
            </p>
            {state !== 'loading' && (
              <button
                onClick={() => {
                  setState('loading');
                  setPreview(null);
                  setGeneration((value) => value + 1);
                }}
              >
                {t('globeRetry')}
              </button>
            )}
          </div>
        )}
      </div>
      <MapNotes
        interactionVersion={interactionVersion}
        attention={attention}
        preview={
          <div className={styles.preview}>
            {preview ? (
              <>
                <span>
                  {preview.precision === 'country'
                    ? t('countryPlace', {
                        country: countryName(
                          preview.stations[0]?.countryCode ?? null,
                          i18n.language,
                        ),
                      })
                    : preview.precision === 'region'
                      ? t('regionPlace', {
                          region:
                            i18n.language === 'en' ? preview.regionNameEn : preview.regionName,
                        })
                      : (preview.stations[0]?.city ??
                        (preview.stations[0]?.nearbyCity
                          ? t('nearby', { city: preview.stations[0].nearbyCity })
                          : t('coordinatePlace')))}
                  {preview.precision !== 'country' && preview.stations[0]?.countryCode === 'TW'
                    ? ` · ${countryName('TW', i18n.language)}`
                    : ''}
                </span>
                <span>{preview.stations[0]?.name}</span>
              </>
            ) : station && !position ? (
              t('noCoordinates')
            ) : position?.precision === 'region' ? (
              <span>{t('regionMapHint')}</span>
            ) : position?.precision === 'country' ? (
              <span>{t('countryMapHint')}</span>
            ) : (
              showHints && <span>{t(pinned ? 'globePinnedHint' : 'globeMoveHint')}</span>
            )}
            {selectedGroup && selectedGroup.stations.length > 1 && (
              <button onClick={() => onPick(selectedGroup, 'click')}>
                {selectedGroup.precision === 'region'
                  ? t('regionPlace', {
                      region:
                        i18n.language === 'en'
                          ? selectedGroup.regionNameEn
                          : selectedGroup.regionName,
                    })
                  : selectedGroup.precision === 'country'
                    ? t('countryPlace', {
                        country: countryName(station?.countryCode ?? null, i18n.language),
                      })
                    : t('placeStationCount', { count: selectedGroup.stations.length })}
              </button>
            )}
          </div>
        }
      >
        {details}
      </MapNotes>
    </div>
  );
}
