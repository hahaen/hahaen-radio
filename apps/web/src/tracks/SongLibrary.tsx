import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useTranslation } from 'react-i18next';
import { Trash2, Copy, Music2 } from 'lucide-react';
import { EmptyState } from '../app/EmptyState';
import type { Library } from '../library/store';
import { songKey } from '../library/model';
import { SongLinks } from './SongLinks';
import styles from './tracks.module.css';
export function SongLibrary({ library }: { library: Library }) {
  const { t } = useTranslation(),
    songs = useStore(library.store, (state) => state.songs);
  const [page, setPage] = useState(0),
    [manualCopy, setManualCopy] = useState(''),
    [copied, setCopied] = useState(false);
  const token = useRef(0);
  useEffect(
    () => () => {
      token.current++;
    },
    [],
  );
  const offset = Math.min(page * 30, Math.max(0, Math.floor((songs.length - 1) / 30) * 30));
  return (
    <section aria-label={t('savedSongs')} className={styles.songLibrary}>
      {songs.length > 0 && (
        <button
          className={styles.actionButton}
          disabled={!songs.length}
          onClick={() => {
            const text = songs.map((song) => `${song.artist} — ${song.title}`).join('\n'),
              current = ++token.current;
            setCopied(false);
            setManualCopy('');
            void (async () => {
              try {
                await navigator.clipboard.writeText(text);
                if (current === token.current) setCopied(true);
              } catch {
                if (current === token.current) setManualCopy(text);
              }
            })();
          }}
        >
          <Copy size={18} aria-hidden="true" />
          {t('copySongs')}
        </button>
      )}
      <p className={styles.copyState} aria-live="polite">
        {copied ? t('songsCopied') : ''}
      </p>
      {manualCopy && (
        <label className={styles.manualCopy}>
          {t('copySongsManually')}
          <textarea readOnly value={manualCopy} onFocus={(event) => event.currentTarget.select()} />
        </label>
      )}
      {!songs.length ? (
        <EmptyState icon={Music2} title={t('emptySongsTitle')}>
          {t('noSongs')}
        </EmptyState>
      ) : (
        <ul className={styles.songList}>
          {songs.slice(offset, offset + 30).map((song) => (
            <li key={songKey(song)}>
              <div className={styles.songHeading}>
                <div>
                  <strong>{song.title}</strong>
                  <p>{song.artist}</p>
                </div>
                <button
                  className={styles.actionButton}
                  aria-label={t('removeSong', { title: song.title })}
                  onClick={() => library.removeSong(song)}
                >
                  <Trash2 size={18} aria-hidden="true" />
                </button>
              </div>
              <details>
                <summary>{t('songSearch')}</summary>
                <SongLinks song={song} />
              </details>
            </li>
          ))}
        </ul>
      )}
      {songs.length > 30 && (
        <nav className={styles.actions} aria-label={t('savedSongs')}>
          <button
            disabled={offset === 0}
            onClick={() => setPage(Math.max(0, Math.floor(offset / 30) - 1))}
          >
            {t('earlier')}
          </button>
          <span>{t('pageNumber', { page: Math.floor(offset / 30) + 1 })}</span>
          <button
            disabled={offset + 30 >= songs.length}
            onClick={() => setPage(Math.floor(offset / 30) + 1)}
          >
            {t('later')}
          </button>
        </nav>
      )}
    </section>
  );
}
