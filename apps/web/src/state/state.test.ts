import { describe, expect, it } from "vitest";
import { DEFAULT_CONSTRAINTS, INITIAL_EXPLORER_STATE, explorerReducer, toSearchOptions } from "./explorerState";
import { EMPTY_SELECTION, fretboardSelectionReducer } from "./fretboardSelection";

describe("explorerReducer", () => {
  it("resets the pinned voicing when the chord or constraints change", () => {
    const pinned = { ...INITIAL_EXPLORER_STATE, selectedVoicing: 5 };
    expect(explorerReducer(pinned, { type: "setRoot", root: "D" }).selectedVoicing).toBe(0);
    expect(explorerReducer(pinned, { type: "setQuality", quality: "minor" }).selectedVoicing).toBe(0);
    expect(explorerReducer(pinned, { type: "setConstraint", patch: { maxFret: 5 } }).selectedVoicing).toBe(0);
    expect(explorerReducer(pinned, { type: "setLabelMode", labelMode: "note" }).selectedVoicing).toBe(5);
  });
  it("keeps the pinned voicing when only the spelling changes for the same root", () => {
    const state = { ...INITIAL_EXPLORER_STATE, root: "C", selectedVoicing: 3 };
    expect(explorerReducer(state, { type: "setSpelling", spelling: "flat", root: "C" }).selectedVoicing).toBe(3);
  });
});

describe("toSearchOptions", () => {
  it("omits rootString when any string is allowed", () => {
    expect(toSearchOptions(DEFAULT_CONSTRAINTS)).not.toHaveProperty("rootString");
    expect(toSearchOptions({ ...DEFAULT_CONSTRAINTS, rootString: 2 })).toMatchObject({ rootString: 2, minNotes: 4 });
  });
});

describe("fretboardSelectionReducer", () => {
  it("toggles strings, frets and markers independently", () => {
    let s = fretboardSelectionReducer(EMPTY_SELECTION, { type: "toggleString", string: 2 });
    s = fretboardSelectionReducer(s, { type: "toggleFret", fret: 5 });
    s = fretboardSelectionReducer(s, { type: "toggleMarker", string: 1, fret: 3 });
    s = fretboardSelectionReducer(s, { type: "toggleMarker", string: 2, fret: 0 });
    expect(s).toEqual({ string: 2, fret: 5, markers: ["1:3", "2:0"] });
    s = fretboardSelectionReducer(s, { type: "toggleMarker", string: 1, fret: 3 });
    s = fretboardSelectionReducer(s, { type: "toggleString", string: 2 });
    expect(s).toEqual({ string: null, fret: 5, markers: ["2:0"] });
    expect(fretboardSelectionReducer(s, { type: "clear" })).toEqual(EMPTY_SELECTION);
  });
});

import { EXAMPLE_PROGRESSION, INITIAL_PROGRESSION_STATE, MAX_PROGRESSION_LENGTH, progressionReducer, progressionRequestKey } from "./progressionState";

describe("explorer comparison", () => {
  it("never compares a voicing with itself and clears comparison on new results", () => {
    let s = explorerReducer(INITIAL_EXPLORER_STATE, { type: "compareVoicing", index: 2 });
    expect(s.compareVoicing).toBe(2);
    expect(explorerReducer(s, { type: "compareVoicing", index: 0 }).compareVoicing).toBeNull();
    s = explorerReducer(s, { type: "selectVoicing", index: 2 });
    expect(s).toMatchObject({ selectedVoicing: 2, compareVoicing: null });
    s = explorerReducer({ ...s, compareVoicing: 4 }, { type: "setQuality", quality: "minor" });
    expect(s).toMatchObject({ selectedVoicing: 0, compareVoicing: null });
  });
});

describe("progressionReducer", () => {
  it("adds, reorders, edits and removes chords with stable ids", () => {
    let s = progressionReducer(INITIAL_PROGRESSION_STATE, { type: "replaceAll", chords: EXAMPLE_PROGRESSION });
    expect(s.slots.map((x) => x.root)).toEqual(["C", "G", "A", "F"]);
    const amId = s.slots[2]!.id;
    s = progressionReducer(s, { type: "move", id: amId, offset: 1 });
    expect(s.slots.map((x) => x.root)).toEqual(["C", "G", "F", "A"]);
    expect(progressionReducer(s, { type: "move", id: amId, offset: 1 })).toBe(s);
    s = progressionReducer(s, { type: "update", id: amId, patch: { quality: "minor7" } });
    expect(s.slots[3]).toMatchObject({ id: amId, root: "A", quality: "minor7" });
    s = progressionReducer(s, { type: "remove", id: s.slots[0]!.id });
    s = progressionReducer(s, { type: "add", root: "D", quality: "sus4" });
    expect(s.slots.map((x) => x.root)).toEqual(["G", "F", "A", "D"]);
    expect(new Set(s.slots.map((x) => x.id)).size).toBe(4);
  });

  it("caps the progression length", () => {
    let s = INITIAL_PROGRESSION_STATE;
    for (let i = 0; i < MAX_PROGRESSION_LENGTH + 3; i++) s = progressionReducer(s, { type: "add", root: "C", quality: "major" });
    expect(s.slots).toHaveLength(MAX_PROGRESSION_LENGTH);
  });

  it("changes the request key only when chords or settings change", () => {
    const a = progressionReducer(INITIAL_PROGRESSION_STATE, { type: "replaceAll", chords: EXAMPLE_PROGRESSION });
    const b = progressionReducer(INITIAL_PROGRESSION_STATE, { type: "replaceAll", chords: EXAMPLE_PROGRESSION });
    expect(progressionRequestKey(a)).toBe(progressionRequestKey(b));
    expect(progressionRequestKey(progressionReducer(a, { type: "setSettings", patch: { maxFret: 5 } }))).not.toBe(progressionRequestKey(a));
  });
});

import { candidatesPerChord } from "./progressionState";

describe("candidatesPerChord", () => {
  it("keeps requests within the optimize route's per-layer and total limits", () => {
    expect(candidatesPerChord(8, 4)).toBe(8);
    expect(candidatesPerChord(20, 9)).toBe(20);
    expect(candidatesPerChord(20, 10)).toBe(19);
    expect(candidatesPerChord(20, 12)).toBe(16);
    expect(candidatesPerChord(40, 1)).toBe(32);
    expect(candidatesPerChord(8, 0)).toBe(8);
  });
});
