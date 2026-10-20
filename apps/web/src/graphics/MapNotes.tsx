import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Info, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import styles from './exploration.module.css';

export function MapNotes({
  preview,
  attention = false,
  children,
}: {
  preview?: ReactNode;
  attention?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const expanded = attention || open;
  const close = () => {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return (
    <div
      ref={root}
      className={styles.mapNotes}
      data-expanded={expanded}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !attention) {
          event.stopPropagation();
          close();
        }
      }}
    >
      <div className={styles.mapSummary}>
        {preview}
        <button
          ref={trigger}
          className={styles.mapToggle}
          aria-label={t('mapInformation')}
          title={t('mapInformation')}
          aria-controls={id}
          aria-expanded={expanded}
          disabled={attention}
          onClick={() => setOpen(!open)}
        >
          <Info size={18} aria-hidden="true" />
        </button>
      </div>
      <section
        id={id}
        className={styles.mapDetailBody}
        aria-label={t('mapInformation')}
        hidden={!expanded}
      >
        {!attention && (
          <button className={styles.mapClose} aria-label={t('closePanel')} onClick={close}>
            <X size={16} aria-hidden="true" />
          </button>
        )}
        {children}
      </section>
    </div>
  );
}
