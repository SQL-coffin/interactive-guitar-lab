import type { ChromaFrame } from "./types.js";
import { NoteEventValidationError, parseNoteEventAnalysis, type NoteEventAnalysis } from "./note-events.js";

export interface AudioWorkerClientOptions {
  /** Base URL for the private Python audio-worker service, e.g. http://127.0.0.1:8010. */
  baseUrl: string;
  filename: string;
  windowSeconds?: number;
  windowStrategy?: "manual" | "auto";
  timeoutMs?: number;
  /** Aborts the worker request early, e.g. when the HTTP client that started it disconnects. */
  signal?: AbortSignal;
  /**
   * Opt in to heuristic note-event candidates computed from the same upload and decode as the
   * chroma frames. Defaults to false, which leaves the request and response exactly as before.
   */
  includeNoteEvents?: boolean;
}

/** Options for the standalone note-event endpoint; shares transport limits with the chroma call. */
export type NoteEventWorkerClientOptions = Pick<AudioWorkerClientOptions, "baseUrl" | "filename" | "timeoutMs" | "signal">;

export interface NoteEventFeatureResponse {
  schemaVersion: "1.0";
  filename: string;
  durationSeconds: number;
  sampleRate: number;
  noteEvents: NoteEventAnalysis;
}

export interface AudioFeatureResponse {
  schemaVersion: "1.0";
  filename: string;
  durationSeconds: number;
  sampleRate: number;
  /** Target duration requested by the client; individual frame durations may follow the beat grid. */
  windowSeconds: number;
  windowingMode: "adaptive-beat-aligned" | "beat-aligned" | "fixed-window";
  windowStrategy: "manual" | "auto";
  rhythm: {
    tempoBpm: number | null;
    beatTimesSeconds: number[];
    /** Conservative estimate, currently limited to 3/4 and 4/4. Null means uncertain/unsupported. */
    timeSignatureNumerator: number | null;
    timeSignatureDenominator: number | null;
    /** Heuristic separation score, not a calibrated probability. */
    meterConfidence: number | null;
    /** Estimated duration of one bar, derived from the observed beat period and meter. */
    barDurationSeconds: number | null;
    /** Estimated downbeat timestamps; empty when meter is uncertain. */
    downbeatTimesSeconds: number[];
  };
  frames: ChromaFrame[];
  /** Present only when includeNoteEvents was requested. */
  noteEvents?: NoteEventAnalysis;
}

export class AudioWorkerError extends Error {
  readonly statusCode: number | null;

