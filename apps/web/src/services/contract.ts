/**
 * Provisional frontend ⇄ backend contract.
 *
 * Every payload type is re-exported from the engine packages (type-only) so the UI cannot drift
 * from the engine's shapes. When packages/contracts lands, these aliases should be repointed there.
 */
import type {
  AnalyzeAudioForChordsResult,
  ChordCandidate,
  ChordInferenceResult,
  ChromaProgressionAnalysisOptions,
  ChromaProgressionAnalysisResult,
} from "@interactive-guitar-lab/audio-analysis";
import type {
  OptimizedVoicingProgression,
  OptimizedVoicingStep,
  ProgressionCandidateInput,
  ProgressionOptimizationOptions,
  ProgressionOptimizationResult,
} from "@interactive-guitar-lab/music-theory";
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
  AnalyzeAudioForChordsResult,
  ChordCandidate,
  ChordInferenceResult,
  ChromaProgressionAnalysisOptions,
  ChromaProgressionAnalysisResult,
  OptimizedVoicingProgression,
  OptimizedVoicingStep,
  ProgressionCandidateInput,
  ProgressionOptimizationOptions,
  ProgressionOptimizationResult,
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

/** POST /api/audio-analysis (multipart/form-data). */
export interface AudioAnalysisRequest {
  file: Blob;
  /** Upload filename; defaults to the File's own name. */
  filename?: string;
  /** Analysis window length, 0.1–2.0 seconds. */
  windowSeconds?: number;
  /** Sent as the JSON-encoded `options` form field. */
  options?: ChromaProgressionAnalysisOptions;
}
export type AudioAnalysisResponse = AnalyzeAudioForChordsResult;

/** POST /api/progressions/optimize */
export interface ProgressionOptimizationRequest {
  /** One layer per chord slot; each layer holds that chord's candidate voicings. */
  layers: ReadonlyArray<ReadonlyArray<ProgressionCandidateInput>>;
  options?: ProgressionOptimizationOptions;
}
export type ProgressionOptimizationResponse = ProgressionOptimizationResult;

/** Error body for every non-2xx response. */
export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string };
}
export type ApiErrorCode = "invalid_request" | "not_found" | "internal_error" | "network_error";
