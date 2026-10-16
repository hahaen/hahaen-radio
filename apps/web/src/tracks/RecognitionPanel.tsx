import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useStore } from 'zustand';
import { useTranslation } from 'react-i18next';
import { AudioLines, Star } from 'lucide-react';
import type { RecognitionResult } from '@haen/contracts';
import type { Library } from '../library/store';
import { songKey } from '../library/model';
import { getCapabilities, recognizeStation } from '../services/recognition';
import { SongLinks } from './SongLinks';
import { LyricsView } from './LyricsView';
import styles from './tracks.module.css';
export function RecognitionPanel({
  stationId,
  streamId,
  active,
  library,
}: {
  stationId?: string | undefined;
  streamId?: string | undefined;
  active: boolean;
  library: Library;
}) {
  const { t, i18n } = useTranslation();
  const capabilities = useQuery({
    queryKey: ['capabilities'],
    queryFn: ({ signal }) => getCapabilities(signal),
    retry: 0,
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });
  const songs = useStore(library.store, (state) => state.songs);
  const [result, setResult] = useState<RecognitionResult>(),
    [pending, setPending] = useState(false),
    [failed, setFailed] = useState(false),
    [capacity, setCapacity] = useState(false),
    [until, setUntil] = useState(0),
    [clock, setClock] = useState(0);
  const request = useRef<AbortController | undefined>(undefined),
    mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!active) request.current?.abort();
  }, [active]);
  useEffect(() => {
    if (!until) return;
    const timer = setInterval(() => {
      const current = Date.now();
      setClock(current);
      if (current >= until) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [until]);
  const remaining = Math.max(0, Math.ceil((until - clock) / 1000));
  const capability = capabilities.data?.recognition;
  const terminal =
    (result?.status === 'unavailable' && result.retryAfter === null) ||
    result?.status === 'quota-exhausted';
  const identify = async () => {
    if (
      !active ||
      !stationId ||
      !streamId ||
      request.current ||
      remaining ||
      capability !== 'available' ||
      capabilities.isError ||
      terminal
    )
      return;
    const abort = new AbortController();
    request.current = abort;
    setPending(true);
    setFailed(false);
    setResult(undefined);
    setCapacity(false);
    try {
      const value = await recognizeStation(stationId, streamId, abort.signal);
      if (!mounted.current || abort.signal.aborted) return;
      setResult(value);
      const current = Date.now();
      setClock(current);
      setUntil(value.retryAfter ? current + value.retryAfter * 1000 : 0);
    } catch {
      if (mounted.current && !abort.signal.aborted) {
        setFailed(true);
        const current = Date.now();
        setClock(current);
        setUntil(current + 10000);
      }
    } finally {
      if (request.current === abort) request.current = undefined;
      if (mounted.current) setPending(false);
    }
  };
  const song = result?.status === 'found' ? result.song : null;
  const favorite = !!song && songs.some((value) => songKey(value) === songKey(song));
  return (
    <section className={styles.recognition} aria-label={t('recognitionTitle')}>
      <h3>{t('recognitionTitle')}</h3>
      <p className={styles.hint}>{t('recognitionConsent')}</p>
      <button
        className={styles.actionButton}
        disabled={
          !active ||
          !stationId ||
          !streamId ||
          pending ||
          remaining > 0 ||
          capability !== 'available' ||
          capabilities.isError ||
          terminal
        }
        onClick={() => {
          void identify();
        }}
      >
        <AudioLines size={18} aria-hidden="true" />
        {t(pending ? 'recognitionWorking' : 'recognitionStart')}
      </button>
      <div aria-live="polite">
        {!active && <p>{t('recognitionInactive')}</p>}
        {capabilities.isPending ? (
          <p>{t('recognitionChecking')}</p>
        ) : capabilities.isError || capability === 'unavailable' ? (
          <p>{t('recognitionState.unavailable')}</p>
        ) : capability === 'disabled' ? (
          <p>{t('recognitionDisabled')}</p>
        ) : capability === 'quota-exhausted' ? (
          <p>{t('recognitionState.quota-exhausted')}</p>
        ) : null}
        {pending && <p>{t('recognitionWorking')}</p>}
        {failed && <p>{t('recognitionState.error')}</p>}
        {result && <p>{t('recognitionState.' + result.status)}</p>}
        {remaining > 0 && <p>{t('recognitionRetryAfter', { seconds: remaining })}</p>}
      </div>
      {song && result?.status === 'found' && (
        <div>
          <h4>{song.title}</h4>
          <p>{song.artist}</p>
          <p className={styles.observation}>
            {t('recognitionObserved', {
              time: new Intl.DateTimeFormat(i18n.language === 'en' ? 'en-GB' : 'zh-CN', {
                timeStyle: 'medium',
              }).format(new Date(result.observedAt)),
            })}
          </p>
          <p className={styles.hint}>{t('recognitionTimingUnknown')}</p>
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
            <Star size={18} aria-hidden="true" fill={favorite ? 'currentColor' : 'none'} />
            {t(favorite ? 'unfavoriteSong' : 'favoriteSong')}
          </button>
          {capacity && <p role="alert">{t('libraryCapacity')}</p>}
          <SongLinks song={song} />
          <LyricsView key={result.observedAt + ':' + songKey(song)} song={song} playing={active} />
        </div>
      )}
    </section>
  );
}
