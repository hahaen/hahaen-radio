import { useEffect, useRef, type ReactNode } from 'react';
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
  const dialog = useRef<HTMLDialogElement>(null);
  const { t } = useTranslation();
  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    if (initialFocus) element?.querySelector<HTMLElement>(initialFocus)?.focus();
    return () => {
      element?.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [initialFocus]);
  return (
    <dialog
      ref={dialog}
      className={styles.modal}
      aria-labelledby="modal-heading"
      onCancel={onClose}
      onKeyDown={(event) => {
        if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
        const root = event.currentTarget;
        const controls = [
          ...root.querySelectorAll<HTMLElement>(
            'button,a[href],input,select,textarea,[tabindex],[contenteditable="true"]',
          ),
        ].filter(
          (element) =>
            element.tabIndex >= 0 &&
            !element.matches(':disabled') &&
            !element.closest('[inert]') &&
            element.getClientRects().length > 0 &&
            getComputedStyle(element).visibility !== 'hidden',
        );
        if (controls.length) {
          event.preventDefault();
          const index = controls.indexOf(document.activeElement as HTMLElement);
          const next =
            index < 0
              ? event.shiftKey
                ? controls.length - 1
                : 0
              : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
          controls[next]?.focus();
        }
      }}
    >
      <header className={styles.modalHeading}>
        <h2 id="modal-heading">{title}</h2>
        <button onClick={onClose} aria-label={t('closePanel')}>
          <X size={22} aria-hidden="true" />
        </button>
      </header>
      {children}
    </dialog>
  );
}
