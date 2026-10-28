import Link from "next/link";
import { ActiveContext } from "./ActiveContext";
import { NavLinks } from "./NavLinks";
import styles from "./AppShell.module.css";

export function AppHeader() {
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link href="/" className={styles.brand}>
          <span className={styles.logo} aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path d="M4 6h16M4 10h16M4 14h16M4 18h16" stroke="currentColor" strokeWidth="1.6" />
              <circle cx="9" cy="12" r="2.6" fill="currentColor" />
              <circle cx="15" cy="16" r="2.6" fill="currentColor" />
            </svg>
          </span>
          <span className={styles.brandText}>Guitar Theory Lab</span>
        </Link>
        <NavLinks />
        <ActiveContext />
      </div>
    </header>
  );
}
