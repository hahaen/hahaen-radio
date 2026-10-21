import { applicationPath } from '../platform/paths';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy } from 'lucide-react';
import { Modal } from '../app/Modal';
import { supportNote, type SupportContext } from './support-note';
import { PlaybackReport } from './PlaybackReport';
import styles from './information.module.css';

const topics = ['about', 'privacy', 'credits', 'help', 'feedback'] as const;
type Topic = (typeof topics)[number];
function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}
function Feedback({ context }: { context: SupportContext }) {
  const { t, i18n } = useTranslation();
  const [note] = useState(
    () => t('information.feedbackTemplate') + '\n' + supportNote(context, i18n.language),
  );
  const [state, setState] = useState<'idle' | 'copying' | 'copied' | 'manual'>('idle');
  const copy = async () => {
    setState('copying');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('CLIPBOARD_UNAVAILABLE');
      await navigator.clipboard.writeText(note);
      setState('copied');
    } catch {
      setState('manual');
    }
  };
  return (
    <>
      <p>{t('information.feedbackIntro')}</p>
      <p>{t('information.feedbackContact')}</p>
      <p className={styles.secondary}>{t('information.feedbackNotice')}</p>
      <label className={styles.preview}>
        {t('information.feedbackPreview')}
        <textarea
          readOnly
          value={note}
          rows={15}
          spellCheck={false}
          onFocus={(event) => event.currentTarget.select()}
        />
      </label>
      <button className={styles.copy} onClick={() => void copy()} disabled={state === 'copying'}>
        <Copy size={18} aria-hidden="true" />
        {t(state === 'copying' ? 'information.feedbackCopying' : 'information.feedbackCopy')}
      </button>
      <p role="status">
        {state === 'copied'
          ? t('information.feedbackCopied')
          : state === 'manual'
            ? t('information.feedbackManual')
            : ''}
      </p>
      <PlaybackReport
        key={[context.stationId, context.streamId, context.status, context.failure].join(':')}
        context={context}
      />
    </>
  );
}
function Credits() {
  const { t } = useTranslation();
  return (
    <>
      <p>{t('information.creditsIntro')}</p>
      <ul className={styles.credits}>
        {(
          [
            ['Radio Browser', 'creditsRadio', 'https://api.radio-browser.info/'],
            ['GeoNames', 'creditsGeo', 'https://www.geonames.org/'],
            [
              'Natural Earth',
              'creditsEarth',
              'https://www.naturalearthdata.com/about/terms-of-use/',
            ],
          ] as const
        ).map(([name, description, url]) => (
          <li key={name}>
            <h4>
              <Link href={url}>{name}</Link>
            </h4>
            <p>{t('information.' + description)}</p>
            {name === 'GeoNames' && (
              <Link href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</Link>
            )}
          </li>
        ))}
        <li>
          <h4>Noto / IBM Plex</h4>
          <p>{t('information.creditsFonts')}</p>
          <div className={styles.links}>
            <Link href={applicationPath('fonts/noto-serif-sc-ui-LICENSE.txt')}>
              {t('information.creditsNotoSerif')}
            </Link>
            <Link href={applicationPath('fonts/noto-sans-sc-ui-LICENSE.txt')}>
              {t('information.creditsNotoSans')}
            </Link>
            <Link href={applicationPath('fonts/ibm-plex-mono-ui-LICENSE.txt')}>
              {t('information.creditsPlex')}
            </Link>
          </div>
        </li>
        <li>
          <h4>Lucide</h4>
          <p>{t('information.creditsIcons')}</p>
          <Link href={applicationPath('licenses/lucide.txt')}>
            {t('information.creditsLucide')}
          </Link>
        </li>
      </ul>
    </>
  );
}
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
          ['G', 'keyView'],
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
export function InformationPanel({
  context,
  onClose,
}: {
  context: SupportContext;
  onClose(): void;
}) {
  const { t, i18n } = useTranslation();
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
        {topic === 'credits' && <Credits />}
        {topic === 'help' && <Help />}
        {topic === 'feedback' && <Feedback key={i18n.language} context={context} />}
      </section>
    </Modal>
  );
}
