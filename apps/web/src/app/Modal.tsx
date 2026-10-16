import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import styles from '../library/library.module.css';

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { t } = useTranslation();
  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    return () => {
      element?.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={styles.modal}
      aria-labelledby="modal-heading"
      onCancel={onClose}
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
