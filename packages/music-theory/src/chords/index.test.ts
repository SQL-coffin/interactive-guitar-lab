import { describe, expect, it } from "vitest";
import { buildChord } from "./index.js";

describe("buildChord", () => {
  it("builds AMaj7 with correct spelling and formula", () => {
    const chord=buildChord("A","major7");
    expect(chord.symbol).toBe("AMaj7");
    expect(chord.formula).toEqual(["1","3","5","7"]);
    expect(chord.tones.map(t=>t.spelling)).toEqual(["A","C#","E","G#"]);
    expect(chord.tones.map(t=>t.pitchClass)).toEqual([9,1,4,8]);
  });
  it("distinguishes A7 from AMaj7 by the seventh", () => {
    expect(buildChord("A","dominant7").tones.map(t=>t.spelling)).toEqual(["A","C#","E","G"]);
    expect(buildChord("A","major7").tones.map(t=>t.spelling)).toEqual(["A","C#","E","G#"]);
  });
  it("spells minor thirds and flat-root chords correctly", () => {
    expect(buildChord("A","minor").tones.map(t=>t.spelling)).toEqual(["A","C","E"]);
    expect(buildChord("Db","major").tones.map(t=>t.spelling)).toEqual(["Db","F","Ab"]);
  });
  it("rejects invalid roots", () => {
    expect(() => buildChord("H","major")).toThrow();
  });
});
