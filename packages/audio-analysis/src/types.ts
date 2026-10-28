import type { ChordQuality } from "@interactive-guitar-lab/music-theory";

export interface ChromaFrame {
  startSeconds: number;
  endSeconds: number;
  /** Non-negative chroma energies ordered C, C#, D, D#, E, F, F#, G, G#, A, A#, B. */
  chroma: readonly number[];
  /** Optional bass estimate as pitch class 0-11 from the feature extractor. */
  bassPitchClass?: number;
}

export interface ChordInferenceOptions {
  /** Number of candidates to return. Defaults to 5. */
  limit?: number;
  /** Candidate chord families. Defaults to all qualities supported by music-theory. */
  qualities?: readonly ChordQuality[];
  /** Small ranking bonus when the detected bass agrees with the chord root. Defaults to 0.04. */
  bassRootBonus?: number;
}

export interface ChordCandidate {
  symbol: string;
  root: string;
  rootPitchClass: number;
  quality: ChordQuality;
  /** Cosine-style fit to the detected chroma; this is not a calibrated probability. */
  confidence: number;
  /** Ranking score including any bass-root preference. */
  score: number;
  evidence: {
    chordToneEnergy: number;
    nonChordEnergy: number;
    activePitchClasses: number[];
    matchedPitchClasses: number[];
    bassRootMatch: boolean | null;
  };
}

export interface ChordInferenceResult {
  candidates: ChordCandidate[];
  /** Preserved input window so the caller can align results with the audio timeline. */
  startSeconds: number;
  endSeconds: number;
}
