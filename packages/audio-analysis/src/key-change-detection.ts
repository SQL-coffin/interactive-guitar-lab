import type { ChordInferenceResult, ChromaFrame } from "./types.js";
import { analyzeKeyCandidates, type MusicalKeyCandidate } from "./key-analysis.js";

export type KeyChangeStatus = "possible" | "uncertain";
export type KeyChangeInterpretation = "possible-modulation" | "local-tonicization-or-modulation" | "uncertain";
export type KeyChangeConfidence = "low" | "moderate" | "high";

export interface KeyChangeWindow {
  startSeconds: number;
  endSeconds: number;
  candidates: MusicalKeyCandidate[];
  /** The best local profile label, even when the relative major/minor pair is ambiguous. */
  leadingCandidate: MusicalKeyCandidate | null;
  scoreMargin: number | null;
}

export interface KeyChangeEvent {
  /** Estimated boundary; not a beat-accurate or probability-calibrated timestamp. */
  timeSeconds: number;
  /** A broad interval around the estimated boundary, reflecting sliding-window resolution. */
  transitionWindow: { startSeconds: number; endSeconds: number };
  beforeCandidates: MusicalKeyCandidate[];
  afterCandidates: MusicalKeyCandidate[];
  status: KeyChangeStatus;
  interpretation: KeyChangeInterpretation;
  confidence: KeyChangeConfidence;
  confidenceScore: number;
  evidence: {
    beforeWindowCount: number;
    afterWindowCount: number;
    persistentAfterSeconds: number;
    observedPitchClassesBefore: number[];
    observedPitchClassesAfter: number[];
    bassSupportBefore: number | null;
    bassSupportAfter: number | null;
    topChordsBefore: string[];
    topChordsAfter: string[];
  };
  explanation: string;
}

export interface KeyChangeDetectionOptions {
  /** Local analysis window size. Defaults to 16 seconds. */
  windowSeconds?: number;
  /** Distance between window starts. Defaults to 4 seconds. */
  hopSeconds?: number;
  /** Require this many consecutive windows to support the new region. Defaults to 4. */
  minimumPersistentWindows?: number;
  /** Ignore candidate changes whose boundary is closer than this to the previous event. Defaults to 20 seconds. */
  minimumEventSeparationSeconds?: number;
}

export interface KeyChangeDetectionResult {
  status: "detected" | "no-clear-change" | "insufficient-evidence";
  windowSeconds: number;
  hopSeconds: number;
  windows: KeyChangeWindow[];
  events: KeyChangeEvent[];
  explanation: string;
}

const SILENCE_EPSILON = 1e-8;

function summarizeBass(frames: readonly ChromaFrame[]): number | null {
  const counts = Array.from({ length: 12 }, () => 0);
  for (const frame of frames) {
    if (frame.bassPitchClass != null && Number.isInteger(frame.bassPitchClass)
        && frame.bassPitchClass >= 0 && frame.bassPitchClass < 12) {
      const duration = Math.max(0, frame.endSeconds - frame.startSeconds);
      counts[frame.bassPitchClass] = (counts[frame.bassPitchClass] ?? 0) + duration;
    }
  }
  const total = counts.reduce((sum, value) => sum + value, 0);
  if (total <= SILENCE_EPSILON) return null;
  const max = Math.max(...counts);
  const index = counts.indexOf(max);
  return max / total >= 0.2 ? index : null;
}

function makeWindow(frames: readonly ChromaFrame[], startSeconds: number, endSeconds: number): KeyChangeWindow {
  const localFrames = frames.filter((frame) => {
    const midpoint = (frame.startSeconds + frame.endSeconds) / 2;
    return midpoint >= startSeconds && midpoint < endSeconds;
  });
  const analysis = analyzeKeyCandidates(localFrames, { minimumActiveDurationSeconds: Math.min(2, (endSeconds - startSeconds) / 2) });
  return {
    startSeconds,
    endSeconds,
    candidates: analysis.candidates,
    leadingCandidate: analysis.candidates[0] ?? null,
    scoreMargin: analysis.scoreMargin,
  };
}

