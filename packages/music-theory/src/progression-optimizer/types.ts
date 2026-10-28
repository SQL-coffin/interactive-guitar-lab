import type { Voicing } from "../voicings/index.js";

export interface ProgressionOptimizationOptions {
  /** Number of distinct candidate sequences to return. Defaults to 5. */
  limit?: number;
  /** Weight applied to each layer-normalized ergonomic voicing penalty. Defaults to 0.1. */
  localScoreWeight?: number;
  /** Penalty weight for low-confidence audio chord hypotheses. Defaults to 20.0. */
  chordConfidenceWeight?: number;
  /** Penalty per fret of hand-position movement. Defaults to 1.2. */
  positionShiftWeight?: number;
  /** Penalty per fret change on a string sounding in both chords. Defaults to 0.35. */
  stringMovementWeight?: number;
  /** Penalty when a string changes between muted and sounding. Defaults to 1.1. */
  muteChangeWeight?: number;
  /** Penalty per semitone of lowest-note movement. Defaults to 0.15. */
  bassMovementWeight?: number;
}

/**
 * Wraps a voicing with an optional audio-derived chord fit. Confidence is a ranking signal,
 * not a calibrated probability; 1 means best fit among hypotheses and 0 means no support.
 */
export interface ProgressionVoicingCandidate {
  voicing: Voicing;
  chordConfidence?: number;
  /** Combined ranking score (for example, chroma fit plus bass agreement). Defaults to confidence. */
  candidateScore?: number;
}

/** Raw Voicing input remains supported for known chord progressions. */
export type ProgressionCandidateInput = Voicing | ProgressionVoicingCandidate;

export interface OptimizedVoicingStep {
  chordSymbol: string;
  /** Index of the chosen candidate in the corresponding input layer. */
  candidateIndex: number;
  voicing: Voicing;
  chordConfidence: number;
  candidateScore: number;
  chordPenalty: number;
  localCost: number;
  transitionCost: number;
  cumulativeCost: number;
}

export interface OptimizedVoicingProgression {
  steps: OptimizedVoicingStep[];
  totalCost: number;
}

export interface ProgressionOptimizationResult {
  results: OptimizedVoicingProgression[];
  candidateCounts: number[];
  /** Number of partial paths evaluated while constructing the k-best result. */
  pathExtensionsEvaluated: number;
  options: Required<ProgressionOptimizationOptions>;
}
