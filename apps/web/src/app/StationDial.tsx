import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { StationPreview } from '@haen/contracts';
import styles from './App.module.css';
export function StationDial({
  stations,
  station,
  onSelect,
}: {
  stations: readonly StationPreview[];
  station: StationPreview;
  onSelect(value: StationPreview): void;
}) {
  const { t } = useTranslation();
  const choices = useMemo(() => {
    const index = stations.findIndex((value) => value.id === station.id);
    if (index < 0) return [];
    // A bounded window follows the actual filtered directory order, never invented frequencies.
    return stations.slice(Math.max(0, index - 25), index + 26);
  }, [stations, station.id]);
  const [draft, setDraft] = useState<{ source: string; id: string } | null>(null);
  if (choices.length < 2) return null;
  const candidate =
    draft?.source === station.id
      ? (choices.find((value) => value.id === draft.id) ?? station)
      : station;
  const index = Math.max(
    0,
    choices.findIndex((value) => value.id === candidate.id),
  );
  const commit = () => {
    if (candidate.id !== station.id) onSelect(candidate);
    setDraft(null);
  };
  return (
    <div className={styles.stationDial}>
      <label htmlFor="station-dial">{t('stationDial')}</label>
      <input
        id="station-dial"
        type="range"
        min={0}
        max={choices.length - 1}
        step={1}
        value={index}
        aria-valuetext={candidate.name}
        onChange={(event) => {
          const value = choices[Number(event.target.value)];
          if (value) setDraft({ source: station.id, id: value.id });
        }}
        onPointerUp={commit}
        onPointerCancel={() => setDraft(null)}
        onBlur={() => setDraft(null)}
        onKeyUp={(event) => {
          if (
            ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)
          )
            commit();
        }}
      />
      <span>{candidate.name}</span>
    </div>
  );
}
