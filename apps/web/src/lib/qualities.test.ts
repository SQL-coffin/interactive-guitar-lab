import { describe, expect, it } from "vitest";
import { getSupportedChordQualities } from "@interactive-guitar-lab/music-theory";
import type { ChordQuality } from "@/services";
import { groupQualities, qualityLabel } from "./qualities";

describe("chord quality labels", () => {
  it("names the four new qualities", () => {
    expect(qualityLabel("sus2")).toBe("Sus 2");
    expect(qualityLabel("augmented")).toBe("Augmented");
    expect(qualityLabel("diminished")).toBe("Diminished");
    expect(qualityLabel("add9")).toBe("Add 9");
  });

  it("keeps the six existing names", () => {
    expect((["major", "minor", "dominant7", "major7", "minor7", "sus4"] as const).map(qualityLabel))
      .toEqual(["Major", "Minor", "Dominant 7", "Major 7", "Minor 7", "Sus 4"]);
  });

  it("has a label for every quality the engine supports", () => {
    for (const quality of getSupportedChordQualities()) expect(qualityLabel(quality)).not.toBe(quality);
  });
});

describe("groupQualities (display only)", () => {
  it("groups the backend's qualities into triads, sevenths and suspended/added chords", () => {
    const groups = groupQualities(getSupportedChordQualities());
    expect(groups.map((g) => [g.label, g.qualities])).toEqual([
      ["Triads", ["major", "minor", "diminished", "augmented"]],
      ["Seventh chords", ["dominant7", "major7", "minor7"]],
      ["Suspended & added", ["sus2", "sus4", "add9"]],
    ]);
    expect(groups.flatMap((g) => g.qualities).sort()).toEqual([...getSupportedChordQualities()].sort());
  });

  it("shows only what the API returned and never drops an unknown quality", () => {
    const groups = groupQualities(["sus4", "major", "power5" as ChordQuality]);
    expect(groups.map((g) => [g.id, g.qualities])).toEqual([
      ["triads", ["major"]],
      ["colour", ["sus4"]],
      ["other", ["power5"]],
    ]);
  });
});
