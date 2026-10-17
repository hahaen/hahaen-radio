import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { LyricsRecord, SongIdentity } from '@haen/contracts';
import { getLyrics } from '../services/tracks';
import { activeLyric, lyricTime } from './lyrics-clock';
import styles from './tracks.module.css';
function TimedLyrics({ record, playing }: { record: LyricsRecord; playing: boolean }) {
  const { t } = useTranslation();
  const [calibrated, setCalibrated] = useState(false),
    [position, setPosition] = useState(0),
    [offset, setOffset] = useState(0),
    [follow, setFollow] = useState(true);
  const clock = useRef({ position: 0, at: 0 });
  const running = useRef(false);
  const read = useCallback(
    () =>
      clock.current.position +
      (running.current ? (performance.now() - clock.current.at) / 1000 : 0),
    [],
  );
  useEffect(() => {
    const current = read();
    clock.current = { position: current, at: performance.now() };
    running.current = playing && calibrated;
    if (!running.current) return;
    const timer = setInterval(() => setPosition(read()), 250);
    return () => {
      const position = read();
      clock.current = { position, at: performance.now() };
      running.current = false;
      clearInterval(timer);
    };
  }, [playing, calibrated, read]);
  const calibrate = (seconds: number) => {
    clock.current = { position: seconds, at: performance.now() };
    setPosition(seconds);
    setOffset(0);
    setCalibrated(true);
    setFollow(true);
  };
  const current = calibrated ? activeLyric(record.lines, Math.max(0, position + offset)) : -1;
  const viewport = useRef<HTMLDivElement>(null),
    selected = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const host = viewport.current,
      line = selected.current;
    if (!follow || current < 0 || !host || !line) return;
    const bounds = host.getBoundingClientRect(),
      row = line.getBoundingClientRect();
    host.scrollTop += row.top - bounds.top - host.clientHeight / 2 + row.height / 2;
  }, [current, follow]);
  return (
    <div>
      <p>{t('lyricsTimingUnknown')}</p>
      <div className={styles.actions}>
        <button onClick={() => calibrate(0)}>{t('calibrateStart')}</button>
        {calibrated && (
          <>
            <button onClick={() => setOffset((value) => Math.max(-30, value - 0.5))}>
              {t('lyricsEarlier')}
            </button>
            <button onClick={() => setOffset((value) => Math.min(30, value + 0.5))}>
              {t('lyricsLater')}
            </button>
            <button aria-pressed={follow} onClick={() => setFollow((value) => !value)}>
              {t(follow ? 'pauseFollow' : 'resumeFollow')}
            </button>
          </>
        )}
      </div>
      {calibrated && (
        <p className={styles.clock}>
          {t('manualLyricClock', { time: lyricTime(position + offset), offset: offset.toFixed(1) })}
        </p>
      )}
      <p className={styles.hint}>{t('clickLyricToCalibrate')}</p>
      <div
        ref={viewport}
        className={styles.lyricsScroll}
        role="region"
        tabIndex={0}
        aria-label={t('timedLyrics')}
        onWheel={() => setFollow(false)}
        onTouchStart={() => setFollow(false)}
        onKeyDown={(event) => {
          if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key))
            setFollow(false);
        }}
      >
        {record.lines.map((line, index) => (
          <button
            key={index}
            ref={index === current ? selected : undefined}
            aria-current={index === current ? 'true' : undefined}
            onClick={() => calibrate(line.at)}
          >
            <time>{lyricTime(line.at)}</time>
            <span>{line.text || '♪'}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
export function LyricsView({ song, playing }: { song: SongIdentity; playing: boolean }) {
  const { t } = useTranslation();
  const [requested, setRequested] = useState(false),
    [selected, setSelected] = useState<number | null>(null);
  const query = useQuery({
    queryKey: ['lyrics', song.artist, song.title],
    queryFn: ({ signal }) => getLyrics(song, signal),
    enabled: requested,
    staleTime: 600000,
    gcTime: 600000,
    retry: 0,
    refetchOnWindowFocus: false,
  });
  const items = query.data?.items ?? [],
    record =
      items.find((item) => item.id === selected) ?? (items.length === 1 ? items[0] : undefined);
  return (
    <section className={styles.lyrics} aria-labelledby="lyrics-title">
      <h3 id="lyrics-title">{t('lyrics')}</h3>
      <p className={styles.hint}>
        {t('lyricsProvider')}{' '}
        <a href="https://lrclib.net/" target="_blank" rel="noopener noreferrer">
          LRCLIB
        </a>
      </p>
      {requested && query.data?.status === 'found' && !query.isFetching && (
        <button
          className={styles.actionButton}
          onClick={() => {
            void query.refetch();
          }}
        >
          {t('refreshLyrics')}
        </button>
      )}
      {!requested ? (
        <button className={styles.actionButton} onClick={() => setRequested(true)}>
          {t('findLyrics')}
        </button>
      ) : query.isPending || query.isFetching ? (
        <p>{t('lyricsLoading')}</p>
      ) : query.isError || !query.data ? (
        <>
          <p>{t('lyricsUnavailable')}</p>
          <button
            className={styles.actionButton}
            onClick={() => {
              void query.refetch();
            }}
          >
            {t('retry')}
          </button>
        </>
      ) : query.data.status !== 'found' ? (
        <>
          <p>{t('lyricsResult.' + query.data.status, { seconds: query.data.retryAfter ?? 0 })}</p>
          <button
            className={styles.actionButton}
            onClick={() => {
              void query.refetch();
            }}
          >
            {t('retry')}
          </button>
        </>
      ) : (
        <>
          {items.length > 1 && (
            <label className={styles.version}>
              {t('lyricsVersion')}
              <select
                value={selected ?? ''}
                onChange={(event) => setSelected(Number(event.target.value))}
              >
                <option value="" disabled>
                  {t('chooseLyricsVersion')}
                </option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.album || t('unknownAlbum')} · {lyricTime(item.duration)} · #{item.id}
                  </option>
                ))}
              </select>
            </label>
          )}
          {record &&
            (record.instrumental ? (
              <p>{t('instrumental')}</p>
            ) : record.lines.length ? (
              <TimedLyrics key={record.id} record={record} playing={playing} />
            ) : (
              <p className={styles.plainLyrics}>{record.plain}</p>
            ))}
        </>
      )}
    </section>
  );
}
