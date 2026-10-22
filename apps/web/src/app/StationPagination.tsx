import { useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import styles from './StationPagination.module.css';

type PageItem = number | 'before' | 'after';

function pageItems(current: number, total: number, slots: number): PageItem[] {
  if (total <= slots) return Array.from({ length: total }, (_, index) => index + 1);
  // The narrowest panels retain three adjacent pages and both navigation controls.
  if (slots === 3) {
    const start = Math.max(1, Math.min(current - 1, total - 2));
    return [start, start + 1, start + 2];
  }
  if (current <= slots - 2) {
    return [...Array.from({ length: slots - 2 }, (_, index) => index + 1), 'after', total];
  }
  if (current >= total - slots + 3) {
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
      setSlots(width >= 404 ? 7 : width >= 308 ? 5 : 3);
    };
    resize();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <nav ref={ref} className={styles.pagination} aria-label={t('stationPagination')}>
      <button
        type="button"
        aria-label={t('earlier')}
        disabled={page === 1 || busy}
        onClick={() => onChange(page - 1)}
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
            disabled={busy}
            onClick={() => {
              if (item !== page) onChange(item);
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
        disabled={page === totalPages || busy}
        onClick={() => onChange(page + 1)}
      >
        <ChevronRight size={17} aria-hidden="true" />
      </button>
    </nav>
  );
}
