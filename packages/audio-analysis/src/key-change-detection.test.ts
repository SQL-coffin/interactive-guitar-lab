import { describe, expect, it } from "vitest";
import type { ChromaFrame } from "./types.js";
import { detectKeyChanges } from "./key-change-detection.js";

const frame = (startSeconds: number, endSeconds: number, pitchClasses: readonly number[]): ChromaFrame => ({
  startSeconds,
  endSeconds,
  chroma: Array.from({ length: 12 }, (_, pitchClass) => pitchClasses.includes(pitchClass) ? 1 : 0),
});

const weightedFrame = (startSeconds: number, endSeconds: number, weights: readonly number[]): ChromaFrame => ({
  startSeconds,
  endSeconds,
  chroma: Array.from({ length: 12 }, (_, pitchClass) => weights[pitchClass] ?? 0),
});

function sequence(regions: Array<{ start: number; end: number; pitches: number[] }>): ChromaFrame[] {
  const frames: ChromaFrame[] = [];
  for (let start = 0; start < regions[regions.length - 1]!.end; start += 0.5) {
    const region = regions.find((item) => start >= item.start && start < item.end)!;
    frames.push(frame(start, Math.min(start + 0.5, region.end), region.pitches));
  }
  return frames;
}

describe("detectKeyChanges", () => {
  it("detects a sustained local-key change without asserting that it is definitely a modulation", () => {
    const frames = sequence([
      { start: 0, end: 24, pitches: [11, 1, 3, 4, 6, 8, 10] }, // B major collection
      { start: 24, end: 48, pitches: [4, 6, 7, 9, 11, 0, 2] }, // E natural minor collection
    ]);

    const result = detectKeyChanges(frames, { windowSeconds: 12, hopSeconds: 2 });

    expect(result.status).toBe("detected");
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events[0]!.timeSeconds).toBeGreaterThanOrEqual(12);
    expect(result.events[0]!.timeSeconds).toBeLessThanOrEqual(34);
    expect(["possible", "uncertain"]).toContain(result.events[0]!.status);
    expect(result.events[0]!.explanation).toMatch(/cannot confirm modulation/i);
  });

  it("does not report a change from a single short transient", () => {
    const frames = sequence([
      { start: 0, end: 20, pitches: [11, 1, 3, 4, 6, 8, 10] },
      { start: 20, end: 22, pitches: [4, 6, 7, 9, 11, 0, 2] },
      { start: 22, end: 42, pitches: [11, 1, 3, 4, 6, 8, 10] },
    ]);

    const result = detectKeyChanges(frames, { windowSeconds: 8, hopSeconds: 2, minimumPersistentWindows: 3 });

    expect(result.events).toHaveLength(0);
  });

  it("does not treat a relative-major/minor profile ranking flip as a key-family change", () => {
    // Both regions contain the same F#-major / D#-minor pitch collection. The
    // emphasis shifts between F# and D#, but that alone is not enough to claim
    // a modulation from chroma profiles.
    const bEmphasis = [0, 0.7, 0, 0.7, 0, 0, 1, 0, 0.7, 0, 0.7, 0.7];
    const gSharpEmphasis = [0, 0.7, 0, 1, 0, 0, 0.7, 0, 0.7, 0, 0.7, 0.7];
    const frames: ChromaFrame[] = [];
    for (let start = 0; start < 48; start += 0.5) {
      frames.push(weightedFrame(start, start + 0.5, start < 24 ? bEmphasis : gSharpEmphasis));
    }

    const result = detectKeyChanges(frames);
    expect(result.events).toHaveLength(0);
    expect(result.status).toBe("no-clear-change");
  });

  it("returns insufficient evidence for empty audio", () => {
    const result = detectKeyChanges([]);

    expect(result.status).toBe("insufficient-evidence");
    expect(result.events).toEqual([]);
  });

  it("rejects invalid window options", () => {
    expect(() => detectKeyChanges([], { windowSeconds: 2 })).toThrow(RangeError);
    expect(() => detectKeyChanges([], { hopSeconds: 0 })).toThrow(RangeError);
  });
});
