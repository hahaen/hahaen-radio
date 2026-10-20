import { useEffect, useMemo, useRef } from 'react';
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
  powerSave = false,
  currentGenre,
}: {
  stations: readonly StationPreview[];
  onChoose(genre: Genre): void;
  showHints?: boolean;
  powerSave?: boolean;
  currentGenre?: Genre | null;
}) {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const groups = useMemo(
    () =>
      GenreSchema.options.map((genre) => ({
        genre,
        stations: stations.filter((station) => station.genre === genre),
      })),
    [stations],
  );
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let cancelled = false;
    let dispose: (() => void) | undefined;
    void import('./genre-scene')
      .then(({ createGenreScene }) => {
        if (cancelled) return;
        try {
          dispose = createGenreScene(
            container,
            groups.map((group) => ({
              id: group.genre,
              count: group.stations.length,
              label: container.querySelector<HTMLElement>(`[data-genre="${group.genre}"]`)!,
            })),
            powerSave,
          );
        } catch {
          /* The same labelled buttons remain available without WebGL. */
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [groups, powerSave]);
  return (
    <div ref={host} className={styles.genreAtlas} role="group" aria-label={t('genreAtlas')}>
      <div className={styles.genreGrid}>
        {groups.map((group, groupIndex) => (
          <button
            key={group.genre}
            data-genre={group.genre}
            className={styles.genreCluster}
            aria-current={currentGenre === group.genre ? 'true' : undefined}
            disabled={!group.stations.length}
            onFocus={(event) =>
              event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' })
            }
            onClick={(event) => {
              event.currentTarget.focus({ preventScroll: true });
              onChoose(group.genre);
            }}
          >
            <div className={styles.genreArt} data-genre-art aria-hidden="true">
              <svg viewBox="0 0 140 90">
                {group.stations.slice(0, 160).map((station, index) => {
                  const seed = hash(station.id),
                    radius = Math.pow((index + 0.5) / Math.min(160, group.stations.length), 0.85),
                    arms = 2 + (groupIndex % 3),
                    angle =
                      ((index % arms) * Math.PI * 2) / arms + radius * 4.5 + Math.sin(seed) * 0.5;
                  return (
                    <circle
                      key={station.id}
                      cx={70 + Math.cos(angle) * radius * 50}
                      cy={45 + Math.sin(angle) * radius * 28}
                      r={seed % 4 === 0 ? 1.6 : 1}
                      opacity={0.45 + (seed % 100) / 200}
                    />
                  );
                })}
              </svg>
            </div>
            <span>{t('genre.' + group.genre)}</span>
            <small>{t('genreCount', { count: group.stations.length })}</small>
          </button>
        ))}
      </div>
      <p className={styles.genreNote} hidden={!showHints}>
        {t('genreAtlasScroll')}
      </p>
    </div>
  );
}
