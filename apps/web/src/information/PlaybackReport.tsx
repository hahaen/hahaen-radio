import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PlaybackReportResult } from '@haen/contracts';
import { sendPlaybackReport } from '../services/diagnostics';
import { HttpError } from '../services/http';
import { reportableFailure, type SupportContext } from './support-note';
import styles from './information.module.css';
export function PlaybackReport({ context }: { context: SupportContext }) {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<PlaybackReportResult | 'idle' | 'pending' | 'uncertain'>(
    'idle',
  );
  const request = useRef<AbortController | undefined>(undefined),
    reportId = useRef<string | undefined>(undefined),
    mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (typeof state === 'string' || state.status !== 'limited') return;
    const timer = setTimeout(() => setState('idle'), state.retryAfter * 1000);
    return () => clearTimeout(timer);
  }, [state]);
  const payload = reportableFailure(context);
  const uuidAvailable = typeof globalThis.crypto?.randomUUID === 'function';
  const submit = async () => {
    if (
      !payload ||
      !uuidAvailable ||
      request.current ||
      (typeof state === 'object' && (state.status === 'accepted' || state.status === 'limited'))
    )
      return;
    const abort = new AbortController();
    request.current = abort;
    setState('pending');
    try {
      reportId.current ??= crypto.randomUUID();
      const result = await sendPlaybackReport(
        payload.stationId,
        { reportId: reportId.current, streamId: payload.streamId, failure: payload.failure },
        abort.signal,
      );
      if (mounted.current && !abort.signal.aborted) setState(result);
    } catch (error) {
      if (mounted.current && !abort.signal.aborted)
        setState(
          error instanceof HttpError && [400, 404].includes(error.status)
            ? { status: 'unavailable', retryAfter: null }
            : 'uncertain',
        );
    } finally {
      if (request.current === abort) request.current = undefined;
    }
  };
  return (
    <section aria-labelledby="playback-report-heading" className={styles.report}>
      <h4 id="playback-report-heading">{t('diagnostics.title')}</h4>
      <p>{t('diagnostics.disclosure')}</p>
      {payload ? (
        <dl className={styles.reportDetails}>
          <div>
            <dt>{t('diagnostics.station')}</dt>
            <dd>{payload.stationId}</dd>
          </div>
          <div>
            <dt>{t('diagnostics.stream')}</dt>
            <dd>{payload.streamId}</dd>
          </div>
          <div>
            <dt>{t('diagnostics.failure')}</dt>
            <dd>{t('failure' + payload.failure[0]!.toUpperCase() + payload.failure.slice(1))}</dd>
          </div>
        </dl>
      ) : (
        <p className={styles.secondary}>{t('diagnostics.noFailure')}</p>
      )}
      {payload && !uuidAvailable && <p>{t('diagnostics.receiptUnavailable')}</p>}
      <button
        className={styles.copy}
        disabled={
          !payload ||
          state === 'pending' ||
          (typeof state === 'object' &&
            (state.status === 'accepted' || state.status === 'limited')) ||
          !uuidAvailable
        }
        onClick={() => void submit()}
      >
        {t(state === 'pending' ? 'diagnostics.sending' : 'diagnostics.send')}
      </button>
      <div aria-live="polite">
        {state === 'uncertain' && <p>{t('diagnostics.uncertain')}</p>}
        {typeof state === 'object' && state.status === 'unavailable' && (
          <p>{t('diagnostics.unavailable')}</p>
        )}
        {typeof state === 'object' && state.status === 'limited' && (
          <p>{t('diagnostics.limited', { seconds: state.retryAfter })}</p>
        )}
        {typeof state === 'object' && state.status === 'accepted' && (
          <>
            <p>{t('diagnostics.accepted')}</p>
            <p className={styles.secondary}>
              {t('diagnostics.receipt', {
                id: state.reportId,
                date: new Intl.DateTimeFormat(i18n.language === 'en' ? 'en-GB' : 'zh-CN', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }).format(new Date(state.expiresAt)),
              })}
            </p>
          </>
        )}
      </div>
    </section>
  );
}
