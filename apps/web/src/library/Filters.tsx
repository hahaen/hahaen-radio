import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GenreSchema, type CatalogManifest } from '@haen/contracts';
import { useTranslation } from 'react-i18next';
import { getCatalog } from '../services/catalog';
import { defaultFilters, type ListeningFilters } from './model';
import styles from './library.module.css';

export function Filters({
  value,
  manifest,
  onChange,
}: {
  value: ListeningFilters;
  manifest: CatalogManifest | undefined;
  onChange(value: ListeningFilters): void;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(
    value.genres !== null ||
      value.languages !== null ||
      value.minBitrate > 0 ||
      value.favoritesOnly,
  );
  const [languageSearch, setLanguageSearch] = useState('');
  const fallback = useQuery({
    queryKey: ['catalog-metadata'],
    queryFn: ({ signal }) => getCatalog(signal),
    enabled: open && !manifest,
    staleTime: 60000,
    retry: 0,
  });
  const metadata = manifest ?? fallback.data;
  const names = useMemo(
    () => new Intl.DisplayNames([i18n.language === 'en' ? 'en' : 'zh-CN'], { type: 'language' }),
    [i18n.language],
  );
  const nameOf = (code: string) => {
    try {
      return names.of(code) ?? code;
    } catch {
      return code;
    }
  };
  const languages =
    metadata?.languages.filter((item) =>
      [item.id, nameOf(item.id)]
        .join(' ')
        .toLowerCase()
        .includes(languageSearch.trim().toLowerCase()),
    ) ?? [];
  const change = (patch: Partial<ListeningFilters>) => onChange({ ...value, ...patch });
  const active =
    (value.genres !== null ? 1 : 0) +
    (value.languages !== null ? 1 : 0) +
    (value.minBitrate > 0 ? 1 : 0) +
    (value.favoritesOnly ? 1 : 0);
  return (
    <details
      className={styles.filters}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        {t('filters')}
        {active > 0 && <span>{t('activeFilterCount', { count: active })}</span>}
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
          {GenreSchema.options.map((genre) => (
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
      <fieldset>
        <legend>{t('stationLanguages')}</legend>
        <div className={styles.actions}>
          <button
            type="button"
            aria-pressed={value.languages === null}
            onClick={() => change({ languages: null })}
          >
            {t('allLanguages')}
          </button>
          <button type="button" onClick={() => change({ languages: [] })}>
            {t('selectNone')}
          </button>
        </div>
        <label className={styles.languageSearch}>
          {t('findLanguage')}
          <input
            type="search"
            value={languageSearch}
            maxLength={64}
            onChange={(event) => setLanguageSearch(event.target.value)}
          />
        </label>
        <div className={styles.choices}>
          {languages.slice(0, 60).map((item) => (
            <label key={item.id}>
              <input
                type="checkbox"
                checked={value.languages?.includes(item.id) ?? false}
                disabled={
                  !value.languages?.includes(item.id) && (value.languages?.length ?? 0) >= 32
                }
                onChange={(event) =>
                  change({
                    languages: event.target.checked
                      ? [...(value.languages ?? []), item.id]
                      : (value.languages ?? []).filter((code) => code !== item.id),
                  })
                }
              />
              {nameOf(item.id)} <small>{item.count.toLocaleString(i18n.language)}</small>
            </label>
          ))}
        </div>
        <p className={styles.hint}>
          {t('languageLimit')}
          {languages.length > 60 && ' ' + t('moreLanguages')}
        </p>
        {!metadata && (
          <p className={styles.hint}>
            {t(fallback.isError ? 'languageUnavailable' : 'directoryLoading')}
            {fallback.isError && (
              <button
                type="button"
                onClick={() => {
                  void fallback.refetch();
                }}
              >
                {t('retry')}
              </button>
            )}
          </p>
        )}
      </fieldset>
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