function label(window: KeyChangeWindow): string | null {
  const candidate = window.leadingCandidate;
  if (!candidate) return null;

  // Major and its relative minor share the same pitch collection. Treat them as
  // one family here so small profile-ranking fluctuations do not become fake
  // modulation events. The detailed candidates remain available to the UI.
  const relativeMajor = candidate.mode === "minor"
    ? (candidate.tonicPitchClass + 3) % 12
    : candidate.tonicPitchClass;
  return `relative-family:${relativeMajor}`;
}

function confidenceFor(score: number): KeyChangeConfidence {
  if (score >= 0.72) return "high";
  if (score >= 0.45) return "moderate";
  return "low";
}

/**
 * Finds sustained changes in local tonal-profile winners. This is intentionally conservative:
 * a change is only a candidate event, not proof of modulation. Chroma profiles alone cannot
 * reliably distinguish a true modulation from tonicization or a change of harmonic emphasis.
 */
export function detectKeyChanges(
  frames: readonly ChromaFrame[],
  options: KeyChangeDetectionOptions = {},
  chordFrames: readonly ChordInferenceResult[] = [],
): KeyChangeDetectionResult {
  const windowSeconds = options.windowSeconds ?? 16;
  const hopSeconds = options.hopSeconds ?? 4;
  const minimumPersistentWindows = options.minimumPersistentWindows ?? 4;
  const minimumEventSeparationSeconds = options.minimumEventSeparationSeconds ?? 20;

  if (!Number.isFinite(windowSeconds) || windowSeconds < 4) throw new RangeError("windowSeconds must be at least 4.");
  if (!Number.isFinite(hopSeconds) || hopSeconds <= 0 || hopSeconds > windowSeconds) throw new RangeError("hopSeconds must be positive and no larger than windowSeconds.");
  if (!Number.isInteger(minimumPersistentWindows) || minimumPersistentWindows < 2) throw new RangeError("minimumPersistentWindows must be an integer of at least 2.");
  if (!Number.isFinite(minimumEventSeparationSeconds) || minimumEventSeparationSeconds < 0) throw new RangeError("minimumEventSeparationSeconds must be non-negative.");

  const validFrames = frames.filter((frame) => Number.isFinite(frame.startSeconds)
    && Number.isFinite(frame.endSeconds) && frame.endSeconds > frame.startSeconds
    && frame.chroma.length === 12 && frame.chroma.some((value) => Number.isFinite(value) && value > SILENCE_EPSILON));
  if (validFrames.length === 0) {
    return { status: "insufficient-evidence", windowSeconds, hopSeconds, windows: [], events: [], explanation: "No usable chroma frames were supplied." };
  }

  const audioEnd = Math.max(...validFrames.map((frame) => frame.endSeconds));
  const windows: KeyChangeWindow[] = [];
  for (let start = Math.max(0, Math.min(...validFrames.map((frame) => frame.startSeconds))); start + windowSeconds <= audioEnd + hopSeconds / 2; start += hopSeconds) {
    windows.push(makeWindow(validFrames, start, Math.min(start + windowSeconds, audioEnd)));
  }
  if (windows.length < minimumPersistentWindows + 1) {
    return { status: "insufficient-evidence", windowSeconds, hopSeconds, windows, events: [], explanation: "The audio is too short to compare sustained local-key regions reliably." };
  }

  const events: KeyChangeEvent[] = [];
  let index = 1;
  while (index < windows.length) {
    const previous = windows[index - 1]!;
    const current = windows[index]!;
    const previousLabel = label(previous);
    const currentLabel = label(current);
    if (!previousLabel || !currentLabel || previousLabel === currentLabel) {
      index += 1;
      continue;
    }

    let persistent = 1;
    while (index + persistent < windows.length
      && label(windows[index + persistent]!) === currentLabel) persistent += 1;
    if (persistent < minimumPersistentWindows) {
      index += persistent;
      continue;
    }

    const beforeStartIndex = Math.max(0, index - minimumPersistentWindows);
    const beforeWindows = windows.slice(beforeStartIndex, index).filter((window) => label(window) === previousLabel);
    const afterWindows = windows.slice(index, index + persistent);
    const boundary = (previous.startSeconds + previous.endSeconds + current.startSeconds + current.endSeconds) / 4;
    const priorEvent = events[events.length - 1];
    if (priorEvent && boundary - priorEvent.timeSeconds < minimumEventSeparationSeconds) {
      index += persistent;
      continue;
    }

    const beforeCandidates = previous.candidates;
    const afterCandidates = current.candidates;
    const pitchClasses = (slice: readonly KeyChangeWindow[]) => {
      const start = slice[0]?.startSeconds ?? 0;
      const end = slice[slice.length - 1]?.endSeconds ?? 0;
      const set = new Set<number>();
      for (const frame of validFrames) {
        const midpoint = (frame.startSeconds + frame.endSeconds) / 2;
        if (midpoint < start || midpoint >= end) continue;
        frame.chroma.forEach((value, pitchClass) => {
          if (Number.isFinite(value) && value > 0) set.add(pitchClass);
        });
      }
      return [...set].sort((a, b) => a - b);
    };
    const beforeFrames = validFrames.filter((frame) => {
      const midpoint = (frame.startSeconds + frame.endSeconds) / 2;
      return midpoint >= (beforeWindows[0]?.startSeconds ?? previous.startSeconds) && midpoint < previous.endSeconds;
    });
    const afterFrames = validFrames.filter((frame) => {
      const midpoint = (frame.startSeconds + frame.endSeconds) / 2;
      return midpoint >= current.startSeconds && midpoint < (afterWindows[afterWindows.length - 1]?.endSeconds ?? current.endSeconds);
    });
    const pitchClassesBefore = pitchClasses(beforeWindows);
    const pitchClassesAfter = pitchClasses(afterWindows);
    const meanProfileMargin = ((previous.scoreMargin ?? 0) + (current.scoreMargin ?? 0)) / 2;
    const scoreSeparation = Math.min(1, meanProfileMargin / 0.12);
    const persistenceScore = Math.min(1, persistent / 4);
    const varietyScore = Math.min(1, Math.min(pitchClassesBefore.length, pitchClassesAfter.length) / 7);
    const confidenceScore = Math.max(0, Math.min(1, 0.45 * persistenceScore + 0.35 * varietyScore + 0.2 * scoreSeparation));
    const confidence = confidenceFor(confidenceScore);
    const bassBefore = summarizeBass(beforeFrames);
    const bassAfter = summarizeBass(afterFrames);
    const topChords = (startSeconds: number, endSeconds: number) => [...new Set(chordFrames
      .filter((frame) => frame.endSeconds > startSeconds && frame.startSeconds < endSeconds)
      .map((frame) => frame.candidates[0]?.symbol)
      .filter((symbol): symbol is string => Boolean(symbol)))].slice(0, 8);
    const topChordsBefore = topChords(beforeWindows[0]?.startSeconds ?? previous.startSeconds, previous.endSeconds);
    const topChordsAfter = topChords(current.startSeconds, afterWindows[afterWindows.length - 1]?.endSeconds ?? current.endSeconds);
    const interpretation: KeyChangeInterpretation = confidence === "low"
      ? "uncertain"
      : "local-tonicization-or-modulation";

    events.push({
      timeSeconds: Math.max(0, boundary),
      transitionWindow: {
        startSeconds: Math.max(0, boundary - windowSeconds / 2),
        endSeconds: Math.min(audioEnd, boundary + windowSeconds / 2),
      },
      beforeCandidates,
      afterCandidates,
      status: confidence === "low" ? "uncertain" : "possible",
      interpretation,
      confidence,
      confidenceScore,
      evidence: {
        beforeWindowCount: beforeWindows.length,
        afterWindowCount: persistent,
        persistentAfterSeconds: persistent * hopSeconds,
        observedPitchClassesBefore: pitchClassesBefore,
        observedPitchClassesAfter: pitchClassesAfter,
        bassSupportBefore: bassBefore,
        bassSupportAfter: bassAfter,
        topChordsBefore,
        topChordsAfter,
      },
      explanation: "A different local tonal-profile winner persists across overlapping windows. This supports a possible key change, but chroma alone cannot confirm modulation or distinguish it from tonicization.",
    });
    index += persistent;
  }

  return {
    status: events.length > 0 ? "detected" : "no-clear-change",
    windowSeconds,
    hopSeconds,
    windows,
    events,
    explanation: events.length > 0
      ? "Possible sustained tonal changes were found. Event times are approximate and confidence scores are heuristic, not probabilities."
      : "No sustained change in local tonal-profile winners met the persistence requirement.",
  };
}
