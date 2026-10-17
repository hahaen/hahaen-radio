import { useMemo } from 'react';
import { GenreSchema, type Genre, type StationPreview } from '@haen/contracts';
import { useTranslation } from 'react-i18next';
import styles from './exploration.module.css';
function hash(value: string) {
  let result = 2166136261;
  for (const char of value) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return result >>> 0;
}
export function GenreAtlas({
  stations,
  onChoose,
  showHints = true,
}: {
  stations: readonly StationPreview[];
  onChoose(genre: Genre): void;
  showHints?: boolean;
}) {
  const { t } = useTranslation();
  const groups = useMemo(
    () =>
      GenreSchema.options.map((genre) => ({
        genre,
        stations: stations.filter((station) => station.genre === genre),
      })),
    [stations],
  );
  return (
    <div className={styles.genreAtlas} role="group" aria-label={t('genreAtlas')}>
      {groups.map((group) => (
        <button
          key={group.genre}
          className={styles.genreCluster}
          disabled={!group.stations.length}
          onClick={() => onChoose(group.genre)}
        >
          <svg viewBox="0 0 140 110" aria-hidden="true">
            {group.stations.slice(0, 160).map((station) => {
              const seed = hash(station.id),
                angle = ((seed % 10000) / 10000) * Math.PI * 2,
                radius = 6 + Math.sqrt(((seed >>> 8) % 1000) / 1000) * 40;
              return (
                <circle
                  key={station.id}
                  cx={70 + Math.cos(angle) * radius}
                  cy={55 + Math.sin(angle) * radius}
                  r={seed % 4 === 0 ? 1.7 : 1.1}
                />
              );
            })}
          </svg>
          <span>{t('genre.' + group.genre)}</span>
          <small>{t('genreCount', { count: group.stations.length })}</small>
        </button>
      ))}
      <p className={styles.genreNote} hidden={!showHints}>
        {t('genreAtlasHelp')}
      </p>
    </div>
  );
}
