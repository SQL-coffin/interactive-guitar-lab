/**
 * Jianpu rhythm notation for durations on a sixteenth grid (4 ticks = one quarter-note beat).
 *
 * In Jianpu a quarter note is a bare digit, each extra beat adds a dash (增时线), eighths and
 * sixteenths get one or two underlines (减时线), and a dot extends a value by half.
 */
export type RhythmValue = "whole" | "dotted-half" | "half" | "dotted-quarter" | "quarter" | "dotted-eighth" | "eighth" | "sixteenth";

export const VALUE_TICKS: Record<RhythmValue, number> = {
  whole: 16,
  "dotted-half": 12,
  half: 8,
  "dotted-quarter": 6,
  quarter: 4,
  "dotted-eighth": 3,
  eighth: 2,
  sixteenth: 1,
};

export const VALUE_LABELS: Record<RhythmValue, string> = {
  whole: "Whole",
  "dotted-half": "Dotted half",
  half: "Half",
  "dotted-quarter": "Dotted quarter",
  quarter: "Quarter",
  "dotted-eighth": "Dotted eighth",
  eighth: "Eighth",
  sixteenth: "Sixteenth",
};

const ORDER: RhythmValue[] = ["whole", "dotted-half", "half", "dotted-quarter", "quarter", "dotted-eighth", "eighth", "sixteenth"];

export interface RhythmPiece {
  /** Tick inside the bar where this piece starts. */
  startTick: number;
  value: RhythmValue;
  ticks: number;
}

/**
 * Splits a span inside one bar into standard values that respect beat boundaries, so the result
 * is readable notation (e.g. 5 ticks from a beat = quarter tied to a sixteenth). Pieces after
 * the first are tied to the previous one.
 */
export function splitDuration(startTick: number, ticks: number, ticksPerBeat = 4): RhythmPiece[] {
  const pieces: RhythmPiece[] = [];
  let at = startTick;
  let left = ticks;
  while (left > 0) {
    const onBeat = at % ticksPerBeat === 0;
    const inBeat = at % ticksPerBeat;
    const value = ORDER.find((v) => {
      const len = VALUE_TICKS[v];
      if (len > left) return false;
      // Values of a beat or longer start on a beat; shorter values stay inside their beat.
      return len >= ticksPerBeat ? onBeat : inBeat + len <= ticksPerBeat;
    }) ?? "sixteenth";
    pieces.push({ startTick: at, value, ticks: VALUE_TICKS[value] });
    at += VALUE_TICKS[value];
    left -= VALUE_TICKS[value];
  }
  return pieces;
}

/** One drawable element of a Jianpu voice. */
export interface JianpuGlyph {
  kind: "head" | "dash";
  startTick: number;
  /** Width in ticks this glyph occupies (a dotted head spans its whole value, dot included). */
  ticks: number;
  /** 0, 1 (eighth) or 2 (sixteenth) underlines, spanning the glyph's ticks. */
  underlines: 0 | 1 | 2;
  /** Augmentation dot (附点), drawn right beside the digit rather than at the tick it adds. */
  dotted?: boolean;
}

/** Glyphs for one piece: a head, then dashes (one per extra beat); dotted values are one dotted head. */
export function glyphsFor(piece: RhythmPiece, ticksPerBeat = 4): JianpuGlyph[] {
  const { startTick: s, value } = piece;
  const b = ticksPerBeat;
  switch (value) {
    case "whole":
      return [{ kind: "head", startTick: s, ticks: b, underlines: 0 }, ...[1, 2, 3].map((k) => ({ kind: "dash" as const, startTick: s + k * b, ticks: b, underlines: 0 as const }))];
    case "dotted-half":
      return [{ kind: "head", startTick: s, ticks: b, underlines: 0 }, ...[1, 2].map((k) => ({ kind: "dash" as const, startTick: s + k * b, ticks: b, underlines: 0 as const }))];
    case "half":
      return [{ kind: "head", startTick: s, ticks: b, underlines: 0 }, { kind: "dash", startTick: s + b, ticks: b, underlines: 0 }];
    case "dotted-quarter":
      return [{ kind: "head", startTick: s, ticks: VALUE_TICKS["dotted-quarter"], underlines: 0, dotted: true }];
    case "quarter":
      return [{ kind: "head", startTick: s, ticks: b, underlines: 0 }];
    case "dotted-eighth":
      return [{ kind: "head", startTick: s, ticks: VALUE_TICKS["dotted-eighth"], underlines: 1, dotted: true }];
    case "eighth":
      return [{ kind: "head", startTick: s, ticks: 2, underlines: 1 }];
    case "sixteenth":
      return [{ kind: "head", startTick: s, ticks: 1, underlines: 2 }];
  }
}
