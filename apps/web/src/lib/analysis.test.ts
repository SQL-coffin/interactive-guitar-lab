import { describe, expect, it } from "vitest";
import { buildChord, searchVoicings } from "@interactive-guitar-lab/music-theory";
import { diffVoicings } from "./voicingDiff";
import { buildTimeline, formatBytes, formatSeconds, pathSymbolsByFrame } from "./audioTimeline";
import type { ChordInferenceResult } from "@/services";

const shape = (...frets: Array<number | null>) => ({ strings: frets.map((fret) => (fret === null ? null : { fret })) }) as never;

describe("diffVoicings", () => {
  it("classifies every string and totals the movement", () => {
    // C (x32010) → Am (x02210)
    const diff = diffVoicings(shape(null, 3, 2, 0, 1, 0), shape(null, 0, 2, 2, 1, 0));
    expect(diff.strings.map((s) => s.change)).toEqual(["silent", "moved", "held", "moved", "held", "held"]);
    expect(diff).toMatchObject({ held: 3, moved: 2, muteChanges: 0, fretTravel: 5 });
  });
  it("counts muting changes separately from fret travel", () => {
    const diff = diffVoicings(shape(3, 2, 0, 0, 0, 3), shape(null, 3, 2, 0, 1, 0));
    expect(diff.strings[0]).toMatchObject({ change: "muted", from: 3, to: null });
    expect(diff).toMatchObject({ muteChanges: 1, moved: 4 });
  });
  it("works with real engine voicings", () => {
    const [a, b] = searchVoicings("G", "major", { limit: 2 }).results;
    expect(diffVoicings(a!, b!).strings).toHaveLength(6);
  });
});

describe("audio timeline", () => {
  const frame = (start: number, symbol: string | null): ChordInferenceResult => ({
    startSeconds: start,
    endSeconds: start + 1,
    candidates: symbol ? [{ symbol, rootPitchClass: buildChord(symbol[0]!, "major").tones[0]!.pitchClass } as never] : [],
  });
  const frames = [frame(0, "C"), frame(1, "C"), frame(2, null), frame(3, "G")];

  it("positions windows proportionally and labels where the top hypothesis changes", () => {
    const segments = buildTimeline(frames, 4, [0, 1, 3]);
    expect(segments.map((s) => [s.leftPct, s.widthPct])).toEqual([[0, 25], [25, 25], [50, 25], [75, 25]]);
    expect(segments.map((s) => s.startsRun)).toEqual([true, false, true, true]);
    expect(segments.map((s) => s.stepIndex)).toEqual([0, 1, null, 2]);
    expect(segments[2]!.topSymbol).toBeNull();
  });

  it("maps optimizer steps back onto frames, skipping silent ones", () => {
    const segments = buildTimeline(frames, 4, [0, 1, 3]);
    const path = { totalCost: 1, steps: [{ chordSymbol: "CMaj7" }, { chordSymbol: "C" }, { chordSymbol: "G" }] } as never;
    expect(pathSymbolsByFrame(segments, path)).toEqual(["CMaj7", "C", null, "G"]);
    expect(pathSymbolsByFrame(segments, undefined)).toEqual([null, null, null, null]);
  });

  it("formats times and sizes", () => {
    expect(formatSeconds(0)).toBe("0:00.0");
    expect(formatSeconds(83.45)).toBe("1:23.4");
    expect(formatSeconds(Number.NaN)).toBe("–:––");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(25 * 1024 * 1024)).toBe("25.0 MB");
  });
});
