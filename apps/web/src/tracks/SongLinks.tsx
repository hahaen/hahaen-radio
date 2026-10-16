import type { SongIdentity } from '@haen/contracts';
import { useTranslation } from 'react-i18next';
import { songSearches } from './search';
import styles from './tracks.module.css';
export function SongLinks({ song }: { song: SongIdentity }) {
  const { t } = useTranslation();
  return (
    <nav className={styles.links} aria-label={t('songSearch')}>
      {songSearches(song).map((item) => (
        <a
          key={item.name}
          href={item.href}
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
        >
          {t('searchOn', { service: item.name })}
        </a>
      ))}
    </nav>
  );
}
