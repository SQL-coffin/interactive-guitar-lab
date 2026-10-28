import type { ChordQuality } from "@/services";

export interface ProgressionSlot {
  id: string;
  root: string;
  quality: ChordQuality;
}

export interface ProgressionSettings {
  /** Candidate voicings fetched per chord (the optimizer's layer size). */
  voicingsPerChord: number;
  maxFret: number;
  maxFretSpan: number;
  minNotes: number;
  /** Number of ranked paths requested from the optimizer. */
  pathLimit: number;
}

export interface ProgressionState {
  slots: ProgressionSlot[];
  settings: ProgressionSettings;
  nextId: number;
}

export type ProgressionAction =
  | { type: "add"; root: string; quality: ChordQuality }
  | { type: "remove"; id: string }
  | { type: "move"; id: string; offset: -1 | 1 }
  | { type: "update"; id: string; patch: Partial<Pick<ProgressionSlot, "root" | "quality">> }
  | { type: "replaceAll"; chords: ReadonlyArray<Pick<ProgressionSlot, "root" | "quality">> }
  | { type: "clear" }
  | { type: "setSettings"; patch: Partial<ProgressionSettings> };

export const MAX_PROGRESSION_LENGTH = 12;

export const DEFAULT_PROGRESSION_SETTINGS: ProgressionSettings = {
  voicingsPerChord: 8,
  maxFret: 12,
  maxFretSpan: 4,
  minNotes: 4,
  pathLimit: 3,
};

export const INITIAL_PROGRESSION_STATE: ProgressionState = {
  slots: [],
  settings: DEFAULT_PROGRESSION_SETTINGS,
  nextId: 1,
};

/** Starter content only; it is user input, not an analysis result. */
export const EXAMPLE_PROGRESSION: ReadonlyArray<Pick<ProgressionSlot, "root" | "quality">> = [
  { root: "C", quality: "major" },
  { root: "G", quality: "major" },
  { root: "A", quality: "minor" },
  { root: "F", quality: "major" },
];

export function progressionReducer(state: ProgressionState, action: ProgressionAction): ProgressionState {
  switch (action.type) {
    case "add": {
      if (state.slots.length >= MAX_PROGRESSION_LENGTH) return state;
      const slot = { id: `slot-${state.nextId}`, root: action.root, quality: action.quality };
      return { ...state, slots: [...state.slots, slot], nextId: state.nextId + 1 };
    }
    case "remove":
      return { ...state, slots: state.slots.filter((slot) => slot.id !== action.id) };
    case "move": {
      const index = state.slots.findIndex((slot) => slot.id === action.id);
      const target = index + action.offset;
      if (index < 0 || target < 0 || target >= state.slots.length) return state;
      const slots = [...state.slots];
      [slots[index], slots[target]] = [slots[target]!, slots[index]!];
      return { ...state, slots };
    }
    case "update":
      return {
        ...state,
        slots: state.slots.map((slot) => (slot.id === action.id ? { ...slot, ...action.patch } : slot)),
      };
    case "replaceAll": {
      const chords = action.chords.slice(0, MAX_PROGRESSION_LENGTH);
      return {
        ...state,
        slots: chords.map((chord, i) => ({ id: `slot-${state.nextId + i}`, root: chord.root, quality: chord.quality })),
        nextId: state.nextId + chords.length,
      };
    }
    case "clear":
      return { ...state, slots: [] };
    case "setSettings":
      return { ...state, settings: { ...state.settings, ...action.patch } };
  }
}

/** Stable identity of the request inputs, used to flag results as stale after edits. */
export function progressionRequestKey(state: Pick<ProgressionState, "slots" | "settings">): string {
  return JSON.stringify({ chords: state.slots.map(({ root, quality }) => [root, quality]), settings: state.settings });
}
