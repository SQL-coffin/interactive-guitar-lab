import { describe, expect, it } from "vitest";
import { analyzeChromaProgression, inferChordCandidates, type ChromaFrame } from "./index.js";

function chromaFrame(energies: number[], bassPitchClass?: number): ChromaFrame {
  return {
    startSeconds: 2,
    endSeconds: 2.5,
    chroma: energies,
    ...(bassPitchClass === undefined ? {} : { bassPitchClass }),
  };
}

describe("chroma-based chord inference", () => {
  it("ranks a clear major triad first and returns supporting pitch classes", () => {
    const energies = Array.from({ length: 12 }, () => 0);
    energies[0] = 1; // C
    energies[4] = 0.95; // E
    energies[7] = 0.9; // G
    const result = inferChordCandidates(chromaFrame(energies));

    expect(result.candidates[0]!.symbol).toBe("C");
    expect(result.candidates[0]!.quality).toBe("major");
    expect(result.candidates[0]!.confidence).toBeGreaterThan(0.99);
    expect(result.candidates[0]!.evidence.matchedPitchClasses).toEqual([0, 4, 7]);
    expect(result.startSeconds).toBe(2);
    expect(result.endSeconds).toBe(2.5);
  });

  it("recognizes a major seventh pitch set and respects the requested candidate limit", () => {
    const energies = Array.from({ length: 12 }, () => 0);
    energies[9] = 1; // A
    energies[1] = 0.9; // C#
    energies[4] = 0.8; // E
    energies[8] = 0.85; // G#
    const result = inferChordCandidates(chromaFrame(energies, 9), { limit: 3 });

    expect(result.candidates).toHaveLength(3);
    expect(result.candidates[0]!.root).toBe("A");
    expect(result.candidates[0]!.quality).toBe("major7");
    expect(result.candidates[0]!.evidence.bassRootMatch).toBe(true);
  });

  it("uses low-register bass evidence to resolve otherwise ambiguous shared tones", () => {
    const energies = Array.from({ length: 12 }, () => 0);
    energies[6] = 0.6; // F#
    energies[9] = 1; // A
    energies[1] = 1; // C#
    energies[4] = 1; // E
    energies[8] = 1; // G#

    const withoutBass = inferChordCandidates(chromaFrame(energies), {
      limit: 1,
      qualities: ["major7", "minor7"],
      bassRootBonus: 0,
    });
    const withBass = inferChordCandidates(chromaFrame(energies, 6), {
      limit: 1,
      qualities: ["major7", "minor7"],
    });

    expect(withoutBass.candidates[0]!.symbol).toBe("AMaj7");
    expect(withBass.candidates[0]!.symbol).toBe("F#m7");
    expect(withBass.candidates[0]!.evidence.bassRootMatch).toBe(true);
  });

  it("returns no chord candidates for a silent frame", () => {
    const result = inferChordCandidates(chromaFrame(Array.from({ length: 12 }, () => 0)));
    expect(result.candidates).toEqual([]);
  });

  it("validates malformed chroma and option values", () => {
    expect(() => inferChordCandidates(chromaFrame([1, 2]))).toThrow(TypeError);
    expect(() => inferChordCandidates(chromaFrame(Array.from({ length: 12 }, () => -1)))).toThrow(RangeError);
    expect(() => inferChordCandidates(chromaFrame(Array.from({ length: 12 }, () => 1)), { limit: 73 })).toThrow(RangeError);
    expect(() => inferChordCandidates(chromaFrame(Array.from({ length: 12 }, () => 1)), { bassRootBonus: 1 })).toThrow(RangeError);
  });

  it("connects chroma evidence to voicing search and progression optimization", () => {
    const silence = chromaFrame(Array.from({ length: 12 }, () => 0));
    const aMaj7 = Array.from({ length: 12 }, () => 0);
    for (const pitchClass of [9, 1, 4, 8]) aMaj7[pitchClass] = 1;
    const fSharpMinor7 = Array.from({ length: 12 }, () => 0);
    for (const pitchClass of [6, 9, 1, 4]) fSharpMinor7[pitchClass] = 1;

    const result = analyzeChromaProgression([
      silence,
      { startSeconds: 2.5, endSeconds: 3, chroma: aMaj7, bassPitchClass: 9 },
      { startSeconds: 3, endSeconds: 3.5, chroma: fSharpMinor7, bassPitchClass: 6 },
    ], {
      chordCandidateLimit: 1,
      voicingsPerChord: 3,
      voicingSearchOptions: { maxFret: 8, maxFretSpan: 4 },
      progressionOptions: { limit: 2 },
    });

    expect(result.skippedSilentFrameIndexes).toEqual([0]);
    expect(result.progressionFrameIndexes).toEqual([1, 2]);
    expect(result.optimization).not.toBeNull();
    expect(result.optimization!.results[0]!.steps.map((step) => step.chordSymbol))
      .toEqual(["AMaj7", "F#m7"]);
  });

  it("returns no voicing progression when every frame is silent", () => {
    const silent = chromaFrame(Array.from({ length: 12 }, () => 0));
    const result = analyzeChromaProgression([silent]);
    expect(result.optimization).toBeNull();
    expect(result.skippedSilentFrameIndexes).toEqual([0]);
  });
});
