/**
 * Work budget for audio-to-fingering analysis.
 *
 * The progression optimizer copies each partial path when extending it, so its cost grows with
 * frames² × candidatesPerFrame² × pathLimit. Measured on the reference dev container:
 * 600 frames × 15 candidates × limit 3 ≈ 1.4 s; 1,200 × 15 × 3 (4.9e8 units) ≈ 3.4 s;
 * 1,200 × 30 × 10 ≈ 62 s. These limits keep the worst accepted request at roughly 4–5 s while
 * leaving the UI defaults (3 hypotheses × 5 voicings, 3 paths) valid at every UI window size
 * (0.5, 1 and 2 s) for the worker's full 600-second maximum.
 */
export const AUDIO_ANALYSIS_LIMITS = {
  /** chordCandidateLimit × voicingsPerChord: the upper bound on optimizer candidates per frame. */
  maxCandidatesPerFrame: 30,
  /** Ranked fingering paths for audio analysis (the standalone progression route allows 20). */
  maxProgressionLimit: 10,
  /** Analysis windows, e.g. 600 s at 0.5 s windows. */
  maxFrames: 1_200,
  /** Upper bound of frames² × candidatesPerFrame² × pathLimit / 2 (path-copy operations). */
  maxOptimizerWork: 5e8,
} as const;

/** Default optimizer path limit when progressionOptions.limit is omitted. */
export const DEFAULT_AUDIO_PROGRESSION_LIMIT = 5;

/**
 * The request is valid but larger than the analysis budget (HTTP 413). Extends RangeError so
 * callers that only distinguish validation errors still reject it rather than failing as a 500.
 */
export class AudioAnalysisBudgetError extends RangeError {
  readonly statusCode = 413;

  constructor(message: string) {
    super(message);
    this.name = "AudioAnalysisBudgetError";
  }
}

export function estimateOptimizerWork(frames: number, candidatesPerFrame: number, pathLimit: number): number {
  return (frames * frames * candidatesPerFrame * candidatesPerFrame * pathLimit) / 2;
}

/** Cheap checks on the requested options; run before any audio is processed. */
export function assertAnalysisOptionsWithinBudget(candidatesPerFrame: number, pathLimit: number): void {
  if (candidatesPerFrame > AUDIO_ANALYSIS_LIMITS.maxCandidatesPerFrame) {
    throw new RangeError(
      `chordCandidateLimit × voicingsPerChord must be at most ${AUDIO_ANALYSIS_LIMITS.maxCandidatesPerFrame} (requested ${candidatesPerFrame}).`,
    );
  }
  if (!Number.isInteger(pathLimit) || pathLimit < 1 || pathLimit > AUDIO_ANALYSIS_LIMITS.maxProgressionLimit) {
    throw new RangeError(`progressionOptions.limit must be an integer from 1 to ${AUDIO_ANALYSIS_LIMITS.maxProgressionLimit} for audio analysis.`);
  }
}

/** Runs once the frame count is known, before voicing search and optimization start. */
export function assertFramesWithinBudget(frames: number, candidatesPerFrame: number, pathLimit: number): void {
  if (frames > AUDIO_ANALYSIS_LIMITS.maxFrames) {
    throw new AudioAnalysisBudgetError(
      `The recording produced ${frames} analysis windows; the limit is ${AUDIO_ANALYSIS_LIMITS.maxFrames}. Use a longer windowSeconds or a shorter recording.`,
    );
  }
  const work = estimateOptimizerWork(frames, candidatesPerFrame, pathLimit);
  if (work > AUDIO_ANALYSIS_LIMITS.maxOptimizerWork) {
    throw new AudioAnalysisBudgetError(
      `This analysis is too large (${frames} windows × ${candidatesPerFrame} candidates × ${pathLimit} paths). Use a longer windowSeconds, fewer chord hypotheses or voicings, fewer paths, or a shorter recording.`,
    );
  }
}
