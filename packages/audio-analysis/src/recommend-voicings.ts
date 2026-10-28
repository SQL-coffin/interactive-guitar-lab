import {
  getSupportedChordQualities,
  searchVoicings,
  optimizeVoicingProgression,
  type ChordQuality,
  type ProgressionOptimizationOptions,
  type ProgressionOptimizationResult,
  type Voicing,
  type VoicingSearchOptions,
} from "@interactive-guitar-lab/music-theory";
import { inferChordCandidates } from "./infer-chords.js";
import type { ChordInferenceResult, ChordInferenceOptions, ChromaFrame } from "./types.js";

export interface ChromaProgressionAnalysisOptions {
  /** Chord hypotheses retained per time window. Defaults to 3. */
  chordCandidateLimit?: number;
  /** Playable voicings retained per chord hypothesis. Defaults to 5. */
  voicingsPerChord?: number;
  /** Optional chord-family allowlist. Defaults to all engine-supported qualities. */
  chordQualities?: readonly ChordQuality[];
  /** Optional root-in-bass preference passed to the chord inference stage. */
  bassRootBonus?: number;
  /** Guitar constraints used when generating each candidate voicing. */
  voicingSearchOptions?: Omit<VoicingSearchOptions, "limit">;
  /** Joint chord-confidence, playability and transition costs. */
  progressionOptions?: ProgressionOptimizationOptions;
}

export interface ChromaProgressionAnalysisResult {
  /** Ranked chord candidates for every input frame, including silent frames. */
  frameResults: ChordInferenceResult[];
  /** Maps each optimized progression step back to its input frame index. */
  progressionFrameIndexes: number[];
  /** Silent frames are preserved in frameResults but do not force a chord choice. */
  skippedSilentFrameIndexes: number[];
  /** Null when every input frame is silent. */
  optimization: ProgressionOptimizationResult | null;
}

function validateOptions(input: ChromaProgressionAnalysisOptions): Required<
  Pick<ChromaProgressionAnalysisOptions, "chordCandidateLimit" | "voicingsPerChord" | "chordQualities" | "bassRootBonus">
> {
  const chordCandidateLimit = input.chordCandidateLimit ?? 3;
  const voicingsPerChord = input.voicingsPerChord ?? 5;
  const chordQualities = input.chordQualities ? [...input.chordQualities] : getSupportedChordQualities();
  const bassRootBonus = input.bassRootBonus ?? 0.04;
  if (!Number.isInteger(chordCandidateLimit) || chordCandidateLimit < 1 || chordCandidateLimit > 72) {
    throw new RangeError("chordCandidateLimit must be an integer from 1 to 72.");
  }
  if (!Number.isInteger(voicingsPerChord) || voicingsPerChord < 1 || voicingsPerChord > 50) {
    throw new RangeError("voicingsPerChord must be an integer from 1 to 50.");
  }
  const supported = new Set(getSupportedChordQualities());
  if (chordQualities.length === 0 || chordQualities.some((quality) => !supported.has(quality))) {
    throw new TypeError("chordQualities must contain supported chord qualities.");
  }
  if (!Number.isFinite(bassRootBonus) || bassRootBonus < 0 || bassRootBonus > 0.25) {
    throw new RangeError("bassRootBonus must be between 0 and 0.25.");
  }
  return { chordCandidateLimit, voicingsPerChord, chordQualities, bassRootBonus };
}

/**
 * Connects chroma inference to guitar voicing search and progression optimization.
 * Input frames should represent chord-scale windows (typically 0.5–2 seconds), not every STFT hop.
 */
export function analyzeChromaProgression(
  frames: readonly ChromaFrame[],
  input: ChromaProgressionAnalysisOptions = {},
): ChromaProgressionAnalysisResult {
  if (frames.length === 0) throw new RangeError("At least one chroma frame is required.");
  const options = validateOptions(input);
  const inferenceOptions: ChordInferenceOptions = {
    limit: options.chordCandidateLimit,
    qualities: options.chordQualities,
    bassRootBonus: options.bassRootBonus,
  };
  const frameResults = frames.map((frame) => inferChordCandidates(frame, inferenceOptions));
  const progressionFrameIndexes: number[] = [];
  const skippedSilentFrameIndexes: number[] = [];
  const candidateLayers: Array<Array<{ voicing: Voicing; chordConfidence: number }>> = [];
  const voicingCache = new Map<string, Voicing[]>();
  const voicingSearchOptions: VoicingSearchOptions = {
    ...(input.voicingSearchOptions ?? {}),
    limit: options.voicingsPerChord,
  };

  frameResults.forEach((frameResult, frameIndex) => {
    if (frameResult.candidates.length === 0) {
      skippedSilentFrameIndexes.push(frameIndex);
      return;
    }

    const layer: Array<{ voicing: Voicing; chordConfidence: number }> = [];
    for (const chordCandidate of frameResult.candidates) {
      const cacheKey = `${chordCandidate.root}|${chordCandidate.quality}`;
      let voicings = voicingCache.get(cacheKey);
      if (!voicings) {
        voicings = searchVoicings(
          chordCandidate.root,
          chordCandidate.quality,
          voicingSearchOptions,
        ).results;
        voicingCache.set(cacheKey, voicings);
      }
      for (const voicing of voicings) {
        layer.push({ voicing, chordConfidence: chordCandidate.confidence });
      }
    }

    if (layer.length === 0) {
      throw new RangeError(`No playable voicing candidates were found for audio frame ${frameIndex}.`);
    }
    progressionFrameIndexes.push(frameIndex);
    candidateLayers.push(layer);
  });

  if (candidateLayers.length === 0) {
    return { frameResults, progressionFrameIndexes, skippedSilentFrameIndexes, optimization: null };
  }

  return {
    frameResults,
    progressionFrameIndexes,
    skippedSilentFrameIndexes,
    optimization: optimizeVoicingProgression(candidateLayers, input.progressionOptions),
  };
}
