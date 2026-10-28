import { optimizeVoicingProgression } from "@interactive-guitar-lab/music-theory";
import type { ProgressionOptimizationRequest, ProgressionOptimizationResult } from "./contract";
import { toServiceError } from "./errors";
import type { RequestOptions } from "./guitarLabService";

/**
 * There is no progression-optimization HTTP route yet, so both adapters call the shared
 * engine's optimizer in-process. Replace this with an HTTP call once
 * `POST /api/progressions/optimize` exists; the UI will not need to change.
 */
export async function optimizeProgressionInProcess(
  { layers, options }: ProgressionOptimizationRequest,
  requestOptions?: RequestOptions,
): Promise<ProgressionOptimizationResult> {
  await Promise.resolve();
  requestOptions?.signal?.throwIfAborted();
  try {
    return optimizeVoicingProgression(layers, options);
  } catch (error) {
    throw toServiceError(error);
  }
}
