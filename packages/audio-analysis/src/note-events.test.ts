import { describe, expect, it } from "vitest";
import {
  MAX_NOTE_EVENTS,
  NoteEventValidationError,
  parseNoteEvent,
  parseNoteEventAnalysis,
  sortNoteEvents,
  validateNoteEvents,
  type NoteEvent,
} from "./note-events.js";
import { summarizeNoteEvents } from "./analyze-note-events.js";

function note(overrides: Partial<Record<keyof NoteEvent, unknown>> = {}): Record<string, unknown> {
  return {
    pitchMidi: 60,
    onsetSeconds: 0.5,
    offsetSeconds: 1,
    onsetConfidence: 0.8,
    offsetConfidence: 0.6,
    pitchConfidence: 0.9,
    source: "heuristic",
    ...overrides,
  };
}

function analysis(events: unknown[]): Record<string, unknown> {
  return {
    schemaVersion: "1.0",
    model: { name: "heuristic-cqt-onset-baseline", version: "0.1.0", source: "heuristic", calibrated: false },
    frameRateHz: 86.1328,
    pitchRangeMidi: { min: 40, max: 88 },
    truncated: false,
    events,
  };
}

describe("note event validation", () => {
  it("accepts a well-formed event and an event with an unknown offset", () => {
    expect(parseNoteEvent(note())).toEqual(note());
    expect(parseNoteEvent(note({ offsetSeconds: null, offsetConfidence: null })).offsetSeconds).toBeNull();
    expect(parseNoteEvent(note({ guitar: null }))).not.toHaveProperty("guitar");
  });

  it.each([
    ["NaN onset", { onsetSeconds: Number.NaN }],
    ["infinite onset", { onsetSeconds: Number.POSITIVE_INFINITY }],
    ["negative onset", { onsetSeconds: -0.01 }],
    ["offset before onset", { offsetSeconds: 0.4 }],
    ["zero-length note", { offsetSeconds: 0.5 }],
    ["string timestamp", { onsetSeconds: "0.5" }],
    ["confidence above one", { onsetConfidence: 1.01 }],
    ["negative confidence", { pitchConfidence: -0.1 }],
    ["NaN confidence", { offsetConfidence: Number.NaN }],
    ["offset without confidence", { offsetConfidence: null }],
    ["confidence without offset", { offsetSeconds: null }],
    ["fractional pitch", { pitchMidi: 60.5 }],
    ["pitch above MIDI range", { pitchMidi: 128 }],
    ["unknown source", { source: "midi" }],
    ["unsupported technique", { guitar: { techniques: ["windmill"] } }],
    ["invalid fret", { guitar: { fret: -1 } }],
  ])("rejects %s", (_label, overrides) => {
    expect(() => parseNoteEvent(note(overrides))).toThrow(NoteEventValidationError);
  });

  it("keeps reserved guitar attributes when a future model provides them", () => {
    const parsed = parseNoteEvent(note({ guitar: { stringNumber: 2, fret: 5, techniques: ["slide-in"], strumGroupId: 3 } }));
    expect(parsed.guitar).toEqual({ stringNumber: 2, fret: 5, techniques: ["slide-in"], strumGroupId: 3 });
  });

  it("requires sorted events, keeps overlaps, and enforces duration bounds and the event cap", () => {
    const low = note({ pitchMidi: 57, onsetSeconds: 0.2, offsetSeconds: 1.8 });
    const high = note({ pitchMidi: 64, onsetSeconds: 0.9, offsetSeconds: 2.6 });
    expect(validateNoteEvents([low, high], 3)).toHaveLength(2);
    expect(() => validateNoteEvents([high, low])).toThrow("sorted");
    expect(() => validateNoteEvents([low, high], 2)).toThrow("outside the audio duration");
    expect(() => validateNoteEvents(Array.from({ length: MAX_NOTE_EVENTS + 1 }, () => note()))).toThrow("at most");
    const sorted = sortNoteEvents([parseNoteEvent(high), parseNoteEvent(low)]);
    expect(sorted.map((event) => event.pitchMidi)).toEqual([57, 64]);
  });

  it("orders same-onset events by pitch", () => {
    const chord = [note({ pitchMidi: 52 }), note({ pitchMidi: 59 }), note({ pitchMidi: 64 })];
    expect(validateNoteEvents(chord)).toHaveLength(3);
    expect(() => validateNoteEvents([chord[1], chord[0]])).toThrow("sorted");
  });

  it("validates the analysis envelope", () => {
    expect(parseNoteEventAnalysis(analysis([note()]), 2).events).toHaveLength(1);
    expect(() => parseNoteEventAnalysis({ ...analysis([]), schemaVersion: "2.0" })).toThrow("schema");
    expect(() => parseNoteEventAnalysis({ ...analysis([]), frameRateHz: 0 })).toThrow("frameRateHz");
    expect(() => parseNoteEventAnalysis(analysis([note({ pitchMidi: 30 })]))).toThrow("pitchRangeMidi");
    expect(() => parseNoteEventAnalysis(analysis([note({ source: "model" })]))).toThrow("sources");
    expect(() => parseNoteEventAnalysis({ ...analysis([]), truncated: "no" })).toThrow("truncated");
  });
});

describe("note event summary", () => {
  it("counts overlap and unresolved offsets without treating back-to-back notes as overlapping", () => {
    const events = validateNoteEvents([
      note({ pitchMidi: 57, onsetSeconds: 0, offsetSeconds: 1 }),
      note({ pitchMidi: 60, onsetSeconds: 1, offsetSeconds: 2 }),
      note({ pitchMidi: 64, onsetSeconds: 1.5, offsetSeconds: null, offsetConfidence: null }),
    ]);
    expect(summarizeNoteEvents(events, 3)).toEqual({
      eventCount: 3,
      unresolvedOffsetCount: 1,
      maxPolyphony: 2,
      lowestPitchMidi: 57,
      highestPitchMidi: 64,
    });
    expect(summarizeNoteEvents([], 1)).toMatchObject({ eventCount: 0, maxPolyphony: 0, lowestPitchMidi: null });
  });
});
