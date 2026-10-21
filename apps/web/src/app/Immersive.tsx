import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { ArrowLeft, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { StationPreview } from '@haen/contracts';
import type { PlaybackSnapshot } from '../audio/engine';
import { ListeningArt } from './ListeningArt';
import type { SceneOptions } from '../library/model';
import styles from './controls.module.css';
export function Immersive({
  station,
  location,
  status,
  playbackState,
  favorite,
  onFavorite,
  onExit,
  track,
  effect,
  powerSave,
}: {
  station: StationPreview | null;
  location: string;
  status: string;
  playbackState: PlaybackSnapshot['status'];
  favorite: boolean;
  onFavorite(): void;
  onExit(): void;
  track?: ReactNode;
  effect: SceneOptions['immersion'];
  powerSave: boolean;
}) {
  const { t } = useTranslation(),
    exit = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    exit.current?.focus({ preventScroll: true });
  }, []);
  return (
    <main className={styles.immersive} aria-label={t('immersiveListening')}>
      <header className={styles.immersiveHeader}>
        <button ref={exit} className={styles.exit} onClick={onExit}>
          <ArrowLeft size={18} aria-hidden="true" />
          {t('exitImmersive')}
        </button>
        <span className={styles.immersiveBrand} aria-hidden="true">
          HAEN
        </span>
      </header>
      <div className={styles.listeningStage}>
        <ListeningArt
          effect={effect}
          genre={station?.genre}
          playing={playbackState === 'playing'}
          powerSave={powerSave}
        />
        <div className={styles.listeningCopy}>
          <p className={styles.listeningStatus} role="status" data-state={playbackState}>
            <i aria-hidden="true" />
            {status}
          </p>
          <h1>{station?.name ?? t('tagline')}</h1>
          <p className={styles.location}>{location}</p>
          {station && (
            <p className={styles.listeningMeta}>
              {t('genre.' + station.genre)}
              {station.bitrate !== null && station.bitrate > 0 ? ` · ${station.bitrate} kbps` : ''}
            </p>
          )}
          {station && (
            <button
              className={styles.favorite}
              aria-pressed={favorite}
              aria-label={[
                favorite ? t('favorited') : '',
                t(favorite ? 'unfavoriteStation' : 'favoriteStation', { name: station.name }),
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={onFavorite}
            >
              <Star size={20} fill={favorite ? 'currentColor' : 'none'} aria-hidden="true" />
              {t(favorite ? 'favorited' : 'favorite')}
            </button>
          )}
          {track && <div className={styles.trackSummary}>{track}</div>}
        </div>
      </div>
    </main>
  );
}
