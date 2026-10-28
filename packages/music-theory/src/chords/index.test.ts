import { describe, expect, it } from "vitest";
import { buildChord, getSupportedChordQualities } from "./index.js";

describe("buildChord", () => {
  it("builds AMaj7 with correct spelling and formula", () => {
    const chord = buildChord("A", "major7");
    expect(chord.symbol).toBe("AMaj7");
    expect(chord.formula).toEqual(["1", "3", "5", "7"]);
    expect(chord.tones.map((tone) => tone.spelling)).toEqual(["A", "C#", "E", "G#"]);
    expect(chord.tones.map((tone) => tone.pitchClass)).toEqual([9, 1, 4, 8]);
  });

  it("distinguishes A7 from AMaj7 by the seventh", () => {
    expect(buildChord("A", "dominant7").tones.map((tone) => tone.spelling)).toEqual(["A", "C#", "E", "G"]);
    expect(buildChord("A", "major7").tones.map((tone) => tone.spelling)).toEqual(["A", "C#", "E", "G#"]);
  });

  it("spells minor thirds and flat-root chords correctly", () => {
    expect(buildChord("A", "minor").tones.map((tone) => tone.spelling)).toEqual(["A", "C", "E"]);
    expect(buildChord("Db", "major").tones.map((tone) => tone.spelling)).toEqual(["Db", "F", "Ab"]);
  });

  it("builds sus2 without a third", () => {
    const chord = buildChord("C", "sus2");
    expect(chord.symbol).toBe("Csus2");
    expect(chord.formula).toEqual(["1", "2", "5"]);
    expect(chord.tones.map((tone) => tone.spelling)).toEqual(["C", "D", "G"]);
    expect(chord.tones.map((tone) => tone.degree)).toEqual(["1", "2", "5"]);
  });

  it("spells augmented fifths as raised fifth scale degrees", () => {
    const chord = buildChord("A", "augmented");
    expect(chord.symbol).toBe("Aaug");
    expect(chord.formula).toEqual(["1", "3", "♯5"]);
    expect(chord.tones.map((tone) => tone.spelling)).toEqual(["A", "C#", "E#"]);
    expect(chord.tones.map((tone) => tone.pitchClass)).toEqual([9, 1, 5]);
  });

  it("builds diminished triads with a flattened fifth", () => {
    const chord = buildChord("D", "diminished");
    expect(chord.symbol).toBe("Ddim");
    expect(chord.formula).toEqual(["1", "♭3", "♭5"]);
    expect(chord.tones.map((tone) => tone.spelling)).toEqual(["D", "F", "Ab"]);
    expect(chord.tones.map((tone) => tone.pitchClass)).toEqual([2, 5, 8]);
  });

  it("builds add9 with the ninth spelled as a ninth, not a second", () => {
    const chord = buildChord("C", "add9");
    expect(chord.symbol).toBe("Cadd9");
    expect(chord.formula).toEqual(["1", "3", "5", "9"]);
    expect(chord.tones.map((tone) => tone.spelling)).toEqual(["C", "E", "G", "D"]);
    expect(chord.tones.map((tone) => tone.degree)).toEqual(["1", "3", "5", "9"]);
    expect(chord.tones.map((tone) => tone.semitonesFromRoot)).toEqual([0, 4, 7, 14]);
  });

  it("keeps all ten supported qualities discoverable through the shared type source", () => {
    expect(getSupportedChordQualities()).toEqual(expect.arrayContaining([
      "major", "minor", "dominant7", "major7", "minor7", "sus4",
      "sus2", "augmented", "diminished", "add9",
    ]));
    expect(getSupportedChordQualities()).toHaveLength(10);
  });

  it("rejects invalid roots", () => {
    expect(() => buildChord("H", "major")).toThrow();
  });
});
