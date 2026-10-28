export interface FretboardSelection {
  /** Highlighted string (engine numbering), if any. */
  string: number | null;
  /** Highlighted fret column, if any. */
  fret: number | null;
  /** User-placed note markers, as "string:fret" keys, in placement order. */
  markers: string[];
}

export type FretboardSelectionAction =
  | { type: "toggleString"; string: number }
  | { type: "toggleFret"; fret: number }
  | { type: "toggleMarker"; string: number; fret: number }
  | { type: "clear" };

export const EMPTY_SELECTION: FretboardSelection = { string: null, fret: null, markers: [] };

export function markerKey(string: number, fret: number): string {
  return `${string}:${fret}`;
}

export function parseMarkerKey(key: string): { string: number; fret: number } {
  const [string, fret] = key.split(":").map(Number);
  return { string: string ?? 0, fret: fret ?? 0 };
}

export function fretboardSelectionReducer(state: FretboardSelection, action: FretboardSelectionAction): FretboardSelection {
  switch (action.type) {
    case "toggleString":
      return { ...state, string: state.string === action.string ? null : action.string };
    case "toggleFret":
      return { ...state, fret: state.fret === action.fret ? null : action.fret };
    case "toggleMarker": {
      const key = markerKey(action.string, action.fret);
      return {
        ...state,
        markers: state.markers.includes(key) ? state.markers.filter((k) => k !== key) : [...state.markers, key],
      };
    }
    case "clear":
      return EMPTY_SELECTION;
  }
}
