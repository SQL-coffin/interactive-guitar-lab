import type { ChordSheetEvent } from "./chord-sheet.js";

/**
 * A non-destructive suggestion to review a brief chord hypothesis between
 * matching neighboring events. It never changes the source chord sheet.
 */
export interface ChordSheetRefinementSuggestion {
  suggestionId: string;
  eventIndex: number;
  reason: "short-interstitial-event";
  currentChordSymbol: string;
  suggestedChordSymbol: string;
  durationSeconds: number;
  contextEventIndexes: [number, number];
  sourceFrameIndexes: number[];
}

export interface ChordSheetRefinementOptions {
  /** Maximum event duration to flag for review; defaults to 0.18 seconds. */
  maxDurationSeconds?: number;
  /** Maximum temporal gap at either side of the event; defaults to 0.05 seconds. */
  maxGapSeconds?: number;
}

/**
 * Identify possible short recognition glitches without automatically smoothing
 * them away. A suggestion is produced only when the event is short, both
 * neighboring events agree on a different chord, source windows are adjacent,
 * and the event is temporally connected to both neighbors.
 *
 * The input events are treated as immutable evidence and are never modified.
 */
export function suggestChordSheetRefinements(
  events: readonly ChordSheetEvent[],
  options: ChordSheetRefinementOptions = {},
): ChordSheetRefinementSuggestion[] {
  const maxDurationSeconds = options.maxDurationSeconds ?? 0.18;
  const maxGapSeconds = options.maxGapSeconds ?? 0.05;

  if (!Number.isFinite(maxDurationSeconds) || maxDurationSeconds <= 0 || maxDurationSeconds > 1) {
    throw new RangeError("maxDurationSeconds must be greater than 0 and at most 1.");
  }
  if (!Number.isFinite(maxGapSeconds) || maxGapSeconds < 0 || maxGapSeconds > 0.25) {
    throw new RangeError("maxGapSeconds must be between 0 and 0.25.");
  }

  const suggestions: ChordSheetRefinementSuggestion[] = [];
  for (let index = 1; index < events.length - 1; index += 1) {
    const previous = events[index - 1]!;
    const current = events[index]!;
    const next = events[index + 1]!;

    const durationSeconds = current.endSeconds - current.startSeconds;
    const previousFrame = previous.sourceFrameIndexes.at(-1);
    const currentFirstFrame = current.sourceFrameIndexes[0];
    const currentLastFrame = current.sourceFrameIndexes.at(-1);
    const nextFirstFrame = next.sourceFrameIndexes[0];

    if (previous.chordSymbol !== next.chordSymbol
      || current.chordSymbol === previous.chordSymbol
      || durationSeconds <= 0
      || durationSeconds > maxDurationSeconds
      || previousFrame === undefined
      || currentFirstFrame === undefined
      || currentLastFrame === undefined
      || nextFirstFrame === undefined
      || currentFirstFrame !== previousFrame + 1
      || nextFirstFrame !== currentLastFrame + 1) {
      continue;
    }

    const previousGapSeconds = current.startSeconds - previous.endSeconds;
    const nextGapSeconds = next.startSeconds - current.endSeconds;
    if (previousGapSeconds > maxGapSeconds || nextGapSeconds > maxGapSeconds) continue;

    suggestions.push({
      suggestionId: `short-interstitial-event-${index}`,
      eventIndex: index,
      reason: "short-interstitial-event",
      currentChordSymbol: current.chordSymbol,
      suggestedChordSymbol: previous.chordSymbol,
      durationSeconds,
      contextEventIndexes: [index - 1, index + 1],
      sourceFrameIndexes: [...current.sourceFrameIndexes],
    });
  }

  return suggestions;
}