  constructor(message: string, statusCode: number | null = null) {
    super(message);
    this.name = "AudioWorkerError";
    this.statusCode = statusCode;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseNoteEventsField(value: unknown, durationSeconds: number): NoteEventAnalysis {
  try {
    return parseNoteEventAnalysis(value, durationSeconds);
  } catch (error) {
    if (error instanceof NoteEventValidationError) {
      throw new AudioWorkerError(`Audio worker returned invalid note events: ${error.message}`, null);
    }
    throw error;
  }
}

function parseFeatureResponse(value: unknown, includeNoteEvents = false): AudioFeatureResponse {
  if (!isRecord(value) || value.schemaVersion !== "1.0" || !Array.isArray(value.frames)
      || !isRecord(value.rhythm)) {
    throw new AudioWorkerError("Audio worker returned an unsupported feature response.", null);
  }
  const windowingMode = value.windowingMode ?? "fixed-window";
  const windowStrategy = value.windowStrategy ?? "manual";
  if (typeof value.filename !== "string"
      || typeof value.durationSeconds !== "number" || !Number.isFinite(value.durationSeconds)
      || typeof value.sampleRate !== "number" || !Number.isInteger(value.sampleRate)
      || typeof value.windowSeconds !== "number" || !Number.isFinite(value.windowSeconds)
      || (windowingMode !== "adaptive-beat-aligned" && windowingMode !== "beat-aligned" && windowingMode !== "fixed-window")
      || (windowStrategy !== "manual" && windowStrategy !== "auto")) {
    throw new AudioWorkerError("Audio worker returned invalid audio metadata.", null);
  }

  const tempoBpm = value.rhythm.tempoBpm;
  const beatTimesSeconds = value.rhythm.beatTimesSeconds;
  const numerator = value.rhythm.timeSignatureNumerator;
  const denominator = value.rhythm.timeSignatureDenominator;
  const meterConfidence = value.rhythm.meterConfidence ?? null;
  const barDurationSeconds = value.rhythm.barDurationSeconds ?? null;
  const downbeatTimesSeconds = value.rhythm.downbeatTimesSeconds ?? [];
  if ((tempoBpm !== null && (typeof tempoBpm !== "number" || !Number.isFinite(tempoBpm) || tempoBpm <= 0))
      || !Array.isArray(beatTimesSeconds)
      || beatTimesSeconds.some((beat) => typeof beat !== "number" || !Number.isFinite(beat) || beat < 0)
      || (numerator !== undefined && numerator !== null
        && (typeof numerator !== "number" || !Number.isInteger(numerator) || numerator < 1 || numerator > 12))
      || (denominator !== undefined && denominator !== null
        && (typeof denominator !== "number" || ![2, 4, 8, 16].includes(denominator)))
      || (meterConfidence !== null
        && (typeof meterConfidence !== "number" || !Number.isFinite(meterConfidence) || meterConfidence < 0 || meterConfidence > 1))
      || (barDurationSeconds !== null
        && (typeof barDurationSeconds !== "number" || !Number.isFinite(barDurationSeconds) || barDurationSeconds <= 0))
      || !Array.isArray(downbeatTimesSeconds)
      || downbeatTimesSeconds.some((beat) => typeof beat !== "number" || !Number.isFinite(beat) || beat < 0)
      || (numerator != null) !== (denominator != null)
      || (barDurationSeconds !== null && numerator == null)
      || (numerator != null && (typeof meterConfidence !== "number" || downbeatTimesSeconds.length === 0))) {
    throw new AudioWorkerError("Audio worker returned invalid rhythm data.", null);
  }

  const frames = value.frames.map((frame, index): ChromaFrame => {
    if (!isRecord(frame)
        || typeof frame.startSeconds !== "number" || !Number.isFinite(frame.startSeconds)
        || typeof frame.endSeconds !== "number" || !Number.isFinite(frame.endSeconds)
        || frame.startSeconds < 0 || frame.endSeconds < frame.startSeconds
        || !Array.isArray(frame.chroma) || frame.chroma.length !== 12
        || frame.chroma.some((sample) => typeof sample !== "number"
          || !Number.isFinite(sample) || sample < 0 || sample > 1)
        || (frame.bassPitchClass !== undefined && frame.bassPitchClass !== null
          && (typeof frame.bassPitchClass !== "number"
            || !Number.isInteger(frame.bassPitchClass)
            || frame.bassPitchClass < 0 || frame.bassPitchClass > 11))) {
      throw new AudioWorkerError(`Audio worker returned invalid chroma data for frame ${index}.`, null);
    }
    return {
      startSeconds: frame.startSeconds,
      endSeconds: frame.endSeconds,
      chroma: frame.chroma as number[],
      ...(frame.bassPitchClass === undefined
        ? {}
        : { bassPitchClass: frame.bassPitchClass as number | null }),
    };
  });

  return {
    schemaVersion: "1.0",
    filename: value.filename,
    durationSeconds: value.durationSeconds,
    sampleRate: value.sampleRate,
    windowSeconds: value.windowSeconds,
    windowingMode,
    windowStrategy,
    rhythm: {
      tempoBpm,
      beatTimesSeconds: beatTimesSeconds as number[],
      timeSignatureNumerator: numerator == null ? null : numerator as number,
      timeSignatureDenominator: denominator == null ? null : denominator as number,
      meterConfidence: meterConfidence == null ? null : meterConfidence as number,
      barDurationSeconds: barDurationSeconds == null ? null : barDurationSeconds as number,
      downbeatTimesSeconds: downbeatTimesSeconds as number[],
    },
    frames,
    ...(includeNoteEvents ? { noteEvents: parseNoteEventsField(value.noteEvents, value.durationSeconds) } : {}),
  };
}

function parseNoteEventFeatureResponse(value: unknown): NoteEventFeatureResponse {
  if (!isRecord(value) || value.schemaVersion !== "1.0" || typeof value.filename !== "string"
      || typeof value.durationSeconds !== "number" || !Number.isFinite(value.durationSeconds) || value.durationSeconds < 0
      || typeof value.sampleRate !== "number" || !Number.isInteger(value.sampleRate) || value.sampleRate <= 0) {
    throw new AudioWorkerError("Audio worker returned an unsupported note-event response.", null);
  }
  return {
    schemaVersion: "1.0",
    filename: value.filename,
    durationSeconds: value.durationSeconds,
    sampleRate: value.sampleRate,
    noteEvents: parseNoteEventsField(value.noteEvents, value.durationSeconds),
  };
}

function validateTimeout(timeoutMs: number): void {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 600_000) {
    throw new RangeError("timeoutMs must be an integer between 1000 and 600000.");
  }
}

function resolveWorkerEndpoint(path: string, baseUrl: string): string {
  let endpoint: string;
  try {
    endpoint = new URL(path, baseUrl).toString();
  } catch {
    throw new TypeError("baseUrl must be an absolute HTTP(S) URL.");
  }
  const parsedUrl = new URL(endpoint);
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new TypeError("baseUrl must use HTTP or HTTPS.");
  }
  return endpoint;
}

