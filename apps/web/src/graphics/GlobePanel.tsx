import { useEffect, useRef, useState } from 'react';
import { Focus, Minus, Plus, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { StationPreview } from '@haen/contracts';
import type { GlobeController, PickReason } from './globe';
import type { StationGroup } from './model';
import { loadLand } from './land';
import styles from './exploration.module.css';
export function GlobePanel({
  groups,
  station,
  pinned,
  selectionVersion,
  active,
  onPick,
  showHints = true,
}: {
  groups: StationGroup[];
  station: StationPreview | null;
  pinned: boolean;
  selectionVersion: number;
  active: boolean;
  onPick(group: StationGroup, reason: PickReason): void;
  showHints?: boolean;
}) {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null),
    engine = useRef<GlobeController | null>(null);
  const latest = useRef({ groups, station, pinned, active, onPick });
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable' | 'lost'>('loading');
  const [generation, setGeneration] = useState(0),
    [preview, setPreview] = useState<StationGroup | null>(null),
    [notice, setNotice] = useState(false);
  useEffect(() => {
    latest.current = { groups, station, pinned, active, onPick };
  }, [groups, station, pinned, active, onPick]);
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    const controller = new AbortController();
    let instance: GlobeController | undefined;
    void Promise.all([import('./globe'), loadLand(controller.signal)])
      .then(([module, land]) => {
        if (controller.signal.aborted) return;
        instance = module.createGlobe(container, land, {
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
        instance.setActive(value.active);
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
    engine.current?.setData(groups);
  }, [groups]);
  useEffect(() => {
    engine.current?.setSelection(station);
  }, [station]);
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
    if (showHints) canvas.setAttribute('aria-describedby', 'globe-help');
    else canvas.removeAttribute('aria-describedby');
  }, [state, t, showHints]);
  const disabled = state !== 'ready';
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
        {state === 'ready' ? (
          <span className={styles.reticle} aria-hidden="true" />
        ) : (
          <div className={styles.fallback}>
            <img src="/geography/world.svg" alt="" />
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
        <div className={styles.mapControls} aria-label={t('globeControls')}>
          <button
            disabled={disabled}
            aria-label={t('zoomIn')}
            onClick={() => engine.current?.zoom(0.82)}
          >
            <Plus size={20} aria-hidden="true" />
          </button>
          <button
            disabled={disabled}
            aria-label={t('zoomOut')}
            onClick={() => engine.current?.zoom(1.22)}
          >
            <Minus size={20} aria-hidden="true" />
          </button>
          <button
            disabled={disabled}
            aria-label={t('resetGlobe')}
            onClick={() => engine.current?.reset()}
          >
            <RotateCcw size={20} aria-hidden="true" />
          </button>
          <button
            disabled={disabled || !station || station.locationPrecision !== 'coordinates'}
            aria-label={t('locateStation')}
            onClick={() => {
              if (station) setNotice(!engine.current?.focus(station));
            }}
          >
            <Focus size={20} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className={styles.preview}>
        {notice || (station && station.locationPrecision !== 'coordinates') ? (
          t('noCoordinates')
        ) : preview ? (
          <>
            <span>
              {preview.stations[0]?.city ??
                (preview.stations[0]?.nearbyCity
                  ? t('nearby', { city: preview.stations[0].nearbyCity })
                  : t('coordinatePlace'))}
            </span>
            <span>{t('placeStationCount', { count: preview.stations.length })}</span>
          </>
        ) : (
          showHints && <span>{t(pinned ? 'globePinnedHint' : 'globeMoveHint')}</span>
        )}
      </div>
      <p id="globe-help" className={styles.help} hidden={!showHints}>
        {t('globeHelp')}
      </p>
    </div>
  );
}
