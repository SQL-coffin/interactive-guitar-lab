export { inferChordCandidates } from "./infer-chords.js";
export { analyzeChromaProgression } from "./recommend-voicings.js";
export { buildChordSheet } from "./chord-sheet.js";
export { suggestChordSheetRefinements } from "./chord-sheet-refinement.js";
export type { ChordSheetRefinementOptions, ChordSheetRefinementSuggestion } from "./chord-sheet-refinement.js";
export { analyzeAudioForChords } from "./analyze-audio.js";
export { analyzeKeyCandidates } from "./key-analysis.js";
export { detectKeyChanges } from "./key-change-detection.js";
export type { KeyChangeConfidence, KeyChangeDetectionOptions, KeyChangeDetectionResult, KeyChangeEvent, KeyChangeInterpretation, KeyChangeStatus, KeyChangeWindow } from "./key-change-detection.js";
export type { KeyAnalysisOptions, KeyAnalysisResult, KeyAnalysisStatus, KeyAmbiguityKind, MusicalKeyCandidate, MusicalKeyMode } from "./key-analysis.js";
export { AudioWorkerError, extractAudioFeatures } from "./worker-client.js";
export {
  AUDIO_ANALYSIS_LIMITS,
  AudioAnalysisBudgetError,
  DEFAULT_AUDIO_PROGRESSION_LIMIT,
  estimateOptimizerWork,
} from "./budget.js";
export type {
  ChordCandidate,
  ChordInferenceOptions,
  ChordInferenceResult,
  ChromaFrame,
} from "./types.js";
export type { ChordSheetEvent, ChordSheetOptions, ChordSheetResult } from "./chord-sheet.js";
export type {
  ChromaProgressionAnalysisOptions,
  ChromaProgressionAnalysisResult,
} from "./recommend-voicings.js";
export type {
  AudioFeatureResponse,
  AudioWorkerClientOptions,
} from "./worker-client.js";
export type {
  AnalyzeAudioForChordsOptions,
  AnalyzeAudioForChordsResult,
} from "./analyze-audio.js";
