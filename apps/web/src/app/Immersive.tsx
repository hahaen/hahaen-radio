import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { ArrowLeft, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { StationPreview } from '@haen/contracts';
import type { PlaybackSnapshot } from '../audio/engine';
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
}: {
  station: StationPreview | null;
  location: string;
  status: string;
  playbackState: PlaybackSnapshot['status'];
  favorite: boolean;
  onFavorite(): void;
  onExit(): void;
  track?: ReactNode;
}) {
  const { t } = useTranslation(),
    exit = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    exit.current?.focus({ preventScroll: true });
  }, []);
  return (
    <main className={styles.immersive} aria-label={t('immersiveListening')}>
      <button ref={exit} className={styles.exit} onClick={onExit}>
        <ArrowLeft size={20} aria-hidden="true" />
        {t('exitImmersive')}
      </button>
      <div className={styles.record} data-playing={playbackState === 'playing'} aria-hidden="true">
        <span>HAEN</span>
      </div>
      <h1>{station?.name ?? t('tagline')}</h1>
      <p className={styles.location}>{location}</p>
      <p role="status" data-state={playbackState}>
        {status}
      </p>
      {station && (
        <button
          className={styles.favorite}
          aria-pressed={favorite}
          aria-label={t(favorite ? 'unfavoriteStation' : 'favoriteStation', { name: station.name })}
          onClick={onFavorite}
        >
          <Star size={20} fill={favorite ? 'currentColor' : 'none'} aria-hidden="true" />
          {t(favorite ? 'favorited' : 'favorite')}
        </button>
      )}
      {track && <div className={styles.trackSummary}>{track}</div>}
    </main>
  );
}
