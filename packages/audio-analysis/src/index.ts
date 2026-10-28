export { inferChordCandidates } from "./infer-chords.js";
export { analyzeChromaProgression } from "./recommend-voicings.js";
export { analyzeAudioForChords } from "./analyze-audio.js";
export { AudioWorkerError, extractAudioFeatures } from "./worker-client.js";
export type {
  ChordCandidate,
  ChordInferenceOptions,
  ChordInferenceResult,
  ChromaFrame,
} from "./types.js";
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
