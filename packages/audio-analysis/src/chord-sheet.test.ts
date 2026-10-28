import { describe, expect, it } from "vitest";
import { buildChordSheet } from "./chord-sheet.js";
import type { ChordCandidate, ChordInferenceResult } from "./types.js";

function candidate(symbol: string, confidence = 0.8): ChordCandidate {
  const root = symbol.replace(/m.*$|Maj.*$|7.*$|sus.*$|dim.*$|aug.*$/i, "") || "C";
  return {
    symbol,
    root,
    rootPitchClass: 0,
    quality: "major",
    confidence,
    score: confidence,
    evidence: {
      chordToneEnergy: confidence,
      nonChordEnergy: 0,
      activePitchClasses: [0, 4, 7],
      matchedPitchClasses: [0, 4, 7],
      bassRootMatch: null,
    },
  };
}

function windowResult(startSeconds: number, endSeconds: number, symbol?: string, confidence = 0.8): ChordInferenceResult {
  return {
    startSeconds,
    endSeconds,
    candidates: symbol ? [candidate(symbol, confidence)] : [],
  };
}

describe("buildChordSheet", () => {
  it("merges consecutive windows with the same top-ranked chord", () => {
    const result = buildChordSheet([
      windowResult(0, 1, "Am7", 0.7),
      windowResult(1, 2, "Am7", 0.9),
      windowResult(2, 3, "D7", 0.8),
    ]);

    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toMatchObject({
      chordSymbol: "Am7",
      startSeconds: 0,
      endSeconds: 2,
      meanConfidence: 0.8,
      sourceFrameIndexes: [0, 1],
    });
    expect(result.events[1]).toMatchObject({
      chordSymbol: "D7",
      startSeconds: 2,
      endSeconds: 3,
      sourceFrameIndexes: [2],
    });
    expect(result.sourceWindowCount).toBe(3);
  });

  it("does not merge across silent windows or time gaps", () => {
    const withSilence = buildChordSheet([
      windowResult(0, 1, "C"),
      windowResult(1, 2),
      windowResult(2, 3, "C"),
    ]);
    expect(withSilence.events).toHaveLength(2);
    expect(withSilence.skippedWindowIndexes).toEqual([1]);

    const withGap = buildChordSheet([
      windowResult(0, 1, "C"),
      windowResult(1.2, 2.2, "C"),
    ]);
    expect(withGap.events).toHaveLength(2);
  });

  it("preserves short chord changes rather than smoothing them away", () => {
    const result = buildChordSheet([
      windowResult(0, 1, "Am"),
      windowResult(1, 1.5, "E7"),
      windowResult(1.5, 2.5, "Am"),
    ]);
    expect(result.events.map((event) => event.chordSymbol)).toEqual(["Am", "E7", "Am"]);
  });

  it("maps event onsets to detected beats and bar positions", () => {
    const result = buildChordSheet([
      windowResult(0, 0.5, "C"),
      windowResult(0.5, 1, "G"),
      windowResult(1, 1.5, "Am"),
      windowResult(1.5, 2, "F"),
      windowResult(2, 2.5, "C"),
    ], {
      beatTimesSeconds: [0, 0.5, 1, 1.5, 2, 2.5],
      tempoBpm: 120,
      beatsPerBar: 4,
    });
    expect(result.rhythm.timingSource).toBe("beat-detection");
    expect(result.events[0]).toMatchObject({ startBeat: 1, startBar: 1, beatInBar: 0 });
    expect(result.events[3]).toMatchObject({ startBeat: 4, startBar: 1, beatInBar: 3 });
    expect(result.events[4]).toMatchObject({ startBeat: 5, startBar: 2, beatInBar: 0 });
  });

  it("uses tempo only as a fallback and leaves beat positions unknown without rhythm data", () => {
    const frames = [windowResult(0, 0.5, "C"), windowResult(0.5, 1, "G")];
    const fallback = buildChordSheet(frames, { tempoBpm: 120 });
    expect(fallback.rhythm.timingSource).toBe("tempo-estimate");
    expect(fallback.rhythm.beatTimesSeconds).toEqual([0, 0.5, 1]);
    expect(fallback.events[1]).toMatchObject({ startBeat: 2, startBar: 1, beatInBar: 1 });

    const unavailable = buildChordSheet(frames);
    expect(unavailable.rhythm.timingSource).toBe("unavailable");
    expect(unavailable.events[0]!.startBeat).toBeNull();
  });

  it("validates rhythm and meter input", () => {
    expect(buildChordSheet([])).toMatchObject({
      schemaVersion: "1.1",
      events: [],
      refinementSuggestions: [],
      sourceWindowCount: 0,
      skippedWindowIndexes: [],
      rhythm: { beatsPerBar: 4, timingSource: "unavailable" },
    });
    expect(() => buildChordSheet([], { continuityToleranceSeconds: -1 })).toThrow(RangeError);
    expect(() => buildChordSheet([], { beatsPerBar: 0 })).toThrow(RangeError);
    expect(() => buildChordSheet([], { beatTimesSeconds: [1, 0] })).toThrow(RangeError);
  });
});
