import { describe, expect, it } from "vitest";
import { searchVoicings, validateVoicing } from "./index.js";
import { buildChord } from "../chords/index.js";

describe("voicing search", () => {
  it("finds playable A major seventh shapes on standard tuning", () => {
    const result = searchVoicings("A", "major7", { maxFret: 12, limit: 20 });
    expect(result.results.length).toBeGreaterThan(0);
    for (const voicing of result.results) {
      expect(validateVoicing(voicing, result.chord, result.options).valid).toBe(true);
      expect(voicing.notes.every((note) => result.chord.tones.some((tone) => tone.pitchClass === note.pitchClass))).toBe(true);
    }
  });

  it("can require every chord tone for a full voicing", () => {
    const result = searchVoicings("A", "major7", {
      maxFret: 12, minNotes: 4, maxNotes: 4, requireAllTones: true, limit: 10,
    });
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.every((voicing) => voicing.missingDegrees.length === 0)).toBe(true);
  });

  it.each([
    ["sus2", "Csus2"],
    ["augmented", "Caug"],
    ["diminished", "Cdim"],
    ["add9", "Cadd9"],
  ] as const)("searches voicings for the new %s quality", (quality, symbol) => {
    const result = searchVoicings("C", quality, { maxFret: 7, limit: 2 });
    expect(result.chord.symbol).toBe(symbol);
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.every((voicing) => validateVoicing(voicing, result.chord, result.options).valid)).toBe(true);
  });

  it("can constrain the root to a selected string", () => {
    const result = searchVoicings("A", "major7", { rootString: 5, maxFret: 12, limit: 10 });
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.every((voicing) => voicing.strings[4]?.pitchClass === 9)).toBe(true);
  });

  it("rejects impossible fret and note-count options", () => {
    expect(() => searchVoicings("A", "major7", { minFret: 15, maxFret: 12 })).toThrow(RangeError);
    expect(() => searchVoicings("A", "major7", { minNotes: 7 })).toThrow(RangeError);
  });

  it("validator catches notes outside the chord", () => {
    const chord = buildChord("A", "major7");
    const result = searchVoicings("A", "major7", { limit: 1 });
    const voicing = structuredClone(result.results[0]!);
    const note = voicing.strings.find((item) => item !== null)!;
    note.pitchClass = (note.pitchClass + 1) % 12;
    expect(validateVoicing(voicing, chord).valid).toBe(false);
  });
});
