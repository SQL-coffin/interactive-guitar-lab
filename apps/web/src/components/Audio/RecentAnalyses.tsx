"use client";

import { formatSeconds } from "@/lib/audioTimeline";
import { useLab } from "@/state/lab/LabSessionProvider";
import { Button } from "@/components/ui/Button";
import styles from "./Audio.module.css";

const SHOWN = 8;

/** Completed analyses saved in this browser; opening one never re-runs the analysis. */
export function RecentAnalyses() {
  const { sessions, activeSession, openSession, deleteSession, storage } = useLab();
  if (!storage.ready) return <p className={styles.caveat} role="status">Loading saved analyses…</p>;
  if (sessions.length === 0) return null;
  return (
    <section className={styles.recent} aria-labelledby="recent-title">
      <h2 id="recent-title" className={styles.recentTitle}>Recent analyses</h2>
      <ul className={styles.recentList}>
        {sessions.slice(0, SHOWN).map((summary) => {
          const active = summary.id === activeSession?.id;
          return (
            <li key={summary.id} data-active={active}>
              <div className={styles.recentMain}>
                <span className={styles.recentName}>{summary.filename}</span>
                <span className={styles.recentMeta}>
                  {new Date(summary.createdAt).toLocaleString()} · {formatSeconds(summary.durationSeconds)} · {summary.windowCount} windows
                  {summary.tempoBpm === null ? "" : ` · ≈ ${summary.tempoBpm.toFixed(0)} BPM`}
                </span>
              </div>
              {active ? (
                <span className={styles.activeBadge}>Active</span>
              ) : (
                <Button size="sm" onClick={() => void openSession(summary.id)} aria-label={`Open analysis of ${summary.filename}`}>Open</Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Delete analysis of ${summary.filename}`}
                onClick={() => {
                  if (window.confirm(`Delete the saved analysis of ${summary.filename}? Progressions made from it are kept.`)) {
                    void deleteSession(summary.id);
                  }
                }}
              >
                Delete
              </Button>
            </li>
          );
        })}
      </ul>
      {sessions.length > SHOWN ? <p className={styles.caveat}>Showing the {SHOWN} most recent of {sessions.length}.</p> : null}
    </section>
  );
}
