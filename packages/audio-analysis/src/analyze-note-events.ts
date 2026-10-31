import { extractNoteEvents, type NoteEventFeatureResponse, type NoteEventWorkerClientOptions } from "./worker-client.js";
import type { NoteEvent, NoteEventAnalysis } from "./note-events.js";

export interface NoteEventSummary {
  eventCount: number;
  /** Events whose end could not be placed (offsetSeconds is null). */
  unresolvedOffsetCount: number;
  /** Largest number of candidate notes sounding at once; open-ended notes count until the audio ends. */
  maxPolyphony: number;
  lowestPitchMidi: number | null;
  highestPitchMidi: number | null;
}

export interface AnalyzeAudioNoteEventsResult {
  audio: Omit<NoteEventFeatureResponse, "noteEvents">;
  noteEvents: NoteEventAnalysis;
  summary: NoteEventSummary;
}

/** Deterministic descriptive statistics over a validated event list. O(n log n), bounded by MAX_NOTE_EVENTS. */
export function summarizeNoteEvents(events: readonly NoteEvent[], durationSeconds: number): NoteEventSummary {
  const boundaries: Array<[number, number]> = [];
  let unresolvedOffsetCount = 0;
  let lowest: number | null = null;
  let highest: number | null = null;
  for (const event of events) {
    const end = event.offsetSeconds ?? Math.max(durationSeconds, event.onsetSeconds);
    if (event.offsetSeconds === null) unresolvedOffsetCount += 1;
    boundaries.push([event.onsetSeconds, 1], [end, -1]);
    lowest = lowest === null ? event.pitchMidi : Math.min(lowest, event.pitchMidi);
    highest = highest === null ? event.pitchMidi : Math.max(highest, event.pitchMidi);
  }
  // Ends sort before starts at the same instant so back-to-back notes do not count as overlapping.
  boundaries.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  let active = 0;
  let maxPolyphony = 0;
  for (const [, delta] of boundaries) {
    active += delta;
    maxPolyphony = Math.max(maxPolyphony, active);
  }
  return { eventCount: events.length, unresolvedOffsetCount, maxPolyphony, lowestPitchMidi: lowest, highestPitchMidi: highest };
}

/**
 * Independent note-event entry point: audio -> worker note-event endpoint -> validated events.
 * It does not touch chord, key or voicing analysis.
 */
export async function analyzeAudioNoteEvents(
  audio: Blob,
  options: NoteEventWorkerClientOptions,
): Promise<AnalyzeAudioNoteEventsResult> {
  const response = await extractNoteEvents(audio, options);
  const { noteEvents, ...metadata } = response;
  return {
    audio: metadata,
    noteEvents,
    summary: summarizeNoteEvents(noteEvents.events, metadata.durationSeconds),
  };
}
