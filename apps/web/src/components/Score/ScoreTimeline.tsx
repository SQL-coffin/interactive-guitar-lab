import type { ChordSheetEvent } from "@interactive-guitar-lab/audio-analysis";
import { displaySpelling } from "@/lib/roots";
import { formatSeconds } from "@/lib/audioTimeline";
import styles from "./Score.module.css";

const SECONDS_PER_ROW = 10;
const ROW_WIDTH = 900;

/**
 * Fallback when the meter is unknown: chords on a plain time axis. No bars or note values are
 * drawn, because they cannot be derived without a reliable bar grid.
 */
export function ScoreTimeline({ events, beats, durationSeconds }: { events: readonly ChordSheetEvent[]; beats: readonly number[]; durationSeconds: number }) {
  const rows = Math.max(1, Math.ceil(durationSeconds / SECONDS_PER_ROW));
  const px = (seconds: number) => (seconds / SECONDS_PER_ROW) * ROW_WIDTH;
  return (
    <div className={styles.timeline} aria-label="Chord timeline (time signature unknown)">
      {Array.from({ length: rows }, (_, row) => {
        const from = row * SECONDS_PER_ROW;
        const to = from + SECONDS_PER_ROW;
        return (
          <svg key={row} viewBox={`0 0 ${ROW_WIDTH} 64`} className={styles.timelineRow} role="img" aria-label={`${formatSeconds(from)} to ${formatSeconds(Math.min(to, durationSeconds))}`}>
            <line x1={0} x2={ROW_WIDTH} y1={44} y2={44} stroke="var(--border-strong)" />
            {beats.filter((b) => b >= from && b < to).map((b, i) => (
              <line key={i} x1={px(b - from)} x2={px(b - from)} y1={40} y2={48} stroke="var(--text-muted)" />
            ))}
            {Array.from({ length: SECONDS_PER_ROW + 1 }, (_, s) => (
              <text key={s} x={Math.min(px(s), ROW_WIDTH - 16)} y={60} fontSize="9" fill="var(--text-muted)">{formatSeconds(from + s).replace(/\.\d$/, "")}</text>
            ))}
            {events.filter((e) => e.endSeconds > from && e.startSeconds < to).map((e, i) => {
              const x0 = px(Math.max(e.startSeconds, from) - from);
              const x1 = px(Math.min(e.endSeconds, to) - from);
              return (
                <g key={i}>
                  <rect x={x0} y={22} width={Math.max(2, x1 - x0 - 2)} height={14} rx={3} fill="var(--accent-soft)" stroke="var(--accent)" />
                  {e.startSeconds >= from ? <text x={x0 + 3} y={16} fontSize="12" fontWeight="700" fill="currentColor">{displaySpelling(e.chordSymbol)}</text> : null}
                </g>
              );
            })}
          </svg>
        );
      })}
    </div>
  );
}
