import {
  buildChord,
  getSupportedChordQualities,
  type ChordQuality,
} from "@interactive-guitar-lab/music-theory";
import type {
  ChordCandidate,
  ChordInferenceOptions,
  ChordInferenceResult,
  ChromaFrame,
} from "./types.js";

const ROOT_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const DEFAULT_LIMIT = 5;
const DEFAULT_BASS_ROOT_BONUS = 0.04;
const ACTIVE_PITCH_RELATIVE_THRESHOLD = 0.15;

function validateFrame(frame: ChromaFrame): number[] {
  if (!Number.isFinite(frame.startSeconds) || !Number.isFinite(frame.endSeconds)
      || frame.startSeconds < 0 || frame.endSeconds < frame.startSeconds) {
    throw new RangeError("Chroma frame requires valid non-negative start and end timestamps.");
  }
  if (frame.chroma.length !== 12) {
    throw new TypeError("Chroma frame must contain exactly 12 pitch-class energies.");
  }
  const values = [...frame.chroma];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new RangeError("Chroma values must be finite non-negative numbers.");
  }
  if (frame.bassPitchClass !== undefined
      && (!Number.isInteger(frame.bassPitchClass) || frame.bassPitchClass < 0 || frame.bassPitchClass > 11)) {
    throw new RangeError("bassPitchClass must be an integer from 0 to 11.");
  }
  return values;
}

function validateOptions(input: ChordInferenceOptions): Required<ChordInferenceOptions> {
  const qualities = input.qualities ? [...input.qualities] : getSupportedChordQualities();
  const supported = new Set(getSupportedChordQualities());
  if (qualities.length === 0 || qualities.some((quality) => !supported.has(quality))) {
    throw new TypeError("At least one supported chord quality must be selected.");
  }
  if (new Set(qualities).size !== qualities.length) {
    throw new TypeError("Chord qualities must not contain duplicates.");
  }
  const limit = input.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > 72) {
    throw new RangeError("limit must be an integer from 1 to 72.");
  }
  const bassRootBonus = input.bassRootBonus ?? DEFAULT_BASS_ROOT_BONUS;
  if (!Number.isFinite(bassRootBonus) || bassRootBonus < 0 || bassRootBonus > 0.25) {
    throw new RangeError("bassRootBonus must be between 0 and 0.25.");
  }
  return { limit, qualities, bassRootBonus };
}

/**
 * Ranks the supported chord templates against one 12-bin chroma window.
 * This is an interpretable MVP baseline; model-derived features can later replace chroma
 * extraction without changing the candidate/evidence contract.
 */
export function inferChordCandidates(
  frame: ChromaFrame,
  input: ChordInferenceOptions = {},
): ChordInferenceResult {
  const chroma = validateFrame(frame);
  const options = validateOptions(input);
  const vectorNorm = Math.sqrt(chroma.reduce((sum, value) => sum + value * value, 0));
  if (vectorNorm === 0) {
    return { candidates: [], startSeconds: frame.startSeconds, endSeconds: frame.endSeconds };
  }

  const maxValue = Math.max(...chroma);
  const activePitchClasses = chroma
    .map((value, pitchClass) => value >= maxValue * ACTIVE_PITCH_RELATIVE_THRESHOLD ? pitchClass : -1)
    .filter((pitchClass) => pitchClass >= 0);
  const totalEnergy = chroma.reduce((sum, value) => sum + value, 0);
  const candidates: ChordCandidate[] = [];

  for (let rootPitchClass = 0; rootPitchClass < ROOT_NAMES.length; rootPitchClass++) {
    const root = ROOT_NAMES[rootPitchClass]!;
    for (const quality of options.qualities) {
      const chord = buildChord(root, quality);
      const tonePitchClasses = new Set(chord.tones.map((tone) => tone.pitchClass));
      const selectedEnergy = [...tonePitchClasses].reduce((sum, pitchClass) => sum + chroma[pitchClass]!, 0);
      const dotProduct = [...tonePitchClasses].reduce((sum, pitchClass) => sum + chroma[pitchClass]!, 0);
      const templateNorm = Math.sqrt(tonePitchClasses.size);
      const confidence = Math.max(0, Math.min(1, dotProduct / (vectorNorm * templateNorm)));
      const nonChordEnergy = Math.max(0, totalEnergy - selectedEnergy);
      const bassRootMatch = frame.bassPitchClass === undefined
        ? null
        : frame.bassPitchClass === rootPitchClass;
      const score = Math.min(1, confidence + (bassRootMatch ? options.bassRootBonus : 0));
      candidates.push({
        symbol: chord.symbol,
        root,
        rootPitchClass,
        quality,
        confidence,
        score,
        evidence: {
          chordToneEnergy: totalEnergy === 0 ? 0 : selectedEnergy / totalEnergy,
          nonChordEnergy,
          activePitchClasses,
          matchedPitchClasses: activePitchClasses.filter((pitchClass) => tonePitchClasses.has(pitchClass)),
          bassRootMatch,
        },
      });
    }
  }

  const qualityOrder = new Map<ChordQuality, number>(
    getSupportedChordQualities().map((quality, index) => [quality, index]),
  );
  candidates.sort((a, b) => b.score - a.score
    || b.confidence - a.confidence
    || a.rootPitchClass - b.rootPitchClass
    || qualityOrder.get(a.quality)! - qualityOrder.get(b.quality)!);

  return {
    candidates: candidates.slice(0, options.limit),
    startSeconds: frame.startSeconds,
    endSeconds: frame.endSeconds,
  };
}
