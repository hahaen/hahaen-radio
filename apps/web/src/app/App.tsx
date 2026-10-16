import { useQuery } from '@tanstack/react-query';
import { HealthResponseSchema } from '@haen/contracts';
import { useTranslation } from 'react-i18next';
import { setLanguage } from '../locales/i18n';
import { getJson } from '../services/http';
import styles from './App.module.css';

export function App() {
  const { t, i18n } = useTranslation();
  const health = useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => getJson('/health/live', HealthResponseSchema, signal),
    retry: 1,
    staleTime: 30000,
  });
  return (
    <div className={styles.page}>
      <a className={styles.skip} href="#main">
        {t('skip')}
      </a>
      <header className={styles.header}>
        <a className={styles.brand} href="/" aria-label="声屿 HAEN">
          {t('brand')} <span>HAEN</span>
        </a>
        <div className={styles.languages} role="group" aria-label={t('language')}>
          <button
            lang="zh-CN"
            aria-pressed={i18n.language === 'zh'}
            onClick={() => {
              void setLanguage('zh');
            }}
          >
            中文
          </button>
          <button
            lang="en"
            aria-pressed={i18n.language === 'en'}
            onClick={() => {
              void setLanguage('en');
            }}
          >
            EN
          </button>
        </div>
      </header>
      <main id="main" tabIndex={-1} className={styles.main}>
        <p className={styles.eyebrow}>HAEN · {t('category')}</p>
        <h1>{t('headline')}</h1>
        <p className={styles.description}>{t('preparing')}</p>
        <div role="status" className={styles.connection}>
          <span className={styles.dot} />
          {health.isPending ? t('connecting') : health.isError ? t('unavailable') : t('ready')}
        </div>
        {health.isError && (
          <button
            className={styles.retry}
            onClick={() => {
              void health.refetch();
            }}
          >
            {t('retry')}
          </button>
        )}
      </main>
      <footer className={styles.footer}>
        <span className={styles.rule} />
        {t('tagline')}
        <span className={styles.rule} />
      </footer>
    </div>
  );
}
