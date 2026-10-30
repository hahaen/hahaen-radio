import { useEffect, useId, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { buildVersion, fetchVersion, observeVersion, reloadVersion } from './version';
import styles from './version-update.module.css';

export function VersionUpdate() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    if (!buildVersion) return;
    const url = new URL(window.location.href);
    if (url.searchParams.has('_haen_update')) {
      url.searchParams.delete('_haen_update');
      window.history.replaceState(window.history.state, '', url);
    }
    return observeVersion(buildVersion, setVersion);
  }, []);
  return version ? <UpdateDialog /> : null;
}

function UpdateDialog() {
  const { t } = useTranslation();
  const heading = useId();
  const description = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const [state, setState] = useState<'ready' | 'updating' | 'error'>('ready');
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      request.current?.abort();
    };
  }, []);
  const update = async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setState('updating');
    try {
      const latest = await fetchVersion(controller.signal);
      if (!controller.signal.aborted) reloadVersion(latest);
    } catch {
      if (!controller.signal.aborted) setState('error');
    } finally {
      request.current = null;
    }
  };
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={heading}
      aria-describedby={description}
      aria-modal="true"
      onCancel={(event) => event.preventDefault()}
      onKeyDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className={styles.icon} aria-hidden="true">
        <RefreshCw size={24} />
      </div>
      <p className={styles.eyebrow}>{t('versionUpdate.ready')}</p>
      <h2 id={heading}>{t('versionUpdate.title')}</h2>
      <p id={description} className={styles.description}>
        {t('versionUpdate.description')}
      </p>
      <p className={styles.hint}>{t('versionUpdate.hint')}</p>
      {state === 'error' && (
        <p role="alert" className={styles.error}>
          {t('versionUpdate.error')}
        </p>
      )}
      <button
        className={styles.update}
        aria-disabled={state === 'updating'}
        aria-busy={state === 'updating'}
        onClick={() => void update()}
      >
        <RefreshCw size={17} aria-hidden="true" />
        {t(state === 'updating' ? 'versionUpdate.updating' : 'versionUpdate.action')}
      </button>
    </dialog>
  );
}
