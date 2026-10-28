import type { ReactNode } from "react";
import styles from "./AppShell.module.css";

/** Page title + one-line purpose; every workspace starts with one so hierarchy stays consistent. */
export function PageIntro({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className={styles.intro}>
      <div>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.lede}>{children}</p>
      </div>
      {actions ? <div className={styles.introActions}>{actions}</div> : null}
    </div>
  );
}
