import { describe, expect, it } from "vitest";
import type { ChordSheetEvent } from "@interactive-guitar-lab/audio-analysis";
import type { AudioAnalysisResponse } from "@/services";
import { readMeter, timeSignatureLabel } from "./meter";
import { buildBarGrid, quantizeTime } from "./grid";
import { chordSegments, placeChordEvents } from "./chordTrack";
import { glyphsFor, splitDuration } from "./rhythm";
import { noteSegments, placeNote, type MelodyNote } from "./melody";

type Rhythm = AudioAnalysisResponse["audio"]["rhythm"];
function response(rhythm: Partial<Rhythm>, windowingMode: "beat-aligned" | "fixed-window" = "beat-aligned"): AudioAnalysisResponse {
  return {
    audio: {
      schemaVersion: "1.0", filename: "t.wav", durationSeconds: 20, sampleRate: 22050, windowSeconds: 0.5, windowingMode,
      rhythm: { tempoBpm: 120, beatTimesSeconds: [], timeSignatureNumerator: null, timeSignatureDenominator: null, meterConfidence: null, barDurationSeconds: null, downbeatTimesSeconds: [], ...rhythm },
    },
  } as unknown as AudioAnalysisResponse;
}
const beatsEvery = (step: number, count: number, from = 0) => Array.from({ length: count }, (_, i) => +(from + i * step).toFixed(6));
const event = (chordSymbol: string, startSeconds: number, endSeconds: number): ChordSheetEvent => ({
  chordSymbol, root: chordSymbol[0]!, quality: "major", startSeconds, endSeconds, meanConfidence: 0.9, meanScore: 0.9,
  sourceFrameIndexes: [], startBeat: null, endBeat: null, startBar: null, endBar: null, beatInBar: null,
});

const fourFour = () => {
  const beats = beatsEvery(0.5, 16); // 120 BPM, 4 bars
  return readMeter(response({ beatTimesSeconds: beats, timeSignatureNumerator: 4, timeSignatureDenominator: 4, meterConfidence: 0.8, barDurationSeconds: 2, downbeatTimesSeconds: [0, 2, 4, 6] }));
};

describe("meter", () => {
  it("never assumes 4/4 when the meter is unknown", () => {
    const meter = readMeter(response({ beatTimesSeconds: beatsEvery(0.5, 8) }));
    expect(meter.known).toBe(false);
    expect(timeSignatureLabel(meter)).toBe("Unknown");
    expect(buildBarGrid(meter, 4)).toBeNull();
  });

  it("treats a signature without downbeats as unknown", () => {
    const meter = readMeter(response({ timeSignatureNumerator: 4, timeSignatureDenominator: 4, meterConfidence: 0.7, downbeatTimesSeconds: [] }));
    expect(meter.known).toBe(false);
  });

  it("reads sessions saved before the metrical fields existed", () => {
    const legacy = { audio: { durationSeconds: 4, windowSeconds: 1, rhythm: { tempoBpm: 90, beatTimesSeconds: [0.5] } } } as unknown as AudioAnalysisResponse;
    expect(readMeter(legacy)).toMatchObject({ known: false, windowingMode: "unknown", tempoBpm: 90 });
  });
});

