import { useRef, type CSSProperties, type KeyboardEvent } from "react";
import { displaySpelling } from "@/lib/roots";
import { formatSeconds, type TimelineSegment } from "@/lib/audioTimeline";
import styles from "./Audio.module.css";

interface AudioTimelineProps {
  segments: readonly TimelineSegment[];
  pathSymbols: ReadonlyArray<string | null>;
  beats: readonly number[];
  durationSeconds: number;
  currentTime: number;
  selectedFrame: number | null;
  onSelect: (frameIndex: number) => void;
}

/**
 * Two aligned lanes: the top-scoring hypothesis per analysis window, and the chord the
 * optimizer path chose for that window. Segments are focusable; arrow keys move between them.
 */
export function AudioTimeline({ segments, pathSymbols, beats, durationSeconds, currentTime, selectedFrame, onSelect }: AudioTimelineProps) {
  const refs = useRef(new Map<number, HTMLButtonElement>());
  const total = durationSeconds > 0 ? durationSeconds : 1;
  const playheadPct = Math.min(100, Math.max(0, (currentTime / total) * 100));
  const active = selectedFrame ?? 0;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, Home: -Infinity, End: Infinity };
    const move = moves[event.key];
    if (move === undefined || segments.length === 0) return;
    event.preventDefault();
    const target = move === -Infinity ? 0 : move === Infinity ? segments.length - 1
      : Math.min(segments.length - 1, Math.max(0, active + move));
    onSelect(target);
    refs.current.get(target)?.focus();
  };

  return (
    <div className={styles.timeline}>
      <div className={styles.ruler} aria-hidden="true">
        {beats.map((beat, i) => (
          <span key={i} className={styles.beat} style={{ left: `${(beat / total) * 100}%` }} />
        ))}
        <span className={styles.rulerStart}>0:00</span>
        <span className={styles.rulerEnd}>{formatSeconds(durationSeconds)}</span>
      </div>

      <div className={styles.laneLabel} id="lane-detected">Top hypothesis per window</div>
      <div
        className={styles.lane}
        role="toolbar"
        aria-labelledby="lane-detected"
        aria-orientation="horizontal"
        onKeyDown={onKeyDown}
      >
        {segments.map((segment) => {
          const label = segment.topSymbol ? displaySpelling(segment.topSymbol) : "silent";
          const pathSymbol = pathSymbols[segment.frameIndex];
          return (
            <button
              key={segment.frameIndex}
              ref={(node) => {
                if (node) refs.current.set(segment.frameIndex, node);
                else refs.current.delete(segment.frameIndex);
              }}
              type="button"
              tabIndex={segment.frameIndex === active ? 0 : -1}
              className={styles.segment}
              data-silent={segment.topSymbol === null}
              data-run-start={segment.startsRun}
              aria-pressed={segment.frameIndex === selectedFrame}
              aria-label={`${formatSeconds(segment.startSeconds)} to ${formatSeconds(segment.endSeconds)}: ${label}${
                pathSymbol && pathSymbol !== segment.topSymbol ? `; fingering path uses ${pathSymbol}` : ""
              }`}
              style={{
                left: `${segment.leftPct}%`,
                width: `${segment.widthPct}%`,
                ...(segment.topRootPitchClass === null ? {} : { "--hue": `${segment.topRootPitchClass * 30}` }),
              } as CSSProperties}
              onClick={() => onSelect(segment.frameIndex)}
            >
              {segment.startsRun ? <span aria-hidden="true">{label}</span> : null}
            </button>
          );
        })}
        <span className={styles.playhead} style={{ left: `${playheadPct}%` }} aria-hidden="true" />
      </div>

      <div className={styles.laneLabel} id="lane-path">Chord used by the fingering path</div>
      <div className={styles.lane} data-secondary="true" aria-hidden="true">
        {segments.map((segment, i) => {
          const symbol = pathSymbols[segment.frameIndex] ?? null;
          const showLabel = symbol !== null && symbol !== (pathSymbols[segments[i - 1]?.frameIndex ?? -1] ?? null);
          return (
            <span
              key={segment.frameIndex}
              className={styles.pathSegment}
              data-empty={symbol === null}
              data-differs={symbol !== null && symbol !== segment.topSymbol}
              data-selected={segment.frameIndex === selectedFrame}
              style={{ left: `${segment.leftPct}%`, width: `${segment.widthPct}%` }}
            >
              {showLabel ? displaySpelling(symbol) : null}
            </span>
          );
        })}
        <span className={styles.playhead} style={{ left: `${playheadPct}%` }} />
      </div>
    </div>
  );
}
