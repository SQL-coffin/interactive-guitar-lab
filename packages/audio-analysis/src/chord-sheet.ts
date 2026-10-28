import type { ChordCandidate, ChordInferenceResult } from "./types.js";
import { suggestChordSheetRefinements, type ChordSheetRefinementSuggestion } from "./chord-sheet-refinement.js";

export interface ChordSheetOptions {
  /** Maximum gap accepted when joining adjacent windows with the same top chord. */
  continuityToleranceSeconds?: number;
  /** Estimated beat timestamps in seconds from the audio feature worker. */
  beatTimesSeconds?: readonly number[];
  /** Estimated tempo, used only as a fallback when beat timestamps are absent. */
  tempoBpm?: number | null;
  /** Beats per bar; defaults to 4. */
  beatsPerBar?: number;
  /** First beat's bar number; defaults to 1. */
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
  schemaVersion: "1.1";
  events: ChordSheetEvent[];
  /** Non-destructive review suggestions; raw chord events remain unchanged. */
  refinementSuggestions: ChordSheetRefinementSuggestion[];
  sourceWindowCount: number;
  skippedWindowIndexes: number[];
  rhythm: {
    beatsPerBar: number;
    beatTimesSeconds: number[];
    tempoBpm: number | null;
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
  const beatsPerBar = input.beatsPerBar ?? 4;
  const firstBarNumber = input.firstBarNumber ?? 1;
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 0.25) {
    throw new RangeError("continuityToleranceSeconds must be between 0 and 0.25.");
  }
  if (!Number.isInteger(beatsPerBar) || beatsPerBar < 1 || beatsPerBar > 12) {
    throw new RangeError("beatsPerBar must be an integer from 1 to 12.");
  }
  if (!Number.isInteger(firstBarNumber) || firstBarNumber < 1) {
    throw new RangeError("firstBarNumber must be a positive integer.");
  }

  const suppliedBeats = input.beatTimesSeconds ?? [];
  if (suppliedBeats.some((beat) => !Number.isFinite(beat) || beat < 0)
      || suppliedBeats.some((beat, i) => i > 0 && beat <= suppliedBeats[i - 1]!)) {
    throw new RangeError("beatTimesSeconds must be finite, non-negative, and strictly increasing.");
  }
  const tempoBpm = input.tempoBpm ?? null;
  if (tempoBpm !== null && (!Number.isFinite(tempoBpm) || tempoBpm <= 0)) {
    throw new RangeError("tempoBpm must be a positive finite number or null.");
  }

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

  for (const event of events) {
    if (beatTimesSeconds.length === 0) continue;
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
    const startBeatIndex = nearestBeat(event.startSeconds);
    const endBeatIndex = nearestBeat(event.endSeconds);
    if (startBeatIndex >= 0) {
      event.startBeat = startBeatIndex + 1;
      event.startBar = firstBarNumber + Math.floor(startBeatIndex / beatsPerBar);
      event.beatInBar = startBeatIndex % beatsPerBar;
    }
    if (endBeatIndex >= 0) {
      event.endBeat = endBeatIndex + 1;
      event.endBar = firstBarNumber + Math.floor(endBeatIndex / beatsPerBar);
    }
  }

  return {
    schemaVersion: "1.1",
    events,
    refinementSuggestions: suggestChordSheetRefinements(events),
    sourceWindowCount: frameResults.length,
    skippedWindowIndexes,
    rhythm: { beatsPerBar, beatTimesSeconds, tempoBpm, timingSource },
  };
}