describe("bar grid", () => {
  it("builds 4/4 bars from downbeats with 16 sixteenths each", () => {
    const grid = buildBarGrid(fourFour(), 8)!;
    expect(grid.bars.map((b) => [b.number, b.startSeconds, b.endSeconds, b.ticks, b.startTick])).toEqual([
      [1, 0, 2, 16, 0], [2, 2, 4, 16, 16], [3, 4, 6, 16, 32], [4, 6, 8, 16, 48],
    ]);
  });

  it("builds 3/4 bars with 12 sixteenths each", () => {
    const meter = readMeter(response({ beatTimesSeconds: beatsEvery(0.5, 9), timeSignatureNumerator: 3, timeSignatureDenominator: 4, meterConfidence: 0.7, barDurationSeconds: 1.5, downbeatTimesSeconds: [0, 1.5, 3] }));
    const grid = buildBarGrid(meter, 4.5)!;
    expect(grid.bars.map((b) => b.ticks)).toEqual([12, 12, 12]);
    expect(quantizeTime(grid, 2.0)).toMatchObject({ tick: 16, confident: true }); // bar 2, beat 2
  });

  it("follows uneven beat timestamps instead of a nominal tempo", () => {
    // Beat 3 of bar 1 is late (rubato): 0, 0.5, 1.2, 1.6, then downbeat at 2.0.
    const meter = readMeter(response({ beatTimesSeconds: [0, 0.5, 1.2, 1.6, 2, 2.5, 3, 3.5], timeSignatureNumerator: 4, timeSignatureDenominator: 4, meterConfidence: 0.7, barDurationSeconds: 2, downbeatTimesSeconds: [0, 2] }));
    const grid = buildBarGrid(meter, 4)!;
    expect(quantizeTime(grid, 1.2)).toMatchObject({ tick: 8, confident: true }); // beat 3, not 9.6 ticks
    expect(quantizeTime(grid, 0.85)).toMatchObject({ tick: 6, confident: true }); // halfway through beat 2
  });

  it("adds a pickup bar for beats before the first downbeat", () => {
    const meter = readMeter(response({ beatTimesSeconds: beatsEvery(0.5, 10), timeSignatureNumerator: 4, timeSignatureDenominator: 4, meterConfidence: 0.7, barDurationSeconds: 2, downbeatTimesSeconds: [1, 3] }));
    const grid = buildBarGrid(meter, 5)!;
    expect(grid.bars[0]).toMatchObject({ pickup: true, number: 0, ticks: 8, startSeconds: 0 });
    expect(grid.bars[1]).toMatchObject({ number: 1, startTick: 8 });
  });
});

describe("quantization", () => {
  it("snaps reliable onsets and keeps the raw timestamp", () => {
    const grid = buildBarGrid(fourFour(), 8)!;
    expect(quantizeTime(grid, 2.252)).toMatchObject({ seconds: 2.252, tick: 18, confident: true });
  });

  it("flags positions that fall between sixteenths instead of forcing them", () => {
    const grid = buildBarGrid(fourFour(), 8)!;
    const q = quantizeTime(grid, 0.0625); // exactly between two sixteenths (0 and 0.125 s)
    expect(q.confident).toBe(false);
    expect(q.errorTicks).toBeCloseTo(0.5);
  });

  it("never reports times outside the bar grid as reliable (regression: clamped onsets looked exact)", () => {
    // First detected beat at 1.0 s: audio before it is outside every bar.
    const meter = readMeter(response({ beatTimesSeconds: [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5], timeSignatureNumerator: 4, timeSignatureDenominator: 4, meterConfidence: 0.8, barDurationSeconds: 2, downbeatTimesSeconds: [2, 4] }));
    const grid = buildBarGrid(meter, 6)!;
    expect(grid.bars[0]).toMatchObject({ pickup: true, startSeconds: 1 });
    expect(quantizeTime(grid, 0)).toMatchObject({ seconds: 0, tick: 0, confident: false });
    expect(quantizeTime(grid, 1)).toMatchObject({ tick: 0, confident: true });
  });

  it("treats bars with missing beats as unreliable", () => {
    const meter = readMeter(response({ beatTimesSeconds: [0, 0.5, 2, 2.5, 3, 3.5], timeSignatureNumerator: 4, timeSignatureDenominator: 4, meterConfidence: 0.6, barDurationSeconds: 2, downbeatTimesSeconds: [0, 2] }));
    const grid = buildBarGrid(meter, 4)!;
    expect(grid.bars[0]!.irregular).toBe(true);
    expect(quantizeTime(grid, 1).confident).toBe(false);
  });
});

