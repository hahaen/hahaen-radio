import { useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import styles from './StationPagination.module.css';

type PageItem = number | 'before' | 'after';

function pageItems(current: number, total: number, slots: number): PageItem[] {
  if (total <= slots) return Array.from({ length: total }, (_, index) => index + 1);
  // Compact panels prioritize adjacent pages so the next page stays directly reachable.
  if (slots <= 5) {
    const start = Math.max(1, Math.min(current - Math.floor(slots / 2), total - slots + 1));
    return Array.from({ length: slots }, (_, index) => start + index);
  }
  if (current <= slots - 3) {
    return [...Array.from({ length: slots - 2 }, (_, index) => index + 1), 'after', total];
  }
  if (current >= total - slots + 4) {
    return [
      1,
      'before',
      ...Array.from({ length: slots - 2 }, (_, index) => total - slots + 3 + index),
    ];
  }
  const radius = (slots - 5) / 2;
  return [
    1,
    'before',
    ...Array.from({ length: slots - 4 }, (_, index) => current - radius + index),
    'after',
    total,
  ];
}

export function StationPagination({
  page,
  totalPages,
  busy,
  onChange,
}: {
  page: number;
  totalPages: number;
  busy: boolean;
  onChange: (page: number) => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLElement>(null);
  const [slots, setSlots] = useState(3);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const resize = () => {
      const width = element.clientWidth;
      // Seven numeric pages need more room than a range containing an ellipsis.
      const wideWidth = totalPages === 7 ? 428 : 404;
      setSlots(width >= wideWidth ? 7 : width >= 332 ? 5 : 3);
    };
    resize();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [totalPages]);

  return (
    <nav
      ref={ref}
      className={styles.pagination}
      aria-label={t('stationPagination')}
      aria-busy={busy}
    >
      <button
        type="button"
        aria-label={t('earlier')}
        disabled={page === 1}
        aria-disabled={busy || undefined}
        onClick={() => {
          if (!busy) onChange(page - 1);
        }}
      >
        <ChevronLeft size={17} aria-hidden="true" />
      </button>
      {pageItems(page, totalPages, slots).map((item) =>
        typeof item === 'number' ? (
          <button
            type="button"
            key={item}
            aria-label={t('pageNumber', { page: item })}
            aria-current={item === page ? 'page' : undefined}
            aria-disabled={busy || undefined}
            onClick={() => {
              if (!busy && item !== page) onChange(item);
            }}
          >
            {item}
          </button>
        ) : (
          <span key={item} className={styles.ellipsis} aria-hidden="true">
            …
          </span>
        ),
      )}
      <button
        type="button"
        aria-label={t('later')}
        disabled={page === totalPages}
        aria-disabled={busy || undefined}
        onClick={() => {
          if (!busy) onChange(page + 1);
        }}
      >
        <ChevronRight size={17} aria-hidden="true" />
      </button>
    </nav>
  );
}
