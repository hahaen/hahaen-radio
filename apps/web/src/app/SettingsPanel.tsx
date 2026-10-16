import { useStore } from 'zustand';
import { useTranslation } from 'react-i18next';
import type { CatalogManifest } from '@haen/contracts';
import type { PlayerController } from '../audio/controller';
import type { Library } from '../library/store';
import { LanguageChoices } from '../library/LanguageChoices';
import { formatRemaining } from '../platform/sleep';
import { Modal } from './Modal';
import styles from './controls.module.css';
export function SettingsPanel({
  library,
  player,
  manifest,
  sleep,
  languageFailed,
  onLanguage,
  onLanguages,
  onClose,
}: {
  library: Library;
  player: PlayerController;
  manifest: CatalogManifest | undefined;
  sleep: { active: boolean; remaining: number; expired: boolean };
  languageFailed: boolean;
  onLanguage(language: 'zh' | 'en'): void;
  onLanguages(languages: string[] | null): void;
  onClose(): void;
}) {
  const { t, i18n } = useTranslation(),
    state = useStore(library.store),
    playback = useStore(player.store, (value) => value.playback);
  return (
    <Modal title={t('listeningSettings')} onClose={onClose}>
      <div className={styles.settings}>
        {(state.storageProblem || languageFailed) && (
          <p className={styles.warning}>
            {t('storage.' + (state.storageProblem ?? 'unavailable'))}
          </p>
        )}
        <label className={styles.settingRow}>
          {t('language')}
          <select
            value={i18n.language}
            onChange={(event) => onLanguage(event.target.value as 'zh' | 'en')}
          >
            <option value="zh">简体中文</option>
            <option value="en">English</option>
          </select>
        </label>
        <LanguageChoices
          value={state.filters.languages}
          manifest={manifest}
          onChange={onLanguages}
        />
        <section aria-label={t('playbackPreferences')}>
          <h3>{t('playbackPreferences')}</h3>
          {playback.volumeControllable ? (
            <label className={styles.settingRow}>
              {t('volume')}
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={playback.volume}
                onChange={(event) => player.setVolume(Number(event.target.value))}
              />
            </label>
          ) : (
            <p>{t('systemVolume')}</p>
          )}
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={playback.muted}
              onChange={(event) => player.setMuted(event.target.checked)}
            />
            {t('mute')}
          </label>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={state.preferences.showHints}
              onChange={(event) => library.setPreferences({ showHints: event.target.checked })}
            />
            {t('showHints')}
          </label>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={state.preferences.idleImmersive}
              onChange={(event) => library.setPreferences({ idleImmersive: event.target.checked })}
            />
            {t('idleImmersive')}
          </label>
        </section>
        <section aria-label={t('sleepTimer')}>
          <h3>{t('sleepTimer')}</h3>
          <div className={styles.timerChoices} role="group" aria-label={t('sleepDuration')}>
            {([0, 15, 30, 60] as const).map((minutes) => (
              <button
                key={minutes}
                aria-pressed={
                  minutes === 0 ? !sleep.active : sleep.active && state.sleep?.minutes === minutes
                }
                onClick={() => library.setSleep(minutes)}
              >
                {t(minutes ? 'sleepMinutes' : 'sleepOff', { minutes })}
              </button>
            ))}
          </div>
          <p className={styles.timerText}>
            {sleep.active
              ? t('sleepRemaining', { time: formatRemaining(sleep.remaining) })
              : t(sleep.expired ? 'sleepExpired' : 'sleepInactive')}
          </p>
          <p>{t('sleepBackgroundHint')}</p>
        </section>
        <section aria-label={t('keyboardHelp')}>
          <h3>{t('keyboardHelp')}</h3>
          <dl className={styles.shortcuts}>
            {(
              [
                ['Space', 'keyPlayback'],
                ['← ↑ / → ↓', 'keyStations'],
                ['G', 'keyView'],
                ['/', 'keySearch'],
                ['F', 'keyFavorite'],
                ['L', 'keyPin'],
                ['M', 'keyMute'],
                ['Enter / Esc', 'keyImmersive'],
              ] as const
            ).map(([key, label]) => (
              <div key={key}>
                <dt>
                  <kbd>{key === 'Space' ? t('spaceKey') : key}</kbd>
                </dt>
                <dd>{t(label)}</dd>
              </div>
            ))}
          </dl>
          <p>{t('keyboardScope')}</p>
        </section>
      </div>
    </Modal>
  );
}
