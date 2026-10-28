/**
 * Provisional frontend ⇄ backend contract.
 *
 * Every payload type is re-exported from `@interactive-guitar-lab/music-theory` (type-only)
 * so the UI cannot drift from the engine's shapes. When `packages/contracts` lands, these
 * aliases should be repointed there; the UI only imports from this module.
 *
 * The HTTP routes below are documented in `docs/frontend-api-contract.md` and are NOT yet
 * implemented by the backend.
 */
import type {
  BuiltChord,
  ChordQuality,
  ChordTone,
  FretboardPosition,
  Voicing,
  VoicingNote,
  VoicingSearchOptions,
  VoicingSearchResult,
} from "@interactive-guitar-lab/music-theory";

export type {
  BuiltChord,
  ChordQuality,
  ChordTone,
  FretboardPosition,
  Voicing,
  VoicingNote,
  VoicingSearchOptions,
  VoicingSearchResult,
};

/** GET /api/chords/qualities */
export interface ChordQualitiesResponse {
  qualities: ChordQuality[];
}

/** GET /api/chords?root=&quality= */
export interface ChordRequest {
  root: string;
  quality: ChordQuality;
}
export type ChordResponse = BuiltChord;

/** POST /api/voicings/search */
export interface VoicingSearchRequest {
  root: string;
  quality: ChordQuality;
  options?: VoicingSearchOptions;
}
export type VoicingSearchResponse = VoicingSearchResult;

/** GET /api/fretboard?maxFret=&tuning=40,45,50,55,59,64 */
export interface FretboardRequest {
  maxFret: number;
  /** Open-string MIDI pitches, low to high. Omit for standard tuning. */
  tuning?: readonly number[];
}
export interface FretboardResponse {
  tuning: number[];
  maxFret: number;
  positions: FretboardPosition[];
}

/** Error body for every non-2xx response. */
export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string };
}
export type ApiErrorCode = "invalid_request" | "not_found" | "internal_error" | "network_error";
