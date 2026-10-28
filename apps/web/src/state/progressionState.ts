import { PROGRESSION_OPTIMIZE_LIMITS, type ChordQuality } from "@/services";
import type { SlotSource } from "./lab/model";

export interface ProgressionSlot {
  id: string;
  /** The chord in use: the detected chord, or the user's correction of it. */
  root: string;
  quality: ChordQuality;
  /** Present when the chord came from an audio analysis; never modified by edits. */
  source?: SlotSource;
}

export interface ProgressionSettings {
  /** Candidate voicings fetched per chord (the optimizer's layer size). */
  voicingsPerChord: number;
  maxFret: number;
  maxFretSpan: number;
  minNotes: number;
  /** Number of ranked paths requested from the optimizer. */
  pathLimit: number;
  /** First chord of the optimized segment when the progression is longer than the optimizer allows. */
  segmentStart: number;
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
  | { type: "revert"; id: string }
  | { type: "clear" }
  | { type: "load"; slots: ProgressionSlot[]; settings?: ProgressionSettings }
  | { type: "setSettings"; patch: Partial<ProgressionSettings> };

/** A progression from a full song can be long; the optimizer works on segments of this size. */
export const MAX_OPTIMIZE_SEGMENT = PROGRESSION_OPTIMIZE_LIMITS.maxLayers;
export const MAX_PROGRESSION_LENGTH = 128;

export const DEFAULT_PROGRESSION_SETTINGS: ProgressionSettings = {
  voicingsPerChord: 8,
  maxFret: 12,
  maxFretSpan: 4,
  minNotes: 4,
  pathLimit: 3,
  segmentStart: 0,
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
    case "revert":
      return {
        ...state,
        slots: state.slots.map((slot) =>
          slot.id === action.id && slot.source
            ? { ...slot, root: slot.source.detected.root, quality: slot.source.detected.quality }
            : slot),
      };
    case "clear":
      return { ...state, slots: [], settings: { ...state.settings, segmentStart: 0 } };
    case "load": {
      const slots = action.slots.slice(0, MAX_PROGRESSION_LENGTH);
      // Re-key so ids stay unique after loading saved or extracted chords.
      return {
        settings: action.settings ?? state.settings,
        slots: slots.map((slot, i) => ({ ...slot, id: `slot-${state.nextId + i}` })),
        nextId: state.nextId + slots.length,
      };
    }
    case "setSettings":
      return { ...state, settings: { ...state.settings, ...action.patch } };
  }
}

/**
 * Candidates requested per chord so the whole optimize request stays within the server's
 * per-layer and total-candidate limits (e.g. 12 chords → at most 16 each).
 */
export function candidatesPerChord(requested: number, chordCount: number): number {
  const { maxCandidatesPerLayer, maxTotalCandidates } = PROGRESSION_OPTIMIZE_LIMITS;
  const fairShare = Math.floor(maxTotalCandidates / Math.max(1, chordCount));
  return Math.max(1, Math.min(requested, maxCandidatesPerLayer, fairShare));
}

/** The chords the optimizer runs on: all of them, or a MAX_OPTIMIZE_SEGMENT-long window. */
export function optimizeSegment(state: Pick<ProgressionState, "slots" | "settings">): { start: number; slots: ProgressionSlot[] } {
  const maxStart = Math.max(0, state.slots.length - MAX_OPTIMIZE_SEGMENT);
  const start = Math.min(Math.max(0, state.settings.segmentStart), maxStart);
  return { start, slots: state.slots.slice(start, start + MAX_OPTIMIZE_SEGMENT) };
}

/** Stable identity of the request inputs, used to flag results as stale after edits. */
export function progressionRequestKey(state: Pick<ProgressionState, "slots" | "settings">): string {
  const { start, slots } = optimizeSegment(state);
  return JSON.stringify({ chords: slots.map(({ root, quality }) => [root, quality]), start, settings: state.settings });
}
