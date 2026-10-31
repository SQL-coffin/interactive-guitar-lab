/**
 * Note-event domain model and runtime validation.
 *
 * A note event is a *candidate* note: a pitch with an onset and, when the evidence allows, an
 * offset. All timestamps are absolute seconds from the start of the analysed audio. Confidence
 * values are heuristic scores in [0, 1], not calibrated probabilities, unless
 * `NoteEventAnalysis.model.calibrated` is true.
 *
 * There is intentionally no MIDI velocity: spectral level is not picking intensity on a guitar.
 */

export type NoteEventSource = "heuristic" | "model";

export const GUITAR_TECHNIQUES = [
  "slide-in", "slide-out", "bend", "release", "hammer-on", "pull-off", "vibrato", "palm-mute", "harmonic",
] as const;
export type GuitarTechnique = typeof GUITAR_TECHNIQUES[number];

/** Reserved for future guitar-specific models. The heuristic baseline never sets it. */
export interface GuitarNoteAttributes {
  /** 1 = lowest-pitched string, matching the music-theory engine. */
  stringNumber?: number;
  fret?: number;
  techniques?: GuitarTechnique[];
  /** Groups notes that belong to one strum. */
  strumGroupId?: number;
}

export interface NoteEvent {
  pitchMidi: number;
  onsetSeconds: number;
  /** Null when there is not enough evidence to place the note's end (e.g. still sounding at the end). */
  offsetSeconds: number | null;
  onsetConfidence: number;
  /** Null exactly when offsetSeconds is null. */
  offsetConfidence: number | null;
  pitchConfidence: number;
  source: NoteEventSource;
  guitar?: GuitarNoteAttributes;
}

export interface NoteEventModelInfo {
  name: string;
  version: string;
  source: NoteEventSource;
  /** False for the heuristic baseline: confidences are ranking scores, not probabilities. */
  calibrated: boolean;
}

export interface NoteEventAnalysis {
  schemaVersion: "1.0";
  model: NoteEventModelInfo;
  /** Activation frame rate of the producing model, which bounds timing resolution. */
  frameRateHz: number;
  /** Pitches outside this range are never reported. */
  pitchRangeMidi: { min: number; max: number };
  /** True when the event cap was reached and later events were dropped. */
  truncated: boolean;
  /** Sorted by onsetSeconds, then pitchMidi. Overlapping notes are preserved. */
  events: NoteEvent[];
}

/** Matches the worker's hard cap; bounds response size and downstream work. */
export const MAX_NOTE_EVENTS = 10_000;
const TIME_TOLERANCE_SECONDS = 1e-3;

export class NoteEventValidationError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "NoteEventValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isConfidence(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function parseGuitarAttributes(value: unknown, label: string): GuitarNoteAttributes {
  if (!isRecord(value)) throw new NoteEventValidationError(`${label}.guitar must be an object.`);
  const parsed: GuitarNoteAttributes = {};
  if (value.stringNumber !== undefined) {
    if (!isIntegerInRange(value.stringNumber, 1, 12)) throw new NoteEventValidationError(`${label}.guitar.stringNumber must be an integer from 1 to 12.`);
    parsed.stringNumber = value.stringNumber;
  }
  if (value.fret !== undefined) {
    if (!isIntegerInRange(value.fret, 0, 36)) throw new NoteEventValidationError(`${label}.guitar.fret must be an integer from 0 to 36.`);
    parsed.fret = value.fret;
  }
  if (value.techniques !== undefined) {
    if (!Array.isArray(value.techniques)
        || value.techniques.some((technique) => !(GUITAR_TECHNIQUES as readonly unknown[]).includes(technique))) {
      throw new NoteEventValidationError(`${label}.guitar.techniques contains an unsupported technique.`);
    }
    parsed.techniques = [...value.techniques] as GuitarTechnique[];
  }
  if (value.strumGroupId !== undefined) {
    if (!isIntegerInRange(value.strumGroupId, 0, Number.MAX_SAFE_INTEGER)) {
      throw new NoteEventValidationError(`${label}.guitar.strumGroupId must be a non-negative integer.`);
    }
    parsed.strumGroupId = value.strumGroupId;
  }
  return parsed;
}

