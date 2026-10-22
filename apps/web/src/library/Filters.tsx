import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import type { CatalogManifest } from '@haen/contracts';
import { BROWSABLE_GENRES } from '../catalog/genres';
import { useTranslation } from 'react-i18next';
import { LanguageChoices } from './LanguageChoices';
import { defaultFilters, type ListeningFilters } from './model';
import styles from './library.module.css';

export function Filters({
  value,
  manifest,
  expanded = false,
  compact = false,
  onChange,
}: {
  value: ListeningFilters;
  expanded?: boolean;
  compact?: boolean;
  manifest: CatalogManifest | undefined;
  onChange(value: ListeningFilters): void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(expanded);
  const change = (patch: Partial<ListeningFilters>) => onChange({ ...value, ...patch });
  const active =
    (value.genres !== null ? 1 : 0) +
    (value.languages !== null ? 1 : 0) +
    (value.minBitrate > 0 ? 1 : 0) +
    (value.favoritesOnly ? 1 : 0);
  return (
    <details
      className={`${styles.filters} ${compact ? styles.compactFilters : ''}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        {compact && <SlidersHorizontal size={14} aria-hidden="true" />}
        {t('filters')}
        {active > 0 && (
          <span aria-label={t('activeFilterCount', { count: active })}>
            {compact ? active : t('activeFilterCount', { count: active })}
          </span>
        )}
      </summary>
      <fieldset>
        <legend>{t('filterGenres')}</legend>
        <div className={styles.actions}>
          <button
            type="button"
            aria-pressed={value.genres === null}
            onClick={() => change({ genres: null })}
          >
            {t('allGenres')}
          </button>
          <button type="button" onClick={() => change({ genres: [] })}>
            {t('selectNone')}
          </button>
        </div>
        <div className={styles.choices}>
          {BROWSABLE_GENRES.map((genre) => (
            <label key={genre}>
              <input
                type="checkbox"
                checked={value.genres?.includes(genre) ?? false}
                onChange={(event) =>
                  change({
                    genres: event.target.checked
                      ? [...(value.genres ?? []), genre]
                      : (value.genres ?? []).filter((id) => id !== genre),
                  })
                }
              />
              {t('genre.' + genre)}
            </label>
          ))}
        </div>
      </fieldset>
      <LanguageChoices
        value={value.languages}
        manifest={manifest}
        active={open}
        onChange={(languages) => change({ languages })}
      />
      <fieldset>
        <legend>{t('filterBitrate')}</legend>
        <select
          aria-label={t('filterBitrate')}
          value={value.minBitrate}
          onChange={(event) =>
            change({ minBitrate: Number(event.target.value) as ListeningFilters['minBitrate'] })
          }
        >
          <option value={0}>{t('allBitrates')}</option>
          {[128, 192, 320].map((rate) => (
            <option key={rate} value={rate}>
              {t('minimumBitrate', { rate })}
            </option>
          ))}
        </select>
      </fieldset>
      <label className={styles.favoriteFilter}>
        <input
          type="checkbox"
          checked={value.favoritesOnly}
          onChange={(event) => change({ favoritesOnly: event.target.checked })}
        />
        {t('favoritesOnly')}
      </label>
      <button type="button" className={styles.secondary} onClick={() => onChange(defaultFilters())}>
        {t('clearFilters')}
      </button>
    </details>
  );
}