describe("chord rhythm track", () => {
  it("keeps one chord across several bars as tied segments, with rests in gaps", () => {
    const grid = buildBarGrid(fourFour(), 8)!;
    // C from beat 2 of bar 1 to beat 3 of bar 3, silence, then G for the last bar.
    const placed = placeChordEvents(grid, [event("C", 0.5, 5), event("G", 6, 8)]);
    const segs = chordSegments(grid, placed).map((s) => [s.barIndex, s.kind, s.chordSymbol, s.startTick, s.ticks, s.tiedFromPrevious, s.tiedToNext]);
    expect(segs).toEqual([
      [0, "rest", null, 0, 4, false, false],
      [0, "chord", "C", 4, 12, false, true],
      [1, "chord", "C", 0, 16, true, true],
      [2, "chord", "C", 0, 8, true, false],
      [2, "rest", null, 8, 8, false, false],
      [3, "chord", "G", 0, 16, false, false],
    ]);
  });

  it("supports several chords inside one bar", () => {
    const grid = buildBarGrid(fourFour(), 8)!;
    const segs = chordSegments(grid, placeChordEvents(grid, [event("C", 0, 1), event("F", 1, 1.5), event("G", 1.5, 2)]))
      .filter((s) => s.barIndex === 0).map((s) => [s.chordSymbol, s.startTick, s.ticks]);
    expect(segs).toEqual([["C", 0, 8], ["F", 8, 4], ["G", 12, 4]]);
  });

  it("marks off-grid chord boundaries as low confidence until the user adjusts or confirms them", () => {
    const grid = buildBarGrid(fourFour(), 8)!;
    const raw = placeChordEvents(grid, [event("C", 0.0625, 2)]);
    expect(raw[0]).toMatchObject({ confident: false, adjusted: false });
    expect(raw[0]!.start.seconds).toBe(0.0625);
    const moved = placeChordEvents(grid, [event("C", 0.0625, 2)], { 0: { startTick: 0 } });
    expect(moved[0]).toMatchObject({ startTick: 0, confident: true, adjusted: true });
    expect(moved[0]!.start.seconds).toBe(0.0625); // raw timestamp untouched
  });
});

describe("rhythm notation", () => {
  it("splits durations on beat boundaries", () => {
    expect(splitDuration(0, 16).map((p) => p.value)).toEqual(["whole"]);
    expect(splitDuration(0, 6).map((p) => p.value)).toEqual(["dotted-quarter"]);
    expect(splitDuration(0, 5).map((p) => p.value)).toEqual(["quarter", "sixteenth"]);
    expect(splitDuration(2, 4).map((p) => [p.startTick, p.value])).toEqual([[2, "eighth"], [4, "eighth"]]);
    expect(splitDuration(1, 3).map((p) => p.value)).toEqual(["dotted-eighth"]);
  });

  it("draws Jianpu dashes, dots and underlines", () => {
    expect(glyphsFor({ startTick: 0, value: "half", ticks: 8 }).map((g) => g.kind)).toEqual(["head", "dash"]);
    expect(glyphsFor({ startTick: 0, value: "dotted-quarter", ticks: 6 }).map((g) => [g.kind, g.underlines])).toEqual([["head", 0], ["dot", 0]]);
    expect(glyphsFor({ startTick: 0, value: "eighth", ticks: 2 })[0]!.underlines).toBe(1);
    expect(glyphsFor({ startTick: 0, value: "sixteenth", ticks: 1 })[0]!.underlines).toBe(2);
  });
});

describe("manual melody", () => {
  const note = (id: string, startTick: number, ticks: number, degree: MelodyNote["degree"] = 1): MelodyNote =>
    ({ id, startTick, ticks, degree, accidental: 0, octave: 0, source: "manual" });

  it("overwrites overlapping notes and clamps to the score", () => {
    let notes = placeNote([], note("a", 0, 8), 64);
    notes = placeNote(notes, note("b", 4, 4, 3), 64);
    expect(notes.map((n) => [n.id, n.startTick, n.ticks])).toEqual([["a", 0, 4], ["b", 4, 4]]);
    notes = placeNote(notes, note("c", 62, 8, 5), 64);
    expect(notes.at(-1)).toMatchObject({ id: "c", startTick: 62, ticks: 2 });
  });

  it("ties notes across bar lines", () => {
    const grid = buildBarGrid(fourFour(), 8)!;
    const segs = noteSegments(grid, [note("a", 12, 8, 5)]).map((s) => [s.barIndex, s.startTick, s.ticks, s.tiedFromPrevious, s.tiedToNext]);
    expect(segs).toEqual([[0, 12, 4, false, true], [1, 0, 4, true, false]]);
  });
});
