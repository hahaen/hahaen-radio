import type { Genre } from '@haen/contracts';
import type { SceneOptions } from '../library/model';
import styles from './controls.module.css';
export function ListeningArt({
  effect,
  genre,
  playing,
  powerSave,
}: {
  effect: SceneOptions['immersion'];
  genre?: Genre | undefined;
  playing: boolean;
  powerSave: boolean;
}) {
  const mode =
    effect === 'auto'
      ? genre === 'electronic' || genre === 'world'
        ? 'orb'
        : genre === 'classical' || genre === 'folk'
          ? 'landscape'
          : 'record'
      : effect;
  return (
    <div
      className={styles.artwork}
      data-effect={mode}
      data-playing={playing}
      data-still={powerSave}
      aria-hidden="true"
    >
      {mode === 'record' ? (
        <div className={styles.record}>
          <span>HAEN</span>
        </div>
      ) : mode === 'orb' ? (
        <div className={styles.orb}>
          <i />
          <i />
          <i />
        </div>
      ) : (
        <svg viewBox="0 0 420 300" className={styles.landscape}>
          {Array.from({ length: 18 }, (_, index) => (
            <path
              key={index}
              d={`M 0 ${260 - index * 5} Q 65 ${210 - index * 7} 115 ${150 - index * 3} T 215 ${200 - index * 4} Q 260 ${90 - index * 3} 300 ${140 - index * 3} T 420 ${220 - index * 4}`}
            />
          ))}
        </svg>
      )}
    </div>
  );
}
