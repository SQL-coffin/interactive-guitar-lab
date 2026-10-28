import { describe, expect, it } from "vitest";
import { buildChordSheet } from "./chord-sheet.js";
import { suggestChordSheetRefinements } from "./chord-sheet-refinement.js";
import type { ChordCandidate, ChordInferenceResult } from "./types.js";

function frame(startSeconds: number, endSeconds: number, symbol: string): ChordInferenceResult {
  const candidate: ChordCandidate = {
    symbol,
    root: symbol[0]!,
    rootPitchClass: 0,
    quality: "major",
    confidence: 0.8,
    score: 0.8,
    evidence: {
      chordToneEnergy: 0.8,
      nonChordEnergy: 0.2,
      activePitchClasses: [0, 4, 7],
      matchedPitchClasses: [0, 4, 7],
      bassRootMatch: null,
    },
  };
  return { startSeconds, endSeconds, candidates: [candidate] };
}

describe("suggestChordSheetRefinements", () => {
  it("suggests review of a brief isolated event between matching chords without changing events", () => {
    const sheet = buildChordSheet([
      frame(0, 0.1, "Am"),
      frame(0.1, 0.2, "D7"),
      frame(0.2, 0.3, "Am"),
    ]);
    const originalEvents = structuredClone(sheet.events);

    expect(sheet.refinementSuggestions).toEqual([{
      suggestionId: "short-interstitial-event-1",
      eventIndex: 1,
      reason: "short-interstitial-event",
      currentChordSymbol: "D7",
      suggestedChordSymbol: "Am",
      suggestedRoot: "A",
      suggestedQuality: "major",
      durationSeconds: expect.closeTo(0.1),
      contextEventIndexes: [0, 2],
      sourceFrameIndexes: [1],
    }]);
    expect(sheet.events).toEqual(originalEvents);
  });

  it("does not suggest a real longer event or a transition without matching neighbors", () => {
    const longer = buildChordSheet([
      frame(0, 0.1, "Am"),
      frame(0.1, 0.7, "D7"),
      frame(0.7, 0.8, "Am"),
    ]);
    const differingNeighbors = buildChordSheet([
      frame(0, 0.1, "Am"),
      frame(0.1, 0.2, "D7"),
      frame(0.2, 0.3, "G"),
    ]);

    expect(longer.refinementSuggestions).toEqual([]);
    expect(differingNeighbors.refinementSuggestions).toEqual([]);
  });

  it("does not suggest across skipped frames or time gaps", () => {
    const skippedFrame = buildChordSheet([
      frame(0, 0.1, "Am"),
      { startSeconds: 0.1, endSeconds: 0.2, candidates: [] },
      frame(0.2, 0.3, "D7"),
      frame(0.3, 0.4, "Am"),
    ]);
    const gap = buildChordSheet([
      frame(0, 0.1, "Am"),
      frame(0.2, 0.3, "D7"),
      frame(0.3, 0.4, "Am"),
    ]);

    expect(skippedFrame.refinementSuggestions).toEqual([]);
    expect(gap.refinementSuggestions).toEqual([]);
  });

  it("supports explicit thresholds and validates them", () => {
    const events = buildChordSheet([
      frame(0, 0.1, "Am"),
      frame(0.1, 0.3, "D7"),
      frame(0.3, 0.4, "Am"),
    ]).events;

    expect(suggestChordSheetRefinements(events, { maxDurationSeconds: 0.25 })).toHaveLength(1);
    expect(suggestChordSheetRefinements(events, { maxDurationSeconds: 0.15 })).toHaveLength(0);
    expect(() => suggestChordSheetRefinements(events, { maxDurationSeconds: 0 })).toThrow(RangeError);
    expect(() => suggestChordSheetRefinements(events, { maxGapSeconds: 0.3 })).toThrow(RangeError);
  });
});
