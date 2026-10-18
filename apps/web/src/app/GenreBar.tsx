import { useEffect, useRef, useState } from 'react';
import { GenreSchema, type CatalogManifest, type StationPreview } from '@haen/contracts';
import { SlidersHorizontal, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Filters } from '../library/Filters';
import type { ListeningFilters } from '../library/model';
import styles from './App.module.css';

export function GenreBar({
  value,
  stations,
  manifest,
  onChange,
  hidden,
}: {
  value: ListeningFilters;
  stations: readonly StationPreview[];
  manifest: CatalogManifest | undefined;
  onChange(value: ListeningFilters): void;
  hidden: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing) {
        setOpen(false);
        root.current?.querySelector<HTMLButtonElement>('button[aria-expanded]')?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  const counts = new Map(GenreSchema.options.map((genre) => [genre, 0]));
  for (const station of stations) counts.set(station.genre, (counts.get(station.genre) ?? 0) + 1);
  const count = (n: number) => n.toLocaleString(i18n.language);
  return (
    <div ref={root} className={styles.genreDock} hidden={hidden}>
      {open && (
        <section className={styles.filterPanel} aria-label={t('filters')}>
          <button
            className={styles.filterClose}
            aria-label={t('closePanel')}
            onClick={() => setOpen(false)}
          >
            <X size={20} aria-hidden="true" />
          </button>
          <Filters expanded value={value} manifest={manifest} onChange={onChange} />
        </section>
      )}
      <nav className={styles.genreBar} aria-label={t('filterGenres')}>
        <button onClick={() => setOpen(!open)} aria-expanded={open}>
          <SlidersHorizontal size={16} aria-hidden="true" />
          {t('filters')}
        </button>
        <button
          aria-pressed={value.genres === null}
          onClick={() => onChange({ ...value, genres: null })}
        >
          {t('allGenres')} <small>{count(stations.length)}</small>
        </button>
        {GenreSchema.options.map((genre) => (
          <button
            key={genre}
            data-genre={genre}
            aria-pressed={value.genres?.includes(genre) ?? false}
            onClick={() =>
              onChange({
                ...value,
                genres: value.genres?.length === 1 && value.genres[0] === genre ? null : [genre],
              })
            }
          >
            <i aria-hidden="true" />
            {t('genre.' + genre)} <small>{count(counts.get(genre) ?? 0)}</small>
          </button>
        ))}
      </nav>
    </div>
  );
}
