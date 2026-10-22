import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../app/Modal';
import styles from './information.module.css';

const topics = ['about', 'privacy', 'help'] as const;
type Topic = (typeof topics)[number];
function Help() {
  const { t } = useTranslation();
  return (
    <>
      <h4>{t('information.helpStartTitle')}</h4>
      <p>{t('information.helpStart')}</p>
      <p>{t('information.helpScope')}</p>
      <p>{t('information.helpPin')}</p>
      <h4>{t('information.helpAudioTitle')}</h4>
      <p>{t('information.helpAudio')}</p>
      <p>{t('information.helpExtras')}</p>
      <h4>{t('information.helpDataTitle')}</h4>
      <p>{t('information.helpData')}</p>
      <h4>{t('information.helpKeysTitle')}</h4>
      <p>{t('information.helpKeysHint')}</p>
      <dl className={styles.shortcuts}>
        {[
          ['Space', 'keyPlay'],
          ['← / ↑ · → / ↓', 'keyStations'],
          ['/', 'keySearch'],
          ['F', 'keyFavorite'],
          ['L', 'keyPin'],
          ['M', 'keyMute'],
          ['Enter', 'keyEnter'],
          ['Esc', 'keyEscape'],
        ].map(([key, description]) => (
          <div key={key}>
            <dt>
              <kbd>{key}</kbd>
            </dt>
            <dd>{t('information.' + description)}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
export function InformationPanel({ onClose }: { onClose(): void }) {
  const { t } = useTranslation();
  const [topic, setTopic] = useState<Topic>('about');
  return (
    <Modal title={t('informationTitle')} onClose={onClose}>
      <nav className={styles.topics} aria-label={t('informationTopics')}>
        {topics.map((value) => (
          <button
            key={value}
            aria-pressed={topic === value}
            aria-controls="information-content"
            onClick={() => setTopic(value)}
          >
            {t('information.' + value)}
          </button>
        ))}
      </nav>
      <section
        id="information-content"
        className={styles.content}
        aria-labelledby="information-topic"
      >
        <h3 id="information-topic">{t('information.' + topic)}</h3>
        {topic === 'about' && (
          <>
            <p className={styles.intro}>{t('information.aboutIntro')}</p>
            <p>{t('information.aboutBody')}</p>
            <p>{t('information.aboutLive')}</p>
            <p>{t('information.aboutLocal')}</p>
          </>
        )}
        {topic === 'privacy' && (
          <>
            <h4>{t('information.privacyLocalTitle')}</h4>
            <p>{t('information.privacyLocal')}</p>
            <p>{t('information.privacyClear')}</p>
            <h4>{t('information.privacyRequestsTitle')}</h4>
            <p>{t('information.privacyRequests')}</p>
            <p>{t('information.privacySongs')}</p>
            <h4>{t('information.privacyOperationsTitle')}</h4>
            <p>{t('information.privacyOperations')}</p>
          </>
        )}
        {topic === 'help' && <Help />}
      </section>
    </Modal>
  );
}
