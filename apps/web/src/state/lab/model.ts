import type {
  AudioAnalysisResponse,
  ChordQuality,
  ChromaProgressionAnalysisOptions,
  Voicing,
} from "@/services";
import type { ProgressionSettings, ProgressionSlot } from "@/state/progressionState";

/**
 * A completed audio analysis. `result` is the unmodified POST /api/audio-analysis response and is
 * never edited; user corrections live in progressions (see SlotSource).
 */
export interface AnalysisSession {
  schemaVersion: 1;
  id: string;
  /** ISO timestamp. */
  createdAt: string;
  source: { filename: string; sizeBytes: number; mimeType: string };
  /** What was sent with the request, so the analysis can be reproduced. */
  request: { windowSeconds: number; options: ChromaProgressionAnalysisOptions };
  result: Readonly<AudioAnalysisResponse>;
}

/** Lightweight index entry for the recent-analyses list (avoids loading full payloads). */
export interface AnalysisSessionSummary {
  id: string;
  createdAt: string;
  filename: string;
  durationSeconds: number;
  tempoBpm: number | null;
  windowCount: number;
  pathCount: number;
}

/** Link from a progression chord back to the analysis it came from. */
export interface SlotSource {
  sessionId: string;
  /** Optimizer path the chord was taken from. */
  pathIndex: number;
  /** Consecutive analysis windows the chord spans (indexes into frameResults). */
  frameIndexes: number[];
  /** Matching step indexes in the optimizer path. */
  stepIndexes: number[];
  startSeconds: number;
  endSeconds: number;
  /** What the analysis detected; kept even after the user corrects the chord. */
  detected: { symbol: string; root: string; quality: ChordQuality };
  /** The fingering the optimizer chose for the first window of this chord. */
  voicing: Voicing;
}

export interface SavedProgression {
  schemaVersion: 1;
  id: string;
  name: string;
  sessionId: string | null;
  createdAt: string;
  updatedAt: string;
  slots: ProgressionSlot[];
  settings: ProgressionSettings;
}

export interface SavedProgressionSummary {
  id: string;
  name: string;
  sessionId: string | null;
  updatedAt: string;
  chordCount: number;
}

export function summarizeSession(session: AnalysisSession): AnalysisSessionSummary {
  const { audio, chordAnalysis } = session.result;
  return {
    id: session.id,
    createdAt: session.createdAt,
    filename: session.source.filename,
    durationSeconds: audio.durationSeconds,
    tempoBpm: audio.rhythm.tempoBpm,
    windowCount: chordAnalysis.frameResults.length,
    pathCount: chordAnalysis.optimization?.results.length ?? 0,
  };
}

export function summarizeProgression(progression: SavedProgression): SavedProgressionSummary {
  return {
    id: progression.id,
    name: progression.name,
    sessionId: progression.sessionId,
    updatedAt: progression.updatedAt,
    chordCount: progression.slots.length,
  };
}

export type ExtractedChord = Omit<SlotSource, "sessionId" | "pathIndex">;

/**
 * Reads the chord sequence the optimizer path chose. Consecutive windows that use the same chord
 * become one chord; a silent window (no step) ends the run. Root and quality come from the
 * matching hypothesis in that window, so nothing is inferred beyond what the response contains.
 */
export function extractChordSequence(result: Readonly<AudioAnalysisResponse>, pathIndex: number): ExtractedChord[] {
  const { frameResults, progressionFrameIndexes, optimization } = result.chordAnalysis;
  const path = optimization?.results[pathIndex];
  if (!path) return [];
  const stepByFrame = new Map(progressionFrameIndexes.map((frameIndex, stepIndex) => [frameIndex, stepIndex]));
  const chords: ExtractedChord[] = [];
  let previousFrame = -2;
  frameResults.forEach((frame, frameIndex) => {
    const stepIndex = stepByFrame.get(frameIndex);
    const step = stepIndex === undefined ? undefined : path.steps[stepIndex];
    const candidate = step ? frame.candidates.find((c) => c.symbol === step.chordSymbol) : undefined;
    if (stepIndex === undefined || !step || !candidate) {
      previousFrame = -2;
      return;
    }
    const last = chords[chords.length - 1];
    if (last && previousFrame === frameIndex - 1 && last.detected.symbol === step.chordSymbol) {
      last.frameIndexes.push(frameIndex);
      last.stepIndexes.push(stepIndex);
      last.endSeconds = frame.endSeconds;
    } else {
      chords.push({
        frameIndexes: [frameIndex],
        stepIndexes: [stepIndex],
        startSeconds: frame.startSeconds,
        endSeconds: frame.endSeconds,
        detected: { symbol: step.chordSymbol, root: candidate.root, quality: candidate.quality },
        voicing: step.voicing,
      });
    }
    previousFrame = frameIndex;
  });
  return chords;
}

/** True when the user changed a chord that came from an analysis. */
export function isCorrected(slot: ProgressionSlot): boolean {
  return slot.source !== undefined
    && (slot.root !== slot.source.detected.root || slot.quality !== slot.source.detected.quality);
}
