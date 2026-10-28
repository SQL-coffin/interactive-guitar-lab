import type { ChromaFrame } from "./types.js";

export interface AudioWorkerClientOptions {
  /** Base URL for the private Python audio-worker service, e.g. http://127.0.0.1:8010. */
  baseUrl: string;
  filename: string;
  windowSeconds?: number;
  timeoutMs?: number;
}

export interface AudioFeatureResponse {
  schemaVersion: "1.0";
  filename: string;
  durationSeconds: number;
  sampleRate: number;
  windowSeconds: number;
  rhythm: {
    tempoBpm: number | null;
    beatTimesSeconds: number[];
  };
  frames: ChromaFrame[];
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

function parseFeatureResponse(value: unknown): AudioFeatureResponse {
  if (!isRecord(value) || value.schemaVersion !== "1.0" || !Array.isArray(value.frames)
      || !isRecord(value.rhythm)) {
    throw new AudioWorkerError("Audio worker returned an unsupported feature response.", null);
  }
  if (typeof value.filename !== "string"
      || typeof value.durationSeconds !== "number" || !Number.isFinite(value.durationSeconds)
      || typeof value.sampleRate !== "number" || !Number.isInteger(value.sampleRate)
      || typeof value.windowSeconds !== "number" || !Number.isFinite(value.windowSeconds)) {
    throw new AudioWorkerError("Audio worker returned invalid audio metadata.", null);
  }

  const tempoBpm = value.rhythm.tempoBpm;
  const beatTimesSeconds = value.rhythm.beatTimesSeconds;
  if ((tempoBpm !== null && (typeof tempoBpm !== "number" || !Number.isFinite(tempoBpm) || tempoBpm <= 0))
      || !Array.isArray(beatTimesSeconds)
      || beatTimesSeconds.some((beat) => typeof beat !== "number" || !Number.isFinite(beat) || beat < 0)) {
    throw new AudioWorkerError("Audio worker returned invalid rhythm data.", null);
  }

  const frames = value.frames.map((frame, index): ChromaFrame => {
    if (!isRecord(frame)
        || typeof frame.startSeconds !== "number" || !Number.isFinite(frame.startSeconds)
        || typeof frame.endSeconds !== "number" || !Number.isFinite(frame.endSeconds)
        || frame.startSeconds < 0 || frame.endSeconds < frame.startSeconds
        || !Array.isArray(frame.chroma) || frame.chroma.length !== 12
        || frame.chroma.some((sample) => typeof sample !== "number"
          || !Number.isFinite(sample) || sample < 0 || sample > 1)) {
      throw new AudioWorkerError(`Audio worker returned invalid chroma data for frame ${index}.`, null);
    }
    return {
      startSeconds: frame.startSeconds,
      endSeconds: frame.endSeconds,
      chroma: frame.chroma as number[],
    };
  });

  return {
    schemaVersion: "1.0",
    filename: value.filename,
    durationSeconds: value.durationSeconds,
    sampleRate: value.sampleRate,
    windowSeconds: value.windowSeconds,
    rhythm: {
      tempoBpm,
      beatTimesSeconds: beatTimesSeconds as number[],
    },
    frames,
  };
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
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 600_000) {
    throw new RangeError("timeoutMs must be an integer between 1000 and 600000.");
  }

  let endpoint: string;
  try {
    endpoint = new URL("/v1/features/chroma", input.baseUrl).toString();
  } catch {
    throw new TypeError("baseUrl must be an absolute HTTP(S) URL.");
  }
  const parsedUrl = new URL(endpoint);
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new TypeError("baseUrl must use HTTP or HTTPS.");
  }

  const form = new FormData();
  form.append("file", audio, input.filename || "audio-upload");
  form.append("windowSeconds", String(windowSeconds));

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
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
  return parseFeatureResponse(payload);
}
