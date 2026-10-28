import { describe, expect, it } from "vitest";
import { getFretboard, getNoteAtPosition, STANDARD_GUITAR_TUNING } from "./index.js";

describe("fretboard mapping", () => {
  it("maps standard tuning low to high", () => {
    expect(getFretboard({tuning:[...STANDARD_GUITAR_TUNING],maxFret:0}).map(p=>p.noteName))
      .toEqual(["E","A","D","G","B","E"]);
  });
  it("maps A on the low E string at fret 5", () => {
    expect(getNoteAtPosition(STANDARD_GUITAR_TUNING,1,5)).toMatchObject({string:1,fret:5,midi:45,pitchClass:9,noteName:"A"});
  });
  it("creates 78 positions for six strings and frets 0–12", () => {
    expect(getFretboard({tuning:[...STANDARD_GUITAR_TUNING],maxFret:12})).toHaveLength(78);
  });
  it("rejects invalid fret limits", () => {
    expect(() => getFretboard({tuning:[...STANDARD_GUITAR_TUNING],maxFret:-1})).toThrow();
  });
});
