import type { ChordSheetEvent } from "@interactive-guitar-lab/audio-analysis";
import { locateTick, quantizeTime, type BarGrid, type QuantizedTime } from "./grid";

/** User adjustment of one chord event's quantized position; raw timestamps are never changed. */
export interface ChordAdjustment {
  startTick?: number;
  endTick?: number;
  /** The user accepted this position, so it is no longer shown as uncertain. */
  confirmed?: boolean;
}

export interface ScoreChordEvent {
  /** Index into chordSheet.events. */
  eventIndex: number;
  chordSymbol: string;
  start: QuantizedTime;
  end: QuantizedTime;
  startTick: number;
  endTick: number;
  /** False when either boundary could not be placed on the grid (and the user has not confirmed it). */
  confident: boolean;
  adjusted: boolean;
}

/** A drawable span inside one bar: part of a chord, or a rest. */
export interface ChordSegment {
  barIndex: number;
  startTick: number;
  ticks: number;
  kind: "chord" | "rest";
  eventIndex: number | null;
  chordSymbol: string | null;
  /** Continues a chord from the previous bar (no new chord symbol is drawn). */
  tiedFromPrevious: boolean;
  tiedToNext: boolean;
  confident: boolean;
}

/**
 * Places chord-sheet events (already merged by the backend when consecutive windows share a
 * chord) on the bar grid. A chord that lasts several beats or bars stays one event and is drawn
 * as tied segments, never re-attacked on every beat.
 */
export function placeChordEvents(
  grid: BarGrid,
  events: readonly ChordSheetEvent[],
  adjustments: Readonly<Record<number, ChordAdjustment>> = {},
): ScoreChordEvent[] {
  const placed: ScoreChordEvent[] = [];
  events.forEach((event, eventIndex) => {
    const adjustment = adjustments[eventIndex];
    const start = quantizeTime(grid, event.startSeconds);
    const end = quantizeTime(grid, event.endSeconds);
    const startTick = adjustment?.startTick ?? start.tick;
    const endTick = Math.max(startTick + 1, adjustment?.endTick ?? end.tick);
    const positionedByUser = adjustment?.startTick !== undefined || adjustment?.endTick !== undefined;
    placed.push({
      eventIndex,
      chordSymbol: event.chordSymbol,
      start,
      end,
      startTick,
      endTick,
      confident: adjustment?.confirmed === true || positionedByUser || (start.confident && end.confident),
      adjusted: adjustment !== undefined,
    });
  });
  // Events never overlap on the grid: an earlier event yields to the next one's start.
  for (let i = 0; i < placed.length - 1; i++) {
    const next = placed[i + 1]!;
    if (placed[i]!.endTick > next.startTick) placed[i]!.endTick = Math.max(placed[i]!.startTick + 1, next.startTick);
  }
  return placed;
}

/** Splits placed events into per-bar segments, filling gaps (silence, skipped windows) with rests. */
export function chordSegments(grid: BarGrid, placed: readonly ScoreChordEvent[]): ChordSegment[] {
  const spans: Array<{ start: number; end: number; event: ScoreChordEvent | null }> = [];
  let cursor = 0;
  for (const event of placed) {
    if (event.startTick > cursor) spans.push({ start: cursor, end: event.startTick, event: null });
    const start = Math.max(event.startTick, cursor);
    if (event.endTick > start) spans.push({ start, end: event.endTick, event });
    cursor = Math.max(cursor, event.endTick);
  }
  if (cursor < grid.totalTicks) spans.push({ start: cursor, end: grid.totalTicks, event: null });

  const segments: ChordSegment[] = [];
  for (const span of spans) {
    let at = span.start;
    while (at < Math.min(span.end, grid.totalTicks)) {
      const { barIndex, tickInBar } = locateTick(grid, at);
      const bar = grid.bars[barIndex]!;
      const until = Math.min(span.end, bar.startTick + bar.ticks);
      segments.push({
        barIndex,
        startTick: tickInBar,
        ticks: until - at,
        kind: span.event ? "chord" : "rest",
        eventIndex: span.event?.eventIndex ?? null,
        chordSymbol: span.event?.chordSymbol ?? null,
        tiedFromPrevious: span.event !== null && at > span.start,
        tiedToNext: span.event !== null && until < span.end,
        confident: span.event?.confident ?? true,
      });
      at = until;
    }
  }
  return segments;
}