/** Validates one event. Rejects non-finite values, out-of-range confidences and impossible timing. */
export function parseNoteEvent(value: unknown, label = "note event"): NoteEvent {
  if (!isRecord(value)) throw new NoteEventValidationError(`${label} must be an object.`);
  const { pitchMidi, onsetSeconds, offsetSeconds, onsetConfidence, offsetConfidence, pitchConfidence, source } = value;
  if (!isIntegerInRange(pitchMidi, 0, 127)) throw new NoteEventValidationError(`${label}.pitchMidi must be an integer from 0 to 127.`);
  if (!isFiniteNumber(onsetSeconds) || onsetSeconds < 0) throw new NoteEventValidationError(`${label}.onsetSeconds must be a finite, non-negative number.`);
  if (offsetSeconds !== null && (!isFiniteNumber(offsetSeconds) || offsetSeconds <= onsetSeconds)) {
    throw new NoteEventValidationError(`${label}.offsetSeconds must be null or a finite number after onsetSeconds.`);
  }
  if ((offsetSeconds === null) !== (offsetConfidence === null)) {
    throw new NoteEventValidationError(`${label}.offsetSeconds and offsetConfidence must both be null or both be set.`);
  }
  if (!isConfidence(onsetConfidence) || !isConfidence(pitchConfidence)
      || (offsetConfidence !== null && !isConfidence(offsetConfidence))) {
    throw new NoteEventValidationError(`${label} confidence values must be finite numbers from 0 to 1.`);
  }
  if (source !== "heuristic" && source !== "model") {
    throw new NoteEventValidationError(`${label}.source must be "heuristic" or "model".`);
  }
  return {
    pitchMidi,
    onsetSeconds,
    offsetSeconds: offsetSeconds as number | null,
    onsetConfidence,
    offsetConfidence: offsetConfidence as number | null,
    pitchConfidence,
    source,
    // null and absent both mean "no guitar-specific attributes".
    ...(value.guitar === undefined || value.guitar === null ? {} : { guitar: parseGuitarAttributes(value.guitar, label) }),
  };
}

/**
 * Validates an ordered event list. Events must be sorted by onset (then pitch) and, when the audio
 * duration is known, lie within it. Unsorted input is rejected rather than silently reordered so
 * that a producer bug cannot go unnoticed.
 */
export function validateNoteEvents(values: unknown, durationSeconds?: number): NoteEvent[] {
  if (!Array.isArray(values)) throw new NoteEventValidationError("events must be an array.");
  if (values.length > MAX_NOTE_EVENTS) throw new NoteEventValidationError(`events must contain at most ${MAX_NOTE_EVENTS} items.`);
  const events = values.map((value, index) => parseNoteEvent(value, `events[${index}]`));
  for (let index = 0; index < events.length; index += 1) {
    const current = events[index]!;
    const previous = index > 0 ? events[index - 1]! : null;
    if (previous && (current.onsetSeconds < previous.onsetSeconds
        || (current.onsetSeconds === previous.onsetSeconds && current.pitchMidi < previous.pitchMidi))) {
      throw new NoteEventValidationError("events must be sorted by onsetSeconds, then pitchMidi.");
    }
    if (durationSeconds !== undefined) {
      const limit = durationSeconds + TIME_TOLERANCE_SECONDS;
      if (current.onsetSeconds > limit || (current.offsetSeconds !== null && current.offsetSeconds > limit)) {
        throw new NoteEventValidationError(`events[${index}] lies outside the audio duration.`);
      }
    }
  }
  return events;
}

/** Sorts a copy of the events in the canonical order without dropping overlapping notes. */
export function sortNoteEvents(events: readonly NoteEvent[]): NoteEvent[] {
  return [...events].sort((left, right) => left.onsetSeconds - right.onsetSeconds || left.pitchMidi - right.pitchMidi);
}

export function parseNoteEventAnalysis(value: unknown, durationSeconds?: number): NoteEventAnalysis {
  if (!isRecord(value) || value.schemaVersion !== "1.0") {
    throw new NoteEventValidationError("noteEvents has an unsupported schema version.");
  }
  const { model, frameRateHz, pitchRangeMidi, truncated } = value;
  if (!isRecord(model) || typeof model.name !== "string" || typeof model.version !== "string"
      || (model.source !== "heuristic" && model.source !== "model") || typeof model.calibrated !== "boolean") {
    throw new NoteEventValidationError("noteEvents.model is invalid.");
  }
  if (!isFiniteNumber(frameRateHz) || frameRateHz <= 0) {
    throw new NoteEventValidationError("noteEvents.frameRateHz must be a positive number.");
  }
  if (!isRecord(pitchRangeMidi) || !isIntegerInRange(pitchRangeMidi.min, 0, 127)
      || !isIntegerInRange(pitchRangeMidi.max, 0, 127) || pitchRangeMidi.min > pitchRangeMidi.max) {
    throw new NoteEventValidationError("noteEvents.pitchRangeMidi is invalid.");
  }
  if (typeof truncated !== "boolean") throw new NoteEventValidationError("noteEvents.truncated must be a boolean.");
  const events = validateNoteEvents(value.events, durationSeconds);
  const range = { min: pitchRangeMidi.min, max: pitchRangeMidi.max };
  if (events.some((event) => event.pitchMidi < range.min || event.pitchMidi > range.max)) {
    throw new NoteEventValidationError("noteEvents contains a pitch outside pitchRangeMidi.");
  }
  if (events.some((event) => event.source !== model.source)) {
    throw new NoteEventValidationError("noteEvents event sources must match the producing model.");
  }
  return {
    schemaVersion: "1.0",
    model: { name: model.name, version: model.version, source: model.source, calibrated: model.calibrated },
    frameRateHz,
    pitchRangeMidi: range,
    truncated,
    events,
  };
}
