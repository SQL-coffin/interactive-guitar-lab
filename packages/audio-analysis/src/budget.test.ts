import { describe, expect, it } from "vitest";
import { analyzeChromaProgression } from "./recommend-voicings.js";
import { AUDIO_ANALYSIS_LIMITS, AudioAnalysisBudgetError, estimateOptimizerWork } from "./budget.js";
import type { ChromaFrame } from "./types.js";

const cMajor = Array.from({ length: 12 }, (_, pc) => ([0, 4, 7].includes(pc) ? 1 : 0));
const gMajor = Array.from({ length: 12 }, (_, pc) => ([7, 11, 2].includes(pc) ? 1 : 0));
const frames = (count: number): ChromaFrame[] =>
  Array.from({ length: count }, (_, i) => ({ startSeconds: i, endSeconds: i + 1, chroma: i % 2 ? gMajor : cMajor, bassPitchClass: null }));

describe("audio analysis work budget", () => {
  it("keeps the browser defaults valid for the worker's full 600-second maximum", () => {
    // UI defaults: 3 hypotheses × 5 voicings, 3 paths, at its 1 s and 0.5 s window choices.
    expect(estimateOptimizerWork(600, 15, 3)).toBeLessThanOrEqual(AUDIO_ANALYSIS_LIMITS.maxOptimizerWork);
    expect(estimateOptimizerWork(1_200, 15, 3)).toBeLessThanOrEqual(AUDIO_ANALYSIS_LIMITS.maxOptimizerWork);
    const result = analyzeChromaProgression(frames(60), { progressionOptions: { limit: 3 } });
    expect(result.optimization!.results).toHaveLength(3);
    expect(result.optimization!.candidateCounts.every((count) => count <= 15)).toBe(true);
  });

  it("bounds the aggregate candidates per frame, not just each parameter", () => {
    expect(() => analyzeChromaProgression(frames(2), { chordCandidateLimit: 6, voicingsPerChord: 6 }))
      .toThrow(/chordCandidateLimit × voicingsPerChord must be at most 30 \(requested 36\)/);
    // Previously legal on their own: 72 hypotheses × 50 voicings = 3,600 candidates per frame.
    expect(() => analyzeChromaProgression(frames(2), { chordCandidateLimit: 72, voicingsPerChord: 50 })).toThrow(RangeError);
    expect(analyzeChromaProgression(frames(2), { chordCandidateLimit: 6, voicingsPerChord: 5 }).optimization).not.toBeNull();
  });

  it("bounds the audio progression limit separately from the standalone route", () => {
    expect(() => analyzeChromaProgression(frames(2), { progressionOptions: { limit: 11 } })).toThrow(/1 to 10 for audio analysis/);
    expect(analyzeChromaProgression(frames(2), { progressionOptions: { limit: 10 } }).optimization).not.toBeNull();
  });

  it("rejects too many frames with a 413-class error before any voicing search", () => {
    const error = (() => {
      try { analyzeChromaProgression(frames(AUDIO_ANALYSIS_LIMITS.maxFrames + 1)); } catch (e) { return e; }
      return undefined;
    })();
    expect(error).toBeInstanceOf(AudioAnalysisBudgetError);
    expect(error).toMatchObject({ statusCode: 413, message: expect.stringContaining("1201 analysis windows") });
  });

  it("rejects an over-budget workload immediately instead of running it", { timeout: 2_000 }, () => {
    // 700 frames × 30 candidates × 5 paths ≈ 1.1e9 path-copy operations; running it takes tens of seconds.
    expect(estimateOptimizerWork(700, 30, 5)).toBeGreaterThan(AUDIO_ANALYSIS_LIMITS.maxOptimizerWork);
    const started = performance.now();
    expect(() => analyzeChromaProgression(frames(700), { chordCandidateLimit: 6, voicingsPerChord: 5 }))
      .toThrow(AudioAnalysisBudgetError);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
