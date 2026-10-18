import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import styles from '../library/library.module.css';

export function Modal({
  title,
  children,
  onClose,
  initialFocus,
}: {
  title: string;
  children: ReactNode;
  onClose(): void;
  initialFocus?: string;
}) {
  const headingId = useId();
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  const dialog = useRef<HTMLDialogElement>(null);
  const { t } = useTranslation();
  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.show();
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !element?.contains(event.target) &&
        !opener?.contains(event.target)
      )
        closeRef.current();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault();
        closeRef.current();
      } else if (event.key === 'Tab' && element?.contains(document.activeElement)) {
        const controls = [
          ...element.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])',
          ),
        ].filter((control) => control.tabIndex >= 0 && control.getClientRects().length > 0);
        const first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    const firstControl = element?.querySelector<HTMLElement>(initialFocus ?? 'button');
    firstControl?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
      element?.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [initialFocus]);
  return (
    <dialog ref={dialog} className={styles.modal} aria-labelledby={headingId} onCancel={onClose}>
      <div className={styles.modalHeading}>
        <h2 id={headingId}>{title}</h2>
        <button onClick={onClose} aria-label={t('closePanel')}>
          <X size={22} aria-hidden="true" />
        </button>
      </div>
      <div className={styles.modalBody}>{children}</div>
    </dialog>
  );
}
