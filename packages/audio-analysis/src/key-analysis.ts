import type { ChromaFrame } from "./types.js";

export type MusicalKeyMode = "major" | "minor";
export type KeyAnalysisStatus = "identified" | "ambiguous" | "insufficient-evidence";
export type KeyAmbiguityKind = "relative-major-minor" | "competing-keys" | null;

export interface MusicalKeyCandidate {
  tonic: string;
  tonicPitchClass: number;
  mode: MusicalKeyMode;
  /** Human-readable name, e.g. "C major" or "A minor". */
  label: string;
  /** Pearson correlation against a rotated Krumhansl-Schmuckler profile; not a probability. */
  score: number;
}

export interface KeyAnalysisResult {
  status: KeyAnalysisStatus;
  /** One best-fit key, or multiple plausible alternatives when evidence is ambiguous. */
  candidates: MusicalKeyCandidate[];
  ambiguityKind: KeyAmbiguityKind;
  /** Difference between the best and runner-up profile scores; not a probability. */
  scoreMargin: number | null;
  evidence: {
    activeDurationSeconds: number;
    observedPitchClasses: number[];
  };
  explanation: string;
}

export interface KeyAnalysisOptions {
  /** Minimum active, non-silent duration before attempting key estimation. Defaults to 2 seconds. */
  minimumActiveDurationSeconds?: number;
  /** Relative major/minor scores this close are presented as a pair. Defaults to 0.07. */
  relativeKeyAmbiguityThreshold?: number;
  /** General competing-key score margin below which the top two candidates are both shown. Defaults to 0.035. */
  competingKeyAmbiguityThreshold?: number;
}

const PITCH_CLASS_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

// Krumhansl-Schmuckler tonal profiles. These are comparative templates, not calibrated probabilities.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88] as const;
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17] as const;
const SILENCE_EPSILON = 1e-8;
const PITCH_ACTIVITY_RATIO = 0.1;
const MINIMUM_OBSERVED_PITCH_CLASSES = 4;

function correlation(left: readonly number[], right: readonly number[]): number {
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;

  for (let index = 0; index < left.length; index += 1) {
    const centeredLeft = left[index]! - leftMean;
    const centeredRight = right[index]! - rightMean;
    covariance += centeredLeft * centeredRight;
    leftVariance += centeredLeft * centeredLeft;
    rightVariance += centeredRight * centeredRight;
  }

  const denominator = Math.sqrt(leftVariance * rightVariance);
  return denominator > 0 ? covariance / denominator : 0;
}

function makeCandidate(tonicPitchClass: number, mode: MusicalKeyMode, profile: readonly number[], pitchProfile: readonly number[]): MusicalKeyCandidate {
  const rotatedProfile = Array.from({ length: 12 }, (_, pitchClass) =>
    profile[(pitchClass - tonicPitchClass + 12) % 12]!,
  );
  const tonic = PITCH_CLASS_NAMES[tonicPitchClass]!;
  return {
    tonic,
    tonicPitchClass,
    mode,
    label: `${tonic} ${mode}`,
    score: correlation(pitchProfile, rotatedProfile),
  };
}

function insufficientEvidence(activeDurationSeconds: number, observedPitchClasses: number[]): KeyAnalysisResult {
  return {
    status: "insufficient-evidence",
    candidates: [],
    ambiguityKind: null,
    scoreMargin: null,
    evidence: { activeDurationSeconds, observedPitchClasses },
    explanation: "There isn't enough sustained, varied pitch content to estimate a key reliably.",
  };
}

/**
 * Estimates tonal-center candidates from duration-weighted chroma.
 *
 * Relative major/minor keys share a pitch collection. When their profile scores are close,
 * both are returned explicitly instead of presenting one as a certain answer. Scores are
 * correlations, not probabilities; this is a best-effort heuristic for audio analysis.
 */
