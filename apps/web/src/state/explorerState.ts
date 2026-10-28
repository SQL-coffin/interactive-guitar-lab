import type { ChordQuality } from "@/services";
import type { SpellingPreference } from "@/lib/roots";

export type LabelMode = "note" | "degree";

/** UI-facing search constraints; mapped onto the engine's VoicingSearchOptions when requested. */
export interface SearchConstraints {
  maxFret: number;
  maxFretSpan: number;
  /** Minimum sounding strings (engine `minNotes`). */
  minNotes: number;
  /** Engine (low-to-high) string number, or null for any. */
  rootString: number | null;
  requireAllTones: boolean;
  allowOpenStrings: boolean;
  limit: number;
}

export interface ExplorerState {
  root: string;
  spelling: SpellingPreference;
  quality: ChordQuality;
  constraints: SearchConstraints;
  labelMode: LabelMode;
  /** Index into the current voicing results, or null when none is pinned to the fretboard. */
  selectedVoicing: number | null;
  /** Second voicing drawn as hollow markers for side-by-side comparison. */
  compareVoicing: number | null;
}

export type ExplorerAction =
  | { type: "setRoot"; root: string }
  | { type: "setSpelling"; spelling: SpellingPreference; root: string }
  | { type: "setQuality"; quality: ChordQuality }
  | { type: "setConstraint"; patch: Partial<SearchConstraints> }
  | { type: "resetConstraints" }
  | { type: "setLabelMode"; labelMode: LabelMode }
  | { type: "selectVoicing"; index: number | null }
  | { type: "compareVoicing"; index: number | null };

export const DEFAULT_CONSTRAINTS: SearchConstraints = {
  maxFret: 12,
  maxFretSpan: 4,
  minNotes: 4,
  rootString: null,
  requireAllTones: true,
  allowOpenStrings: true,
  limit: 24,
};

export const INITIAL_EXPLORER_STATE: ExplorerState = {
  root: "C",
  spelling: "sharp",
  quality: "major",
  constraints: DEFAULT_CONSTRAINTS,
  labelMode: "degree",
  selectedVoicing: 0,
  compareVoicing: null,
};

/** New results invalidate result indexes. */
const FRESH_RESULTS = { selectedVoicing: 0, compareVoicing: null } as const;

export function explorerReducer(state: ExplorerState, action: ExplorerAction): ExplorerState {
  switch (action.type) {
    case "setRoot":
      return action.root === state.root ? state : { ...state, root: action.root, ...FRESH_RESULTS };
    case "setSpelling":
      return action.root === state.root
        ? { ...state, spelling: action.spelling }
        : { ...state, spelling: action.spelling, root: action.root, ...FRESH_RESULTS };
    case "setQuality":
      return action.quality === state.quality ? state : { ...state, quality: action.quality, ...FRESH_RESULTS };
    case "setConstraint":
      return { ...state, constraints: { ...state.constraints, ...action.patch }, ...FRESH_RESULTS };
    case "resetConstraints":
      return { ...state, constraints: DEFAULT_CONSTRAINTS, ...FRESH_RESULTS };
    case "setLabelMode":
      return { ...state, labelMode: action.labelMode };
    case "selectVoicing":
      return {
        ...state,
        selectedVoicing: action.index,
        compareVoicing: action.index !== null && action.index === state.compareVoicing ? null : state.compareVoicing,
      };
    case "compareVoicing":
      return {
        ...state,
        compareVoicing: action.index !== null && action.index === state.selectedVoicing ? null : action.index,
      };
  }
}

export function toSearchOptions(constraints: SearchConstraints) {
  return {
    maxFret: constraints.maxFret,
    maxFretSpan: constraints.maxFretSpan,
    minNotes: constraints.minNotes,
    requireAllTones: constraints.requireAllTones,
    allowOpenStrings: constraints.allowOpenStrings,
    limit: constraints.limit,
    ...(constraints.rootString === null ? {} : { rootString: constraints.rootString }),
  };
}
