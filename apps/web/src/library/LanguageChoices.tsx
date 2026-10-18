import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { normalizeLanguage, normalizeLanguages, type CatalogManifest } from '@haen/contracts';
import { useTranslation } from 'react-i18next';
import { getCatalog } from '../services/catalog';
import styles from './library.module.css';
export function LanguageChoices({
  value,
  manifest,
  active = true,
  onChange,
}: {
  value: string[] | null;
  manifest: CatalogManifest | undefined;
  active?: boolean;
  onChange(value: string[] | null): void;
}) {
  const { t, i18n } = useTranslation();
  const [languageSearch, setLanguageSearch] = useState('');
  const fallback = useQuery({
    queryKey: ['catalog-metadata'],
    queryFn: ({ signal }) => getCatalog(signal),
    enabled: active && !manifest,
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
  const groups = new Map<string, { id: string; count: number }>();
  for (const item of metadata?.languages ?? []) {
    const id = normalizeLanguage(item.id);
    if (id) groups.set(id, { id, count: (groups.get(id)?.count ?? 0) + item.count });
  }
  const selected = value === null ? null : normalizeLanguages(value);
  const languages = [...groups.values()]
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
    .filter((item) =>
      [item.id, nameOf(item.id)]
        .join(' ')
        .toLowerCase()
        .includes(languageSearch.trim().toLowerCase()),
    );
  return (
    <fieldset>
      <legend>{t('stationLanguages')}</legend>
      <div className={styles.actions}>
        <button type="button" aria-pressed={value === null} onClick={() => onChange(null)}>
          {t('allLanguages')}
        </button>
        <button type="button" onClick={() => onChange([])}>
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
              checked={selected?.includes(item.id) ?? false}
              disabled={!selected?.includes(item.id) && (selected?.length ?? 0) >= 32}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...(selected ?? []), item.id]
                    : (selected ?? []).filter((code) => code !== item.id),
                )
              }
            />
            {nameOf(item.id)}
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
  );
}