export function analyzeKeyCandidates(
  frames: readonly ChromaFrame[],
  options: KeyAnalysisOptions = {},
): KeyAnalysisResult {
  const minimumActiveDurationSeconds = options.minimumActiveDurationSeconds ?? 2;
  const relativeKeyAmbiguityThreshold = options.relativeKeyAmbiguityThreshold ?? 0.07;
  const competingKeyAmbiguityThreshold = options.competingKeyAmbiguityThreshold ?? 0.035;

  if (!Number.isFinite(minimumActiveDurationSeconds) || minimumActiveDurationSeconds < 0) {
    throw new RangeError("minimumActiveDurationSeconds must be a finite non-negative number.");
  }
  for (const [name, value] of [
    ["relativeKeyAmbiguityThreshold", relativeKeyAmbiguityThreshold],
    ["competingKeyAmbiguityThreshold", competingKeyAmbiguityThreshold],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 2) {
      throw new RangeError(`${name} must be between 0 and 2.`);
    }
  }

  const pitchProfile = Array.from({ length: 12 }, () => 0);
  const observedPitchClasses = new Set<number>();
  let activeDurationSeconds = 0;

  for (const frame of frames) {
    if (frame.chroma.length !== 12
        || !Number.isFinite(frame.startSeconds)
        || !Number.isFinite(frame.endSeconds)
        || frame.endSeconds <= frame.startSeconds) {
      continue;
    }

    const chroma = frame.chroma.map((value) => Number.isFinite(value) ? Math.max(0, value) : 0);
    const energy = chroma.reduce((sum, value) => sum + value, 0);
    if (energy <= SILENCE_EPSILON) continue;

    const duration = frame.endSeconds - frame.startSeconds;
    const maximum = Math.max(...chroma);
    if (maximum <= SILENCE_EPSILON) continue;

    activeDurationSeconds += duration;
    chroma.forEach((value, pitchClass) => {
      if (value > maximum * PITCH_ACTIVITY_RATIO) observedPitchClasses.add(pitchClass);
      pitchProfile[pitchClass] = (pitchProfile[pitchClass] ?? 0) + (value / energy) * duration;
    });
  }

  const observed = [...observedPitchClasses].sort((a, b) => a - b);
  // A single triad identifies a chord, not a reliable song-level tonal center.
  if (activeDurationSeconds < minimumActiveDurationSeconds || observed.length < MINIMUM_OBSERVED_PITCH_CLASSES) {
    return insufficientEvidence(activeDurationSeconds, observed);
  }

  const allCandidates: MusicalKeyCandidate[] = [];
  for (let tonic = 0; tonic < 12; tonic += 1) {
    allCandidates.push(makeCandidate(tonic, "major", MAJOR_PROFILE, pitchProfile));
    allCandidates.push(makeCandidate(tonic, "minor", MINOR_PROFILE, pitchProfile));
  }
  allCandidates.sort((left, right) =>
    right.score - left.score
    || left.tonicPitchClass - right.tonicPitchClass
    || left.mode.localeCompare(right.mode),
  );

  const best = allCandidates[0]!;
  const runnerUp = allCandidates[1]!;
  const scoreMargin = Math.max(0, best.score - runnerUp.score);
  const relativePitchClass = best.mode === "major"
    ? (best.tonicPitchClass + 9) % 12
    : (best.tonicPitchClass + 3) % 12;
  const relativeMode: MusicalKeyMode = best.mode === "major" ? "minor" : "major";
  const relative = allCandidates.find((candidate) =>
    candidate.tonicPitchClass === relativePitchClass && candidate.mode === relativeMode,
  )!;

  if (Math.abs(best.score - relative.score) <= relativeKeyAmbiguityThreshold) {
    const candidates = [best, relative].sort((left, right) => right.score - left.score);
    return {
      status: "ambiguous",
      candidates,
      ambiguityKind: "relative-major-minor",
      scoreMargin,
      evidence: { activeDurationSeconds, observedPitchClasses: observed },
      explanation: "These relative major/minor keys share the same pitch collection. The audio does not establish one tonal center clearly enough, so both possibilities are shown.",
    };
  }

  if (scoreMargin <= competingKeyAmbiguityThreshold) {
    return {
      status: "ambiguous",
      candidates: [best, runnerUp],
      ambiguityKind: "competing-keys",
      scoreMargin,
      evidence: { activeDurationSeconds, observedPitchClasses: observed },
      explanation: "Several key profiles fit the audio similarly. The alternatives are shown instead of forcing a single key.",
    };
  }

  return {
    status: "identified",
    candidates: [best],
    ambiguityKind: null,
    scoreMargin,
    evidence: { activeDurationSeconds, observedPitchClasses: observed },
    explanation: "This is the best-fitting key profile for the analyzed pitch content. It is a heuristic estimate, not a guarantee of the song's tonal center.",
  };
}
