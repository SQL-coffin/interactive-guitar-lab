import { describe, expect, it } from "vitest";
import type { ChromaFrame } from "./types.js";
import { analyzeKeyCandidates } from "./key-analysis.js";

const frame = (startSeconds: number, endSeconds: number, pitchClasses: readonly number[]): ChromaFrame => ({
  startSeconds,
  endSeconds,
  chroma: Array.from({ length: 12 }, (_, pitchClass) => pitchClasses.includes(pitchClass) ? 1 : 0),
});

describe("analyzeKeyCandidates", () => {
  it("shows C major and A minor when a natural-note collection has no clear tonal center", () => {
    const result = analyzeKeyCandidates([frame(0, 4, [0, 2, 4, 5, 7, 9, 11])]);

    expect(result.status).toBe("ambiguous");
    expect(result.ambiguityKind).toBe("relative-major-minor");
    expect(result.candidates.map((candidate) => candidate.label)).toEqual(["C major", "A minor"]);
    expect(result.explanation).toMatch(/both possibilities are shown/i);
    expect(result.evidence.observedPitchClasses).toHaveLength(7);
  });

  it("identifies a clear C-major cadence rather than retaining an unsupported relative key", () => {
    const result = analyzeKeyCandidates([
      frame(0, 2, [0, 4, 7]),
      frame(2, 2.5, [5, 9, 0]),
      frame(2.5, 3, [7, 11, 2]),
      frame(3, 5, [0, 4, 7]),
    ]);

    expect(result.status).toBe("identified");
    expect(result.candidates.map((candidate) => candidate.label)).toEqual(["C major"]);
    expect(result.ambiguityKind).toBeNull();
  });

  it("identifies a clear A-minor cadence when the dominant chord supports the minor tonic", () => {
    const result = analyzeKeyCandidates([
      frame(0, 2, [9, 0, 4]),
      frame(2, 2.5, [4, 8, 11]),
      frame(2.5, 3, [9, 0, 4]),
      frame(3, 5, [9, 0, 4]),
    ]);

    expect(result.status).toBe("identified");
    expect(result.candidates.map((candidate) => candidate.label)).toEqual(["A minor"]);
    expect(result.ambiguityKind).toBeNull();
  });
  it("does not mistake a single sustained triad for enough evidence to infer a song key", () => {
    const result = analyzeKeyCandidates([frame(0, 5, [0, 4, 7])]);

    expect(result.status).toBe("insufficient-evidence");
    expect(result.candidates).toEqual([]);
    expect(result.evidence.observedPitchClasses).toHaveLength(3);
  });

  it("shows competing non-relative keys when the best profiles are close", () => {
    const result = analyzeKeyCandidates([frame(0, 4, [0, 2, 4, 5])]);

    expect(result.status).toBe("ambiguous");
    expect(result.ambiguityKind).toBe("competing-keys");
    expect(result.candidates.map((candidate) => candidate.label)).toEqual(["C major", "F major"]);
    expect(result.scoreMargin).toBeLessThanOrEqual(0.035);
  });
  it("does not guess a key from silence", () => {
    const result = analyzeKeyCandidates([frame(0, 5, [])]);

    expect(result.status).toBe("insufficient-evidence");
    expect(result.candidates).toEqual([]);
    expect(result.explanation).toMatch(/isn't enough/i);
  });

  it("rejects invalid ambiguity thresholds", () => {
    expect(() => analyzeKeyCandidates([], { relativeKeyAmbiguityThreshold: -0.1 })).toThrow(RangeError);
  });
});
