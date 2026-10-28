import {
  optimizeVoicingProgression,
  type ProgressionCandidateInput,
} from "@interactive-guitar-lab/music-theory";
import {
  apiError,
  apiErrorFromException,
  isRecord,
  validateProgressionOptimizationOptions,
} from "@/lib/api";

const MAX_LAYERS = 12;
const MAX_CANDIDATES_PER_LAYER = 32;
const MAX_TOTAL_CANDIDATES = 192;
const MAX_RESULT_LIMIT = 20;

function parseCandidateLayers(value: unknown): ProgressionCandidateInput[][] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_LAYERS) {
    throw new RangeError(`layers must contain between 1 and ${MAX_LAYERS} chord layers.`);
  }

  let totalCandidates = 0;
  return value.map((layer, layerIndex) => {
    if (!Array.isArray(layer) || layer.length === 0 || layer.length > MAX_CANDIDATES_PER_LAYER) {
      throw new RangeError(
        `layers[${layerIndex}] must contain between 1 and ${MAX_CANDIDATES_PER_LAYER} candidates.`,
      );
    }
    totalCandidates += layer.length;
    if (totalCandidates > MAX_TOTAL_CANDIDATES) {
      throw new RangeError(`The request may contain at most ${MAX_TOTAL_CANDIDATES} total candidates.`);
    }

    return layer.map((candidate) => {
      if (!isRecord(candidate)) {
        throw new TypeError("Each progression candidate must be a JSON object.");
      }
      // Candidates may be a raw Voicing or { voicing, chordConfidence?, candidateScore? }.
      if ("voicing" in candidate) {
        if (!isRecord(candidate.voicing)) {
          throw new TypeError("Wrapped candidates must contain a voicing object.");
        }
        return candidate as unknown as ProgressionCandidateInput;
      }
      if (typeof candidate.chordSymbol !== "string" || !Array.isArray(candidate.strings)) {
        throw new TypeError("Each candidate must be a voicing or a wrapped voicing candidate.");
      }
      return candidate as unknown as ProgressionCandidateInput;
    });
  });
}

/**
 * POST /api/progressions/optimize
 * Runs the shared k-best optimizer without requiring the browser to import the engine.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "invalid_request", "Request body must be valid JSON.");
  }
  if (!isRecord(body)) {
    return apiError(400, "invalid_request", "Request body must be a JSON object.");
  }
  for (const key of Object.keys(body)) {
    if (key !== "layers" && key !== "options") {
      return apiError(400, "invalid_request", `Unknown progression optimization field: ${key}.`);
    }
  }

  try {
    const layers = parseCandidateLayers(body.layers);
    const options = validateProgressionOptimizationOptions(body.options, MAX_RESULT_LIMIT);
    return Response.json(optimizeVoicingProgression(layers, options));
  } catch (error) {
    return apiErrorFromException(error);
  }
}
