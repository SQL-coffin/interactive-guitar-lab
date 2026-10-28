import {
  getSupportedChordQualities,
  type ProgressionOptimizationOptions,
  type VoicingSearchOptions,
} from "@interactive-guitar-lab/music-theory";
import type { ApiErrorBody, ApiErrorCode } from "@/services/contract";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function apiError(status: number, code: ApiErrorCode, message: string): Response {
  const body: ApiErrorBody = { error: { code, message } };
  return Response.json(body, { status });
}

export function apiErrorFromException(error: unknown): Response {
  if (error instanceof TypeError || error instanceof RangeError) {
    return apiError(400, "invalid_request", error.message);
  }
  // The client only sees a generic message, so keep the real cause in the server log.
  console.error("[api] unexpected error:", error);
  return apiError(500, "internal_error", "An unexpected server error occurred.");
}

/** Runtime validation is required because HTTP JSON is untrusted even with TS types. */
export function validateVoicingSearchOptions(value: unknown): VoicingSearchOptions {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new TypeError("options must be a JSON object.");

  const allowed = new Set([
    "tuning", "maxFret", "minFret", "maxFretSpan", "minNotes", "maxNotes",
    "rootString", "allowOpenStrings", "allowMutedStrings", "requireRoot",
    "requireAllTones", "limit",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`Unknown voicing option: ${key}.`);
  }

  for (const key of ["maxFret", "minFret", "maxFretSpan", "minNotes", "maxNotes", "rootString", "limit"]) {
    const candidate = value[key];
    if (candidate !== undefined && (typeof candidate !== "number" || !Number.isInteger(candidate))) {
      throw new TypeError(`options.${key} must be an integer.`);
    }
  }
  for (const key of ["allowOpenStrings", "allowMutedStrings", "requireRoot", "requireAllTones"]) {
    const candidate = value[key];
    if (candidate !== undefined && typeof candidate !== "boolean") {
      throw new TypeError(`options.${key} must be a boolean.`);
    }
  }
  const tuning = value.tuning;
  if (tuning !== undefined && (!Array.isArray(tuning)
      || tuning.some((midi) => typeof midi !== "number" || !Number.isInteger(midi) || midi < 0 || midi > 127))) {
    throw new TypeError("options.tuning must be an array of valid MIDI note numbers.");
  }

  return value as unknown as VoicingSearchOptions;
}

/**
 * Shares progression weight validation between audio analysis and the standalone optimizer API.
 * The route may lower maxLimit to constrain the amount of work requested over HTTP.
 */
export function validateProgressionOptimizationOptions(
  value: unknown,
  maxLimit = 100,
  fieldPath = "options",
): ProgressionOptimizationOptions {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new TypeError(`${fieldPath} must be a JSON object.`);

  const allowed = new Set([
    "limit",
    "localScoreWeight",
    "chordConfidenceWeight",
    "positionShiftWeight",
    "stringMovementWeight",
    "muteChangeWeight",
    "bassMovementWeight",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`Unknown progression option: ${key}.`);
  }

  const parsed: ProgressionOptimizationOptions = {};
  if (value.limit !== undefined) {
    if (typeof value.limit !== "number" || !Number.isInteger(value.limit) || value.limit < 1 || value.limit > maxLimit) {
      throw new RangeError(`${fieldPath}.limit must be an integer from 1 to ${maxLimit}.`);
    }
    parsed.limit = value.limit;
  }
  for (const key of [
    "localScoreWeight",
    "chordConfidenceWeight",
    "positionShiftWeight",
    "stringMovementWeight",
    "muteChangeWeight",
    "bassMovementWeight",
  ] as const) {
    const candidate = value[key];
    if (candidate === undefined) continue;
    if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < 0) {
      throw new RangeError(`${fieldPath}.${key} must be a finite non-negative number.`);
    }
    parsed[key] = candidate;
  }
  return parsed;
}

export function validateChordQuality(value: unknown): value is ReturnType<typeof getSupportedChordQualities>[number] {
  return typeof value === "string" && getSupportedChordQualities().includes(
    value as ReturnType<typeof getSupportedChordQualities>[number],
  );
}
