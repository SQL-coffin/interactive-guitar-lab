import type { ChordInferenceResult, OptimizedVoicingProgression } from "@/services";

export interface TimelineSegment {
  frameIndex: number;
  startSeconds: number;
  endSeconds: number;
  /** Position and width as a percentage of the audio duration. */
  leftPct: number;
  widthPct: number;
  /** Top-ranked hypothesis for this window alone, or null for a silent window. */
  topSymbol: string | null;
  topRootPitchClass: number | null;
  /** True where the top hypothesis differs from the previous window (a label is drawn). */
  startsRun: boolean;
  /** Index into the selected optimizer path, when this frame took part in it. */
  stepIndex: number | null;
}

/**
 * Lays out the backend's analysis windows on a timeline. This is pure geometry over the
 * response; window boundaries come from the worker and are not chord boundaries.
 */
export function buildTimeline(
  frames: readonly ChordInferenceResult[],
  durationSeconds: number,
  progressionFrameIndexes: readonly number[],
): TimelineSegment[] {
  const total = durationSeconds > 0 ? durationSeconds : Math.max(0, ...frames.map((f) => f.endSeconds)) || 1;
  const stepByFrame = new Map(progressionFrameIndexes.map((frameIndex, stepIndex) => [frameIndex, stepIndex]));
  let previous: string | null | undefined;
  return frames.map((frame, frameIndex) => {
    const top = frame.candidates[0];
    const topSymbol = top?.symbol ?? null;
    const startsRun = topSymbol !== previous;
    previous = topSymbol;
    const start = Math.max(0, Math.min(frame.startSeconds, total));
    const end = Math.max(start, Math.min(frame.endSeconds, total));
    return {
      frameIndex,
      startSeconds: frame.startSeconds,
      endSeconds: frame.endSeconds,
      leftPct: (start / total) * 100,
      widthPct: ((end - start) / total) * 100,
      topSymbol,
      topRootPitchClass: top?.rootPitchClass ?? null,
      startsRun,
      stepIndex: stepByFrame.get(frameIndex) ?? null,
    };
  });
}

/** The chord symbol the optimizer path chose for each frame (null where skipped). */
export function pathSymbolsByFrame(
  segments: readonly TimelineSegment[],
  path: OptimizedVoicingProgression | undefined,
): Array<string | null> {
  return segments.map((segment) =>
    segment.stepIndex === null ? null : path?.steps[segment.stepIndex]?.chordSymbol ?? null,
  );
}

export function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "–:––";
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  const tenths = Math.floor((seconds - whole) * 10);
  return `${minutes}:${String(rest).padStart(2, "0")}.${tenths}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
