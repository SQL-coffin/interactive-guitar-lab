import { describe, expect, it } from "vitest";
import { normalizePitchClass, pitchClassFromSpelling, transposePitchClass } from "./index.js";

describe("pitch primitives", () => {
  it("normalizes pitch classes", () => {
    expect(normalizePitchClass(12)).toBe(0);
    expect(normalizePitchClass(-1)).toBe(11);
    expect(normalizePitchClass(25)).toBe(1);
  });
  it("preserves enharmonic equivalence numerically", () => {
    expect(pitchClassFromSpelling("C#")).toBe(1);
    expect(pitchClassFromSpelling("Db")).toBe(1);
  });
  it("transposes across octave boundaries", () => {
    expect(transposePitchClass(11,1)).toBe(0);
    expect(transposePitchClass(0,-1)).toBe(11);
  });
  it("rejects malformed note spellings and fractional pitch classes", () => {
    expect(() => pitchClassFromSpelling("C#b")).toThrow();
    expect(() => normalizePitchClass(1.5)).toThrow();
  });
});
