import type { ChordAdjustment } from "./chordTrack";
import type { MelodyNote, MelodyTranscriptionState } from "./melody";

/**
 * The editable score for one analysis session. It is an overlay: the analysis response is never
 * modified, and chord positions are only adjusted through `chordAdjustments`.
 */
export interface ScoreDocument {
  schemaVersion: 1;
  sessionId: string;
  /** Tonic for "1 = …". Null until the user sets it; the app does not detect keys. */
  keyTonic: string | null;
  melody: MelodyNote[];
  /** Keyed by chordSheet event index. */
  chordAdjustments: Record<number, ChordAdjustment>;
  transcription: MelodyTranscriptionState;
  updatedAt: string;
}

export function emptyScore(sessionId: string): ScoreDocument {
  return {
    schemaVersion: 1,
    sessionId,
    keyTonic: null,
    melody: [],
    chordAdjustments: {},
    transcription: { status: "not-available" },
    updatedAt: new Date(0).toISOString(),
  };
}
