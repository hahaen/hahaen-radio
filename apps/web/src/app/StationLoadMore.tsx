import { useEffect, useRef, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './StationLoadMore.module.css';

export function StationLoadMore({
  root,
  hasMore,
  busy,
  error,
  loaded,
  onLoad,
}: {
  root: RefObject<HTMLElement | null>;
  hasMore: boolean;
  busy: boolean;
  error: boolean;
  loaded: number;
  onLoad: () => void;
}) {
  const { t } = useTranslation();
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = sentinel.current;
    if (
      !element ||
      !root.current ||
      !hasMore ||
      busy ||
      error ||
      typeof IntersectionObserver === 'undefined'
    )
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoad();
      },
      { root: root.current, rootMargin: '0px 0px 180px 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [root, hasMore, busy, error, loaded, onLoad]);

  return (
    <div ref={sentinel} className={styles.footer} data-testid="station-load-more">
      {error && <p role="status">{t('loadMoreError')}</p>}
      <button
        type="button"
        aria-busy={busy}
        aria-disabled={busy || !hasMore || undefined}
        data-complete={!hasMore}
        onClick={() => {
          if (hasMore && !busy) onLoad();
        }}
      >
        {busy
          ? t('loadingMore')
          : error
            ? t('retryLoadMore')
            : hasMore
              ? t('loadMoreStations')
              : t('stationListEnd')}
      </button>
    </div>
  );
}
