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
