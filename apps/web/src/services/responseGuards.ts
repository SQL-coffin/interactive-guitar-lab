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


const isPitchClass = (value: unknown): boolean => Number.isInteger(value) && Number(value) >= 0 && Number(value) < 12;
const isPitchClassList = (value: unknown): boolean => Array.isArray(value) && value.every(isPitchClass);
const isStringList = (value: unknown): boolean => Array.isArray(value) && value.every((item) => typeof item === "string");

function isKeyCandidate(candidate: unknown): boolean {
  return isRecord(candidate)
    && typeof candidate.tonic === "string"
    && isPitchClass(candidate.tonicPitchClass)
    && (candidate.mode === "major" || candidate.mode === "minor")
    && typeof candidate.label === "string"
    && isNumber(candidate.score);
}

function isKeyAnalysisResult(value: unknown): boolean {
  if (!isRecord(value)
      || !["identified", "ambiguous", "insufficient-evidence"].includes(String(value.status))
      || !Array.isArray(value.candidates)
      || typeof value.explanation !== "string"
      || !(value.scoreMargin === null || isNumber(value.scoreMargin))
      || !(value.ambiguityKind === null
        || value.ambiguityKind === "relative-major-minor"
        || value.ambiguityKind === "competing-keys")
      || !isRecord(value.evidence)
      || !isNumber(value.evidence.activeDurationSeconds)
      || !Array.isArray(value.evidence.observedPitchClasses)
      || !value.evidence.observedPitchClasses.every((pitchClass) => Number.isInteger(pitchClass) && pitchClass >= 0 && pitchClass < 12)) {
    return false;
  }
  return value.candidates.every(isKeyCandidate);
}

/*
 * keyChangeDetection is optional: sessions saved before it existed omit it. When present it
 * must be well formed, because the Key changes panel renders every event field it carries.
 */
function isKeyChangeEvent(value: unknown): boolean {
  if (!isRecord(value)
      || !isNumber(value.timeSeconds)
      || !isRecord(value.transitionWindow)
      || !isNumber(value.transitionWindow.startSeconds)
      || !isNumber(value.transitionWindow.endSeconds)
      || !Array.isArray(value.beforeCandidates) || !value.beforeCandidates.every(isKeyCandidate)
      || !Array.isArray(value.afterCandidates) || !value.afterCandidates.every(isKeyCandidate)
      || !["possible", "uncertain"].includes(String(value.status))
      || !["possible-modulation", "local-tonicization-or-modulation", "uncertain"].includes(String(value.interpretation))
      || !["low", "moderate", "high"].includes(String(value.confidence))
      || !isNumber(value.confidenceScore)
      || typeof value.explanation !== "string"
      || !isRecord(value.evidence)) {
    return false;
  }
  const evidence = value.evidence;
  return isNumber(evidence.beforeWindowCount)
    && isNumber(evidence.afterWindowCount)
    && isNumber(evidence.persistentAfterSeconds)
    && isPitchClassList(evidence.observedPitchClassesBefore)
    && isPitchClassList(evidence.observedPitchClassesAfter)
    && (evidence.bassSupportBefore === null || isPitchClass(evidence.bassSupportBefore))
    && (evidence.bassSupportAfter === null || isPitchClass(evidence.bassSupportAfter))
    && isStringList(evidence.topChordsBefore)
    && isStringList(evidence.topChordsAfter);
}

function isKeyChangeWindow(value: unknown): boolean {
  return isRecord(value)
    && isNumber(value.startSeconds)
    && isNumber(value.endSeconds)
    && Array.isArray(value.candidates) && value.candidates.every(isKeyCandidate)
    && (value.leadingCandidate === null || isKeyCandidate(value.leadingCandidate))
    && (value.scoreMargin === null || isNumber(value.scoreMargin));
}

function isKeyChangeDetectionResult(value: unknown): boolean {
  return isRecord(value)
    && ["detected", "no-clear-change", "insufficient-evidence"].includes(String(value.status))
    && isNumber(value.windowSeconds)
    && isNumber(value.hopSeconds)
    && typeof value.explanation === "string"
    && Array.isArray(value.windows) && value.windows.every(isKeyChangeWindow)
    && Array.isArray(value.events) && value.events.every(isKeyChangeEvent);
}

export function isAudioAnalysisResponse(value: unknown): value is AudioAnalysisResponse {
  if (!isRecord(value) || !isRecord(value.audio) || !isRecord(value.chordAnalysis)) return false;
  const { audio, chordAnalysis } = value;
  return (value.keyAnalysis === undefined || isKeyAnalysisResult(value.keyAnalysis))
    && (value.keyChangeDetection === undefined || isKeyChangeDetectionResult(value.keyChangeDetection))
    && isNumber(audio.durationSeconds)
    && isNumber(audio.windowSeconds)
    && isRecord(audio.rhythm)
    && Array.isArray(audio.rhythm.beatTimesSeconds)
    && Array.isArray(chordAnalysis.frameResults)
    && Array.isArray(chordAnalysis.progressionFrameIndexes)
    && Array.isArray(chordAnalysis.skippedSilentFrameIndexes)
    && (chordAnalysis.optimization === null
      || (isRecord(chordAnalysis.optimization) && Array.isArray(chordAnalysis.optimization.results)));
}
