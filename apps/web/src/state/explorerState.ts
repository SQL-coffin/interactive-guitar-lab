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
}

export type ExplorerAction =
  | { type: "setRoot"; root: string }
  | { type: "setSpelling"; spelling: SpellingPreference; root: string }
  | { type: "setQuality"; quality: ChordQuality }
  | { type: "setConstraint"; patch: Partial<SearchConstraints> }
  | { type: "resetConstraints" }
  | { type: "setLabelMode"; labelMode: LabelMode }
  | { type: "selectVoicing"; index: number | null };

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
};

export function explorerReducer(state: ExplorerState, action: ExplorerAction): ExplorerState {
  switch (action.type) {
    case "setRoot":
      return action.root === state.root ? state : { ...state, root: action.root, selectedVoicing: 0 };
    case "setSpelling":
      return { ...state, spelling: action.spelling, root: action.root, selectedVoicing: action.root === state.root ? state.selectedVoicing : 0 };
    case "setQuality":
      return action.quality === state.quality ? state : { ...state, quality: action.quality, selectedVoicing: 0 };
    case "setConstraint":
      return { ...state, constraints: { ...state.constraints, ...action.patch }, selectedVoicing: 0 };
    case "resetConstraints":
      return { ...state, constraints: DEFAULT_CONSTRAINTS, selectedVoicing: 0 };
    case "setLabelMode":
      return { ...state, labelMode: action.labelMode };
    case "selectVoicing":
      return { ...state, selectedVoicing: action.index };
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
