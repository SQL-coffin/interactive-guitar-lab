import type { ChordCandidate, ChordInferenceResult } from "./types.js";
import { suggestChordSheetRefinements, type ChordSheetRefinementSuggestion } from "./chord-sheet-refinement.js";

export interface ChordSheetOptions {
  /** Maximum gap accepted when joining adjacent windows with the same top chord. */
  continuityToleranceSeconds?: number;
  /** Estimated beat timestamps in seconds from the audio feature worker. */
  beatTimesSeconds?: readonly number[];
  /** Estimated tempo, used only as a fallback when beat timestamps are absent. */
  tempoBpm?: number | null;
  /** Beats per bar; defaults to 4 for direct/legacy callers, null when meter is unknown. */
  beatsPerBar?: number | null;
  timeSignatureNumerator?: number | null;
  timeSignatureDenominator?: number | null;
  meterConfidence?: number | null;
  /** Measured bar duration in seconds; null when meter is unknown. */
  barDurationSeconds?: number | null;
  /** Estimated downbeat timestamps; empty when meter is unknown. */
  downbeatTimesSeconds?: readonly number[];
  /** First bar number, if the downbeat grid is known. Defaults to 1. */
  firstBarNumber?: number;
}

export interface ChordSheetEvent {
  chordSymbol: string;
  root: string;
  quality: ChordCandidate["quality"];
  startSeconds: number;
  endSeconds: number;
  meanConfidence: number;
  meanScore: number;
  sourceFrameIndexes: number[];
  startBeat: number | null;
  endBeat: number | null;
  startBar: number | null;
  endBar: number | null;
  /** Zero-based beat index inside the bar, or null when timing is unavailable. */
  beatInBar: number | null;
}

export interface ChordSheetResult {
  schemaVersion: "1.2";
  events: ChordSheetEvent[];
  /** Non-destructive review suggestions; raw chord events remain unchanged. */
  refinementSuggestions: ChordSheetRefinementSuggestion[];
  sourceWindowCount: number;
  skippedWindowIndexes: number[];
  rhythm: {
    /** Null when the meter detector cannot distinguish a reliable bar grouping. */
    beatsPerBar: number | null;
    beatTimesSeconds: number[];
    downbeatTimesSeconds: number[];
    tempoBpm: number | null;
    timeSignatureNumerator: number | null;
    timeSignatureDenominator: number | null;
    /** Heuristic meter separation score, not a calibrated probability. */
    meterConfidence: number | null;
    /** Measured duration of one bar in seconds; null when meter is unknown. */
    barDurationSeconds: number | null;
    timingSource: "beat-detection" | "tempo-estimate" | "unavailable";
  };
}

const DEFAULT_CONTINUITY_TOLERANCE_SECONDS = 0.03;
const BEAT_MATCH_TOLERANCE_SECONDS = 0.2;

