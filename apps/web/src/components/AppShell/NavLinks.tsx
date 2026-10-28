"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./AppShell.module.css";

export const NAV_ITEMS = [
  { href: "/", label: "Chord explorer", short: "Explorer" },
  { href: "/progressions", label: "Progressions", short: "Progressions" },
  { href: "/audio", label: "Audio analysis", short: "Audio" },
] as const;

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav aria-label="Workspaces" className={styles.nav}>
      <ul>
        {NAV_ITEMS.map((item) => {
          const current = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link href={item.href} aria-current={current ? "page" : undefined} className={styles.navLink}>
                <span className={styles.navFull}>{item.label}</span>
                <span className={styles.navShort} aria-hidden="true">{item.short}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
