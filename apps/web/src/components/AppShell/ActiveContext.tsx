"use client";

import Link from "next/link";
import { useLab } from "@/state/lab/LabSessionProvider";
import styles from "./AppShell.module.css";

/** Shows which analysis session and progression are active, on every page. */
export function ActiveContext() {
  const { activeSession, draft, run } = useLab();
  const running = run.status === "uploading" || run.status === "analyzing";
  const hasProgression = draft.progression.slots.length > 0;
  if (!activeSession && !hasProgression && !running) return null;
  return (
    <div className={styles.context} aria-label="Active work">
      {running ? (
        <Link href="/audio" className={styles.contextItem} data-busy="true">Analyzing {run.fileName}…</Link>
      ) : activeSession ? (
        <Link href="/audio" className={styles.contextItem} title="Active analysis session">
          <span className={styles.contextLabel}>Analysis</span> {activeSession.source.filename}
        </Link>
      ) : null}
      {hasProgression ? (
        <Link href="/progressions" className={styles.contextItem} title="Active progression">
          <span className={styles.contextLabel}>Progression</span> {draft.name}
          {draft.dirty ? <span className={styles.unsaved}> · unsaved</span> : null}
        </Link>
      ) : null}
    </div>
  );
}