/** Convert analysis windows into chord events and attach conservative beat/bar positions. */
export function buildChordSheet(
  frameResults: readonly ChordInferenceResult[],
  input: ChordSheetOptions = {},
): ChordSheetResult {
  const tolerance = input.continuityToleranceSeconds ?? DEFAULT_CONTINUITY_TOLERANCE_SECONDS;
  const beatsPerBar = input.beatsPerBar === undefined ? 4 : input.beatsPerBar;
  const firstBarNumber = input.firstBarNumber ?? 1;
  const timeSignatureNumerator = input.timeSignatureNumerator ?? null;
  const timeSignatureDenominator = input.timeSignatureDenominator ?? null;
  const meterConfidence = input.meterConfidence ?? null;
  const downbeatTimesSeconds = [...(input.downbeatTimesSeconds ?? [])];
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 0.25) {
    throw new RangeError("continuityToleranceSeconds must be between 0 and 0.25.");
  }
  if (beatsPerBar !== null && (!Number.isInteger(beatsPerBar) || beatsPerBar < 1 || beatsPerBar > 12)) {
    throw new RangeError("beatsPerBar must be null or an integer from 1 to 12.");
  }
  if (!Number.isInteger(firstBarNumber) || firstBarNumber < 1) {
    throw new RangeError("firstBarNumber must be a positive integer.");
  }
  if ((timeSignatureNumerator === null) !== (timeSignatureDenominator === null)) {
    throw new RangeError("Time signature numerator and denominator must both be known or both be null.");
  }
  if (timeSignatureNumerator !== null
      && (!Number.isInteger(timeSignatureNumerator) || timeSignatureNumerator < 1 || timeSignatureNumerator > 12)) {
    throw new RangeError("timeSignatureNumerator must be an integer from 1 to 12 or null.");
  }
  if (timeSignatureDenominator !== null && ![2, 4, 8, 16].includes(timeSignatureDenominator)) {
    throw new RangeError("timeSignatureDenominator must be 2, 4, 8, 16 or null.");
  }
  if (meterConfidence !== null && (!Number.isFinite(meterConfidence) || meterConfidence < 0 || meterConfidence > 1)) {
    throw new RangeError("meterConfidence must be between 0 and 1 or null.");
  }
  if (input.barDurationSeconds != null
      && (!Number.isFinite(input.barDurationSeconds) || input.barDurationSeconds <= 0)) {
    throw new RangeError("barDurationSeconds must be positive and finite or null.");
  }

  const suppliedBeats = input.beatTimesSeconds ?? [];
  if (suppliedBeats.some((beat) => !Number.isFinite(beat) || beat < 0)
      || suppliedBeats.some((beat, i) => i > 0 && beat <= suppliedBeats[i - 1]!)) {
    throw new RangeError("beatTimesSeconds must be finite, non-negative, and strictly increasing.");
  }
  if (downbeatTimesSeconds.some((beat) => !Number.isFinite(beat) || beat < 0)
      || downbeatTimesSeconds.some((beat, i) => i > 0 && beat <= downbeatTimesSeconds[i - 1]!)) {
    throw new RangeError("downbeatTimesSeconds must be finite, non-negative, and strictly increasing.");
  }
  if ((timeSignatureNumerator !== null) !== (downbeatTimesSeconds.length > 0)) {
    throw new RangeError("A known time signature must include downbeats, and unknown meter must not include them.");
  }
  const tempoBpm = input.tempoBpm ?? null;
  if (tempoBpm !== null && (!Number.isFinite(tempoBpm) || tempoBpm <= 0)) {
    throw new RangeError("tempoBpm must be a positive finite number or null.");
  }
  const barDurationSeconds = input.barDurationSeconds
    ?? (tempoBpm !== null && beatsPerBar !== null ? (60 / tempoBpm) * beatsPerBar : null);

  let timingSource: ChordSheetResult["rhythm"]["timingSource"] = "unavailable";
  let beatTimesSeconds = [...suppliedBeats];
  if (beatTimesSeconds.length >= 2) {
    timingSource = "beat-detection";
  } else if (tempoBpm !== null && frameResults.length > 0) {
    const end = Math.max(...frameResults.map((frame) => frame.endSeconds));
    const period = 60 / tempoBpm;
    const start = frameResults[0]!.startSeconds;
    const count = Math.max(1, Math.floor((end - start) / period) + 1);
    beatTimesSeconds = Array.from({ length: count }, (_, i) => start + i * period);
    timingSource = "tempo-estimate";
  }

  const events: ChordSheetEvent[] = [];
  const skippedWindowIndexes: number[] = [];

  frameResults.forEach((frame, frameIndex) => {
    if (!Number.isFinite(frame.startSeconds) || !Number.isFinite(frame.endSeconds)
        || frame.startSeconds < 0 || frame.endSeconds <= frame.startSeconds) {
      throw new RangeError(`Invalid timestamps for analysis window ${frameIndex}.`);
    }
    const candidate = frame.candidates[0];
    if (!candidate) {
      skippedWindowIndexes.push(frameIndex);
      return;
    }
    if (!candidate.symbol || !candidate.root || !Number.isFinite(candidate.confidence)
        || !Number.isFinite(candidate.score)) {
      throw new TypeError(`Invalid top chord candidate for analysis window ${frameIndex}.`);
    }

    const previous = events.at(-1);
    const contiguous = previous !== undefined
      && previous.chordSymbol === candidate.symbol
      && frameIndex === previous.sourceFrameIndexes.at(-1)! + 1
      && frame.startSeconds <= previous.endSeconds + tolerance;

    if (contiguous) {
      const count = previous.sourceFrameIndexes.length;
      previous.endSeconds = Math.max(previous.endSeconds, frame.endSeconds);
      previous.meanConfidence = (previous.meanConfidence * count + candidate.confidence) / (count + 1);
      previous.meanScore = (previous.meanScore * count + candidate.score) / (count + 1);
      previous.sourceFrameIndexes.push(frameIndex);
      return;
    }

    events.push({
      chordSymbol: candidate.symbol,
      root: candidate.root,
      quality: candidate.quality,
      startSeconds: frame.startSeconds,
      endSeconds: frame.endSeconds,
      meanConfidence: candidate.confidence,
      meanScore: candidate.score,
      sourceFrameIndexes: [frameIndex],
      startBeat: null,
      endBeat: null,
      startBar: null,
      endBar: null,
      beatInBar: null,
    });
  });

  const nearestBeat = (time: number): number => {
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < beatTimesSeconds.length; i += 1) {
      const distance = Math.abs(beatTimesSeconds[i]! - time);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    return bestDistance <= BEAT_MATCH_TOLERANCE_SECONDS ? bestIndex : -1;
  };
  const nearestDownbeat = (time: number): number => {
    let bestIndex = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < downbeatTimesSeconds.length; i += 1) {
      const distance = Math.abs(downbeatTimesSeconds[i]! - time);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    return bestDistance <= BEAT_MATCH_TOLERANCE_SECONDS ? bestIndex : -1;
  };
  const downbeatBeatIndexes = downbeatTimesSeconds
    .map((time) => nearestBeat(time))
    .filter((index) => index >= 0);

  for (const event of events) {
    if (beatTimesSeconds.length === 0) continue;
    const startBeatIndex = nearestBeat(event.startSeconds);
    const endBeatIndex = nearestBeat(event.endSeconds);
    if (startBeatIndex >= 0) {
      event.startBeat = startBeatIndex + 1;
      if (beatsPerBar !== null) {
        if (downbeatTimesSeconds.length > 0) {
          const downbeatIndex = downbeatTimesSeconds.reduce((latest, time, index) =>
            time <= event.startSeconds + BEAT_MATCH_TOLERANCE_SECONDS ? index : latest, -1);
          if (downbeatIndex >= 0) {
            event.startBar = firstBarNumber + downbeatIndex;
            const barStartBeatIndex = downbeatBeatIndexes[downbeatIndex] ?? -1;
            if (barStartBeatIndex >= 0) {
              event.beatInBar = ((startBeatIndex - barStartBeatIndex) % beatsPerBar + beatsPerBar) % beatsPerBar;
            }
          }
        } else {
          // Compatibility path for direct callers with a manually supplied meter.
          event.startBar = firstBarNumber + Math.floor(startBeatIndex / beatsPerBar);
          event.beatInBar = startBeatIndex % beatsPerBar;
        }
      }
    }
    if (endBeatIndex >= 0) {
      event.endBeat = endBeatIndex + 1;
      if (beatsPerBar !== null) {
        const downbeatIndex = nearestDownbeat(event.endSeconds);
        if (downbeatIndex >= 0) {
          event.endBar = firstBarNumber + downbeatIndex;
        } else if (downbeatTimesSeconds.length === 0) {
          event.endBar = firstBarNumber + Math.floor(endBeatIndex / beatsPerBar);
        } else {
          const previousDownbeatIndex = downbeatTimesSeconds.reduce((latest, time, index) =>
            time < event.endSeconds ? index : latest, -1);
          if (previousDownbeatIndex >= 0) event.endBar = firstBarNumber + previousDownbeatIndex;
        }
      }
    }
  }

  return {
    schemaVersion: "1.2",
    events,
    refinementSuggestions: suggestChordSheetRefinements(events),
    sourceWindowCount: frameResults.length,
    skippedWindowIndexes,
    rhythm: {
      beatsPerBar,
      beatTimesSeconds,
      downbeatTimesSeconds,
      tempoBpm,
      timeSignatureNumerator,
      timeSignatureDenominator,
      meterConfidence,
      barDurationSeconds,
      timingSource,
    },
  };
}
