import { locateTick, type BarGrid } from "./grid";

/** Jianpu scale degree; 0 is a rest. */
export type JianpuDegree = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface MelodyNote {
  id: string;
  /** Absolute tick (sixteenths from the start of the score). */
  startTick: number;
  ticks: number;
  degree: JianpuDegree;
  /** −1 flat, 0 natural, +1 sharp. */
  accidental: -1 | 0 | 1;
  /** Octave dots: positive above, negative below. */
  octave: -2 | -1 | 0 | 1 | 2;
  /**
   * Where the note came from. Only "manual" exists today: the app does not transcribe melody.
   * "transcription" is reserved for a future onset/pitch/duration detector.
   */
  source: "manual" | "transcription";
  /** Reserved for transcribed notes: the detected onset and the detector's confidence. */
  detectedOnsetSeconds?: number;
  detectionConfidence?: number;
}

/**
 * Reserved shape for a future melody transcription service (not produced by any backend yet).
 */
export interface DetectedNoteEvent {
  onsetSeconds: number;
  offsetSeconds: number;
  midi: number;
  confidence: number;
}

export type MelodyTranscriptionState =
  | { status: "not-available" }
  | { status: "available"; events: DetectedNoteEvent[] };

/**
 * Adds a note, overwriting whatever it overlaps (like typing into a tab editor). Overlapped notes
 * are trimmed or removed. The note is clamped to the end of the score.
 */
export function placeNote(notes: readonly MelodyNote[], note: MelodyNote, totalTicks: number): MelodyNote[] {
  const start = Math.max(0, Math.min(note.startTick, totalTicks - 1));
  const end = Math.min(totalTicks, start + Math.max(1, note.ticks));
  const placed = { ...note, startTick: start, ticks: end - start };
  const kept: MelodyNote[] = [];
  for (const other of notes) {
    if (other.id === note.id) continue;
    const otherEnd = other.startTick + other.ticks;
    if (otherEnd <= start || other.startTick >= end) {
      kept.push(other);
    } else if (other.startTick < start) {
      kept.push({ ...other, ticks: start - other.startTick }); // keep the part before the new note
    }
    // Notes starting inside the new note are replaced.
  }
  return [...kept, placed].sort((a, b) => a.startTick - b.startTick);
}

export function removeNote(notes: readonly MelodyNote[], id: string): MelodyNote[] {
  return notes.filter((note) => note.id !== id);
}

/** A note's part inside one bar; long notes become tied parts across bar lines. */
export interface NoteSegment {
  note: MelodyNote;
  barIndex: number;
  startTick: number;
  ticks: number;
  tiedFromPrevious: boolean;
  tiedToNext: boolean;
}

export function noteSegments(grid: BarGrid, notes: readonly MelodyNote[]): NoteSegment[] {
  const segments: NoteSegment[] = [];
  for (const note of notes) {
    const end = Math.min(note.startTick + note.ticks, grid.totalTicks);
    let at = note.startTick;
    while (at < end) {
      const { barIndex, tickInBar } = locateTick(grid, at);
      const bar = grid.bars[barIndex]!;
      const until = Math.min(end, bar.startTick + bar.ticks);
      segments.push({ note, barIndex, startTick: tickInBar, ticks: until - at, tiedFromPrevious: at > note.startTick, tiedToNext: until < end });
      at = until;
    }
  }
  return segments;
}
