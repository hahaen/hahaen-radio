import { useState } from 'react';
import { useStore } from 'zustand';
import { useTranslation } from 'react-i18next';
import { Star } from 'lucide-react';
import type { NowPlaying } from '@haen/contracts';
import type { Library } from '../library/store';
import { songKey } from '../library/model';
import { Modal } from '../app/Modal';
import { SongLinks } from './SongLinks';
import { LyricsView } from './LyricsView';
import styles from './tracks.module.css';
export function TrackSummary({
  value,
  active,
  loading,
  onOpen,
  compact = false,
  failed = false,
}: {
  value: NowPlaying | undefined;
  active: boolean;
  loading: boolean;
  onOpen(): void;
  compact?: boolean;
  failed?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.summary} data-compact={compact}>
      <p>{value?.rawTitle ?? t(loading && active ? 'trackLoading' : 'trackUnknown')}</p>
      {value?.rawTitle && (!active || failed) && (
        <small className={styles.retained}>{t('trackRetained')}</small>
      )}
      <button
        className={styles.actionButton}
        onClick={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          onOpen();
        }}
      >
        {t('trackDetails')}
      </button>
    </div>
  );
}
export function TrackPanel({
  value,
  active,
  loading,
  failed,
  library,
  onClose,
}: {
  value: NowPlaying | undefined;
  active: boolean;
  loading: boolean;
  failed: boolean;
  library: Library;
  onClose(): void;
}) {
  const { t, i18n } = useTranslation(),
    songs = useStore(library.store, (state) => state.songs);
  const [capacity, setCapacity] = useState(false);
  const song = value?.song,
    favorite = !!song && songs.some((item) => songKey(item) === songKey(song));
  return (
    <Modal title={t('trackDetails')} onClose={onClose}>
      <div className={styles.trackPanel}>
        <p className={styles.hint}>{t(active ? 'trackStationSource' : 'trackPausedSource')}</p>
        {loading && active ? (
          <p>{t('trackLoading')}</p>
        ) : !value || failed ? (
          <p>{t('trackUnavailable')}</p>
        ) : (
          <>
            {value.rawTitle ? (
              <>
                <h3>{song?.title ?? value.rawTitle}</h3>
                {song && <p>{song.artist}</p>}
              </>
            ) : (
              <p>{t('trackState.' + value.status)}</p>
            )}
            <p className={styles.observation}>
              {t('trackObserved', {
                time: new Intl.DateTimeFormat(i18n.language === 'en' ? 'en-GB' : 'zh-CN', {
                  timeStyle: 'medium',
                }).format(new Date(value.observedAt)),
              })}
            </p>
            {song ? (
              <>
                <button
                  className={styles.actionButton}
                  aria-pressed={favorite}
                  onClick={() => {
                    try {
                      library.toggleSong(song);
                      setCapacity(false);
                    } catch {
                      setCapacity(true);
                    }
                  }}
                >
                  <Star size={18} fill={favorite ? 'currentColor' : 'none'} aria-hidden="true" />
                  {t(favorite ? 'unfavoriteSong' : 'favoriteSong')}
                </button>
                {capacity && <p role="alert">{t('libraryCapacity')}</p>}
                <SongLinks song={song} />
                <LyricsView
                  key={value.stationId + ':' + value.streamId + ':' + songKey(song)}
                  song={song}
                  playing={active}
                />
              </>
            ) : (
              value.rawTitle && <p className={styles.hint}>{t('trackUnstructured')}</p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
