import type { ReactNode } from "react";
import styles from "./ui.module.css";

interface PanelProps {
  title: string;
  titleId: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string | undefined;
}

/** A titled section card; `titleId` labels the region for assistive tech. */
export function Panel({ title, titleId, description, actions, children, className }: PanelProps) {
  return (
    <section aria-labelledby={titleId} className={`${styles.panel} ${className ?? ""}`}>
      <header className={styles.panelHeader}>
        <div>
          <h2 id={titleId} className={styles.panelTitle}>{title}</h2>
          {description ? <p className={styles.panelDescription}>{description}</p> : null}
        </div>
        {actions ? <div className={styles.panelActions}>{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}
