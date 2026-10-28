import type {
  AudioAnalysisResponse,
  ChordQualitiesResponse,
  ChordResponse,
  FretboardResponse,
  ProgressionOptimizationResponse,
  VoicingSearchResponse,
} from "./contract";

/*
 * Structural checks on untrusted HTTP JSON. They verify the fields the UI relies on, so a
 * contract drift surfaces as a clear error instead of a crash deep inside a component.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function isChordQualitiesResponse(value: unknown): value is ChordQualitiesResponse {
  return isRecord(value) && Array.isArray(value.qualities) && value.qualities.every((q) => typeof q === "string");
}

export function isChordResponse(value: unknown): value is ChordResponse {
  return isRecord(value) && typeof value.symbol === "string" && Array.isArray(value.tones) && Array.isArray(value.formula);
}

export function isVoicingSearchResponse(value: unknown): value is VoicingSearchResponse {
  return isRecord(value) && isChordResponse(value.chord) && Array.isArray(value.results) && isNumber(value.totalFound);
}

export function isFretboardResponse(value: unknown): value is FretboardResponse {
  return isRecord(value) && Array.isArray(value.tuning) && isNumber(value.maxFret) && Array.isArray(value.positions);
}

export function isProgressionOptimizationResponse(value: unknown): value is ProgressionOptimizationResponse {
  if (!isRecord(value)
      || !Array.isArray(value.results)
      || !Array.isArray(value.candidateCounts)
      || !value.candidateCounts.every(isNumber)
      || !isNumber(value.pathExtensionsEvaluated)
      || !isRecord(value.options)) {
    return false;
  }
  const options = value.options;
  if (!["limit", "localScoreWeight", "chordConfidenceWeight", "positionShiftWeight", "stringMovementWeight",
    "muteChangeWeight", "bassMovementWeight"].every((key) => isNumber(options[key]))) {
    return false;
  }
  return value.results.every((result) =>
    isRecord(result)
    && isNumber(result.totalCost)
    && Array.isArray(result.steps)
    && result.steps.every((step) =>
      isRecord(step)
      && typeof step.chordSymbol === "string"
      && isNumber(step.candidateIndex)
      && isRecord(step.voicing)
      && isNumber(step.chordConfidence)
      && isNumber(step.candidateScore)
      && isNumber(step.chordPenalty)
      && isNumber(step.localCost)
      && isNumber(step.transitionCost)
      && isNumber(step.cumulativeCost),
    ),
  );
}

export function isAudioAnalysisResponse(value: unknown): value is AudioAnalysisResponse {
  if (!isRecord(value) || !isRecord(value.audio) || !isRecord(value.chordAnalysis)) return false;
  const { audio, chordAnalysis } = value;
  return isNumber(audio.durationSeconds)
    && isNumber(audio.windowSeconds)
    && isRecord(audio.rhythm)
    && Array.isArray(audio.rhythm.beatTimesSeconds)
    && Array.isArray(chordAnalysis.frameResults)
    && Array.isArray(chordAnalysis.progressionFrameIndexes)
    && Array.isArray(chordAnalysis.skippedSilentFrameIndexes)
    && (chordAnalysis.optimization === null
      || (isRecord(chordAnalysis.optimization) && Array.isArray(chordAnalysis.optimization.results)));
}