/**
 * Shared transport for every worker endpoint: one timeout, caller cancellation, and error mapping,
 * so chroma and note-event requests behave identically when the worker is slow or the client leaves.
 */
async function postWorkerForm(
  endpoint: string,
  form: FormData,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      body: form,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown network error.";
    throw new AudioWorkerError(`Audio worker request failed: ${message}`);
  }

  const responseText = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(responseText);
  } catch {
    throw new AudioWorkerError(
      response.ok ? "Audio worker returned invalid JSON." : `Audio worker returned HTTP ${response.status}.`,
      response.status,
    );
  }

  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.detail === "string"
      ? payload.detail
      : `Audio worker returned HTTP ${response.status}.`;
    throw new AudioWorkerError(message, response.status);
  }
  return payload;
}

/** Calls the local Python feature service and validates its JSON contract at runtime. */
export async function extractAudioFeatures(
  audio: Blob,
  input: AudioWorkerClientOptions,
): Promise<AudioFeatureResponse> {
  const windowSeconds = input.windowSeconds ?? 0.5;
  const timeoutMs = input.timeoutMs ?? 120_000;
  if (!Number.isFinite(windowSeconds) || windowSeconds < 0.1 || windowSeconds > 2) {
    throw new RangeError("windowSeconds must be between 0.1 and 2.0.");
  }
  validateTimeout(timeoutMs);
  const endpoint = resolveWorkerEndpoint("/v1/features/chroma", input.baseUrl);

  const form = new FormData();
  form.append("file", audio, input.filename || "audio-upload");
  form.append("windowSeconds", String(windowSeconds));
  if (input.windowStrategy !== undefined) form.append("windowStrategy", input.windowStrategy);
  const includeNoteEvents = input.includeNoteEvents === true;
  if (includeNoteEvents) form.append("includeNoteEvents", "true");

  const payload = await postWorkerForm(endpoint, form, timeoutMs, input.signal);
  return parseFeatureResponse(payload, includeNoteEvents);
}

/**
 * Calls the standalone note-event endpoint. Use this when chroma is not needed; to get both from
 * one upload, pass includeNoteEvents to extractAudioFeatures instead.
 */
export async function extractNoteEvents(
  audio: Blob,
  input: NoteEventWorkerClientOptions,
): Promise<NoteEventFeatureResponse> {
  const timeoutMs = input.timeoutMs ?? 120_000;
  validateTimeout(timeoutMs);
  const endpoint = resolveWorkerEndpoint("/v1/features/note-events", input.baseUrl);
  const form = new FormData();
  form.append("file", audio, input.filename || "audio-upload");
  const payload = await postWorkerForm(endpoint, form, timeoutMs, input.signal);
  return parseNoteEventFeatureResponse(payload);
}
