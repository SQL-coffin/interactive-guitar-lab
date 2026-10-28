import type { ReactNode } from "react";
import styles from "./ui.module.css";

export function LoadingState({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={styles.status}>
      <span className={styles.spinner} aria-hidden="true" />
      <span>{label}</span>
      {children}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div role="status" className={`${styles.status} ${styles.empty}`}>
      <p className={styles.statusTitle}>{title}</p>
      {children ? <div className={styles.statusBody}>{children}</div> : null}
    </div>
  );
}

export function ErrorState({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className={`${styles.status} ${styles.error}`}>
      <p className={styles.statusTitle}>{title}</p>
      <p className={styles.statusBody}>{message}</p>
      {onRetry ? (
        <button type="button" className={styles.button} onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}
