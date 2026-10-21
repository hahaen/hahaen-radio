import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { GenreSchema, type Genre, type StationPreview } from '@haen/contracts';
import { useTranslation } from 'react-i18next';
import styles from './exploration.module.css';
import { genrePoint } from './genre-shape';
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
  const grid = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState({ before: false, after: false });
  const groups = useMemo(
    () =>
      GenreSchema.options.map((genre) => ({
        genre,
        stations: stations.filter((station) => station.genre === genre),
      })),
    [stations],
  );
  useEffect(() => {
    const element = grid.current;
    if (!element) return;
    const measure = () => {
      const before = element.scrollLeft > 2;
      const after = element.scrollLeft + element.clientWidth < element.scrollWidth - 2;
      setPages((value) =>
        value.before === before && value.after === after ? value : { before, after },
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const button of element.children) observer.observe(button);
    element.addEventListener('scroll', measure, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', measure);
    };
  }, []);
  const turnPage = (direction: number) => {
    const element = grid.current;
    if (!element) return;
    element.scrollBy({
      left: direction * element.clientWidth * 0.8,
      behavior:
        powerSave || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  };
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
      <header className={styles.atlasHeading}>
        <h2>{t('genreAtlas')}</h2>
        <p>{t('genreAtlasHelp')}</p>
      </header>
      <div ref={grid} className={styles.genreGrid} data-genre-grid>
        {groups.map((group, groupIndex) => (
          <button
            key={group.genre}
            data-genre={group.genre}
            className={styles.genreCluster}
            aria-current={currentGenre === group.genre ? 'true' : undefined}
            disabled={!group.stations.length}
            onFocus={(event) => {
              const button = event.currentTarget;
              const target =
                button.offsetHeight > (grid.current?.clientHeight ?? Infinity)
                  ? button.querySelector('span')
                  : button;
              if (target !== button)
                button
                  .querySelector('small')
                  ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
              target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }}
            onClick={(event) => {
              event.currentTarget.focus({ preventScroll: true });
              onChoose(group.genre);
            }}
          >
            <div className={styles.genreArt} data-genre-art aria-hidden="true">
              <svg className={styles.genreOrbit} viewBox="0 0 160 110">
                <ellipse cx="80" cy="55" rx="66" ry={37 + (groupIndex % 3) * 6} />
                <ellipse cx="80" cy="55" rx="54" ry={30 + (groupIndex % 3) * 5} />
                <path d="M76 55h8M80 51v8" />
                <circle cx={groupIndex % 2 ? 135 : 25} cy={groupIndex % 2 ? 35 : 75} r="2" />
              </svg>
              <svg className={styles.genreFallback} data-genre-fallback viewBox="0 0 160 110">
                {group.stations.slice(0, 160).map((station, index) => {
                  const point = genrePoint(index, Math.min(160, group.stations.length), groupIndex);
                  return (
                    <circle
                      key={station.id}
                      cx={80 + point.x * 55}
                      cy={55 + point.y * 55}
                      r={index % 4 === 0 ? 1.5 : 0.8}
                      opacity={point.strength}
                    />
                  );
                })}
              </svg>
            </div>
            <span className={styles.genreName}>{t('genre.' + group.genre)}</span>
            <small>{t('genreCount', { count: group.stations.length })}</small>
          </button>
        ))}
      </div>
      <div className={styles.atlasFooter} hidden={!pages.before && !pages.after}>
        <button aria-label={t('earlier')} disabled={!pages.before} onClick={() => turnPage(-1)}>
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <p className={styles.genreNote} hidden={!showHints}>
          {t('genreAtlasScroll')}
        </p>
        <button aria-label={t('later')} disabled={!pages.after} onClick={() => turnPage(1)}>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
