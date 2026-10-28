import type { AudioAnalysisResponse } from "@/services";

export interface MeterInfo {
  tempoBpm: number | null;
  /** Both null when the backend could not determine the meter; never defaulted to 4/4. */
  numerator: number | null;
  denominator: number | null;
  known: boolean;
  /** Heuristic separation score from the backend (0–1), not a calibrated probability. */
  confidence: number | null;
  barDurationSeconds: number | null;
  downbeatTimesSeconds: number[];
  beatTimesSeconds: number[];
  windowingMode: "beat-aligned" | "fixed-window" | "unknown";
}

/** Below this the UI adds a caution; it is a display threshold, not a property of the estimator. */
export const LOW_METER_CONFIDENCE = 0.5;

/**
 * Reads meter fields from the analysis response. Sessions saved before the metrical backend
 * existed have none of these fields, so every one is optional at runtime.
 */
export function readMeter(result: Readonly<AudioAnalysisResponse>): MeterInfo {
  const rhythm = result.audio.rhythm as Partial<AudioAnalysisResponse["audio"]["rhythm"]>;
  const numerator = rhythm.timeSignatureNumerator ?? null;
  const denominator = rhythm.timeSignatureDenominator ?? null;
  const downbeats = [...(rhythm.downbeatTimesSeconds ?? [])].sort((a, b) => a - b);
  const known = numerator !== null && denominator !== null && downbeats.length > 0;
  const mode = (result.audio as { windowingMode?: string }).windowingMode;
  return {
    tempoBpm: rhythm.tempoBpm ?? null,
    numerator: known ? numerator : null,
    denominator: known ? denominator : null,
    known,
    confidence: rhythm.meterConfidence ?? null,
    barDurationSeconds: known ? rhythm.barDurationSeconds ?? null : null,
    downbeatTimesSeconds: known ? downbeats : [],
    beatTimesSeconds: [...(rhythm.beatTimesSeconds ?? [])].sort((a, b) => a - b),
    windowingMode: mode === "beat-aligned" || mode === "fixed-window" ? mode : "unknown",
  };
}

export function timeSignatureLabel(meter: MeterInfo): string {
  return meter.known ? `${meter.numerator}/${meter.denominator}` : "Unknown";
}
