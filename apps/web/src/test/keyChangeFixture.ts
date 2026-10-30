import type { KeyChangeDetectionResult, KeyChangeEvent } from "@/services";

const key = (tonic: string, tonicPitchClass: number, mode: "major" | "minor", score: number) =>
  ({ tonic, tonicPitchClass, mode, label: `${tonic} ${mode}`, score });

/** A candidate event in the backend's KeyChangeEvent shape; values are illustrative, not from a song. */
export function keyChangeEvent(overrides: Partial<KeyChangeEvent> = {}): KeyChangeEvent {
  return {
    timeSeconds: 3.2,
    transitionWindow: { startSeconds: 1.5, endSeconds: 4 },
    beforeCandidates: [key("C", 0, "major", 0.81)],
    afterCandidates: [key("G", 7, "major", 0.77), key("E", 4, "minor", 0.74)],
    status: "possible",
    interpretation: "local-tonicization-or-modulation",
    confidence: "moderate",
    confidenceScore: 0.6312,
    evidence: {
      beforeWindowCount: 2,
      afterWindowCount: 3,
      persistentAfterSeconds: 6,
      observedPitchClassesBefore: [0, 4, 7],
      observedPitchClassesAfter: [2, 6, 7, 11],
      bassSupportBefore: 0,
      bassSupportAfter: null,
      topChordsBefore: ["C", "F#m7b5"],
      topChordsAfter: ["G", "D"],
    },
    explanation: "A different local tonal-profile winner persists across overlapping windows.",
    ...overrides,
  };
}

export function keyChangeDetection(overrides: Partial<KeyChangeDetectionResult> = {}): KeyChangeDetectionResult {
  return {
    status: "detected",
    windowSeconds: 12,
    hopSeconds: 2,
    windows: [],
    events: [keyChangeEvent()],
    explanation: "Possible sustained tonal changes were found.",
    ...overrides,
  };
}
