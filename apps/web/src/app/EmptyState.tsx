import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import styles from './empty-state.module.css';

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={styles.empty}>
      <span className={styles.symbol} aria-hidden="true">
        <Icon size={24} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
