import { describe, expect, it } from "vitest";
import { analysisFixture } from "@/test/analysisFixture";
import { extractChordSequence, isCorrected } from "./model";
import { DEFAULT_PROGRESSION_SETTINGS, INITIAL_PROGRESSION_STATE, optimizeSegment, progressionReducer } from "@/state/progressionState";

describe("extractChordSequence", () => {
  it("keeps order, merges consecutive windows, splits at silence and links back to windows", () => {
    const result = analysisFixture();
    const chords = extractChordSequence(result, 0);
    expect(chords.map((c) => [c.detected.symbol, c.frameIndexes, c.startSeconds, c.endSeconds])).toEqual([
      ["C", [0, 1], 0, 2],
      ["C", [3], 3, 4],
      ["G", [4, 5], 4, 6],
    ]);
    const steps = result.chordAnalysis.optimization!.results[0]!.steps;
    for (const chord of chords) {
      // Every link points at the step the optimizer chose for that window.
      chord.frameIndexes.forEach((frameIndex, i) => {
        expect(result.chordAnalysis.progressionFrameIndexes[chord.stepIndexes[i]!]).toBe(frameIndex);
        expect(steps[chord.stepIndexes[i]!]!.chordSymbol).toBe(chord.detected.symbol);
      });
      expect(chord.voicing).toBe(steps[chord.stepIndexes[0]!]!.voicing);
      expect(chord.detected).toMatchObject({ root: chord.detected.symbol.replace(/m$/, ""), quality: "major" });
    }
  });

  it("returns nothing for a missing path instead of guessing", () => {
    expect(extractChordSequence(analysisFixture(), 9)).toEqual([]);
  });
});

describe("progression override layer", () => {
  const source = extractChordSequence(analysisFixture(), 0)[0]!;
  const loaded = progressionReducer(INITIAL_PROGRESSION_STATE, {
    type: "load",
    slots: [{ id: "", root: "C", quality: "major", source: { ...source, sessionId: "s1", pathIndex: 0 } }],
  });

  it("records a correction without touching the detected chord, and can revert it", () => {
    const id = loaded.slots[0]!.id;
    const edited = progressionReducer(loaded, { type: "update", id, patch: { quality: "minor" } });
    expect(edited.slots[0]).toMatchObject({ root: "C", quality: "minor" });
    expect(edited.slots[0]!.source!.detected).toEqual({ symbol: "C", root: "C", quality: "major" });
    expect(isCorrected(edited.slots[0]!)).toBe(true);
    const reverted = progressionReducer(edited, { type: "revert", id });
    expect(reverted.slots[0]).toMatchObject({ root: "C", quality: "major" });
    expect(isCorrected(reverted.slots[0]!)).toBe(false);
  });

  it("gives loaded slots fresh unique ids", () => {
    const twice = progressionReducer(loaded, { type: "load", slots: [...loaded.slots, ...loaded.slots] });
    expect(new Set(twice.slots.map((s) => s.id)).size).toBe(2);
  });

  it("optimizes long progressions in clamped segments", () => {
    const slots = Array.from({ length: 30 }, (_, i) => ({ id: String(i), root: "C", quality: "major" as const }));
    expect(optimizeSegment({ slots, settings: { ...DEFAULT_PROGRESSION_SETTINGS, segmentStart: 5 } }).slots.map((s) => s.id)[0]).toBe("5");
    expect(optimizeSegment({ slots, settings: { ...DEFAULT_PROGRESSION_SETTINGS, segmentStart: 99 } }).start).toBe(18);
    expect(optimizeSegment({ slots: slots.slice(0, 4), settings: DEFAULT_PROGRESSION_SETTINGS }).slots).toHaveLength(4);
  });
});
