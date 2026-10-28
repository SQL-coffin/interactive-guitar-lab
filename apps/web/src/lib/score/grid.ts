import type { MeterInfo } from "./meter";

/** Score resolution: one tick is a sixteenth note. */
export const TICKS_PER_WHOLE = 16;

export interface ScoreBar {
  /** Position in the bar list (0-based). */
  index: number;
  /** Displayed bar number; a pickup bar is 0. */
  number: number;
  pickup: boolean;
  startSeconds: number;
  endSeconds: number;
  /** Detected beat timestamps inside this bar (real, possibly uneven). */
  beatTimesSeconds: number[];
  /** Length of this bar in ticks (a pickup bar is shorter). */
  ticks: number;
  /** Absolute tick of the bar's first tick across the whole score. */
  startTick: number;
  /** True when the detected beats do not match the meter, so positions are interpolated linearly. */
  irregular: boolean;
}

export interface BarGrid {
  bars: ScoreBar[];
  ticksPerBeat: number;
  beatsPerBar: number;
  totalTicks: number;
}

const EPS = 0.03; // seconds; tolerance when matching beats to downbeats

/**
 * Builds bars from the backend's downbeats and beats. Bar boundaries are the detected downbeats
 * (not a nominal tempo grid), so uneven timing is preserved. Returns null when the meter is unknown.
 */
export function buildBarGrid(meter: MeterInfo, durationSeconds: number): BarGrid | null {
  if (!meter.known || meter.numerator === null || meter.denominator === null) return null;
  const beatsPerBar = meter.numerator;
  const ticksPerBeat = TICKS_PER_WHOLE / meter.denominator;
  const downbeats = meter.downbeatTimesSeconds;
  const beats = meter.beatTimesSeconds;
  const nominalBar = meter.barDurationSeconds
    ?? (downbeats.length > 1 ? (downbeats[downbeats.length - 1]! - downbeats[0]!) / (downbeats.length - 1) : null);
  const bars: ScoreBar[] = [];
  const beatsIn = (start: number, end: number) => beats.filter((b) => b >= start - EPS && b < end - EPS);

  // Anacrusis: beats before the first downbeat form a short pickup bar.
  const first = downbeats[0]!;
  const pickupBeats = beatsIn(0, first);
  if (pickupBeats.length > 0) {
    const count = Math.min(pickupBeats.length, beatsPerBar - 1);
    bars.push({
      index: 0, number: 0, pickup: true,
      startSeconds: pickupBeats[pickupBeats.length - count]!, endSeconds: first,
      beatTimesSeconds: pickupBeats.slice(-count), ticks: count * ticksPerBeat, startTick: 0, irregular: false,
    });
  }

  downbeats.forEach((start, i) => {
    const end = downbeats[i + 1] ?? Math.min(durationSeconds, start + (nominalBar ?? durationSeconds - start));
    if (end - start <= EPS) return;
    const inBar = beatsIn(start, end);
    bars.push({
      index: bars.length, number: i + 1, pickup: false, startSeconds: start, endSeconds: end,
      beatTimesSeconds: inBar, ticks: beatsPerBar * ticksPerBeat, startTick: 0,
      irregular: inBar.length !== beatsPerBar || Math.abs(inBar[0]! - start) > EPS,
    });
  });

  let tick = 0;
  for (const bar of bars) {
    bar.startTick = tick;
    tick += bar.ticks;
  }
  return { bars, ticksPerBeat, beatsPerBar, totalTicks: tick };
}

/** Index of the bar containing `seconds`, clamped to the score. */
export function barAt(grid: BarGrid, seconds: number): number {
  let found = 0;
  grid.bars.forEach((bar, i) => {
    if (seconds >= bar.startSeconds - 1e-6) found = i;
  });
  return found;
}

/**
 * Position of `seconds` inside a bar, in beats. Uses the detected beat timestamps piecewise, so a
 * slower or faster beat stretches only its own span. Irregular bars fall back to linear time.
 */
export function beatPosition(grid: BarGrid, bar: ScoreBar, seconds: number): number {
  const beatsInBar = bar.ticks / grid.ticksPerBeat;
  if (bar.irregular || bar.beatTimesSeconds.length !== beatsInBar) {
    const span = bar.endSeconds - bar.startSeconds;
    return span > 0 ? ((seconds - bar.startSeconds) / span) * beatsInBar : 0;
  }
  const anchors = [...bar.beatTimesSeconds, bar.endSeconds];
  if (seconds <= anchors[0]!) return 0;
  for (let k = 0; k < anchors.length - 1; k++) {
    const a = anchors[k]!;
    const b = anchors[k + 1]!;
    if (seconds < b) return k + (b > a ? (seconds - a) / (b - a) : 0);
  }
  return beatsInBar;
}

export interface QuantizedTime {
  /** Original timestamp, always preserved. */
  seconds: number;
  /** Absolute tick snapped to the sixteenth grid. */
  tick: number;
  /** Unsnapped absolute position in ticks (fractional). */
  exactTick: number;
  /** Distance between the exact and snapped position, in ticks. */
  errorTicks: number;
  confident: boolean;
}

/** Positions further than this from a sixteenth are not forced onto the grid (≈ a 64th note). */
export const MAX_SNAP_ERROR_TICKS = 0.3;

export function quantizeTime(grid: BarGrid, seconds: number): QuantizedTime {
  const bar = grid.bars[barAt(grid, seconds)]!;
  const lastBar = grid.bars[grid.bars.length - 1]!;
  const clamped = Math.min(Math.max(seconds, grid.bars[0]!.startSeconds), lastBar.endSeconds);
  const exactInBar = Math.min(beatPosition(grid, bar, clamped) * grid.ticksPerBeat, bar.ticks);
  const exactTick = bar.startTick + exactInBar;
  const tick = Math.round(exactTick);
  const errorTicks = Math.abs(exactTick - tick);
  // Times outside the grid are clamped to its edge, so their snapped position says nothing about the real onset.
  const outside = seconds < grid.bars[0]!.startSeconds - EPS || seconds > lastBar.endSeconds + EPS;
  // Irregular bars interpolate between downbeats, so their positions are never treated as reliable.
  return { seconds, tick, exactTick, errorTicks, confident: errorTicks <= MAX_SNAP_ERROR_TICKS && !bar.irregular && !outside };
}

/** Bar index and tick-within-bar for an absolute tick. */
export function locateTick(grid: BarGrid, tick: number): { barIndex: number; tickInBar: number } {
  for (let i = grid.bars.length - 1; i >= 0; i--) {
    if (tick >= grid.bars[i]!.startTick) return { barIndex: i, tickInBar: tick - grid.bars[i]!.startTick };
  }
  return { barIndex: 0, tickInBar: 0 };
}
