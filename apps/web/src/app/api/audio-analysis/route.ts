import {
  analyzeAudioForChords,
  AudioWorkerError,
  type ChromaProgressionAnalysisOptions,
} from "@interactive-guitar-lab/audio-analysis";
import {
  getSupportedChordQualities,
  type ChordQuality,
} from "@interactive-guitar-lab/music-theory";
import {
  apiError,
  apiErrorFromException,
  isRecord,
  validateChordQuality,
  validateProgressionOptimizationOptions,
  validateVoicingSearchOptions,
} from "@/lib/api";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const ANALYSIS_OPTION_KEYS = new Set([
  "chordCandidateLimit",
  "voicingsPerChord",
  "chordQualities",
  "bassRootBonus",
  "voicingSearchOptions",
  "progressionOptions",
]);

function parseAnalysisOptions(value: unknown): ChromaProgressionAnalysisOptions {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new TypeError("options must be a JSON object.");
  for (const key of Object.keys(value)) {
    if (!ANALYSIS_OPTION_KEYS.has(key)) throw new TypeError(`Unknown audio analysis option: ${key}.`);
  }

  const parsed: ChromaProgressionAnalysisOptions = {};
  if (value.chordCandidateLimit !== undefined) {
    if (typeof value.chordCandidateLimit !== "number"
        || !Number.isInteger(value.chordCandidateLimit)
        || value.chordCandidateLimit < 1 || value.chordCandidateLimit > 72) {
      throw new RangeError("options.chordCandidateLimit must be an integer from 1 to 72.");
    }
    parsed.chordCandidateLimit = value.chordCandidateLimit;
  }
  if (value.voicingsPerChord !== undefined) {
    if (typeof value.voicingsPerChord !== "number"
        || !Number.isInteger(value.voicingsPerChord)
        || value.voicingsPerChord < 1 || value.voicingsPerChord > 50) {
      throw new RangeError("options.voicingsPerChord must be an integer from 1 to 50.");
    }
    parsed.voicingsPerChord = value.voicingsPerChord;
  }
  if (value.bassRootBonus !== undefined) {
    if (typeof value.bassRootBonus !== "number"
        || !Number.isFinite(value.bassRootBonus)
        || value.bassRootBonus < 0 || value.bassRootBonus > 0.25) {
      throw new RangeError("options.bassRootBonus must be between 0 and 0.25.");
    }
    parsed.bassRootBonus = value.bassRootBonus;
  }
  if (value.chordQualities !== undefined) {
    if (!Array.isArray(value.chordQualities) || value.chordQualities.length === 0
        || value.chordQualities.some((quality) => !validateChordQuality(quality))) {
      throw new TypeError(
        `options.chordQualities must contain supported qualities: ${getSupportedChordQualities().join(", ")}.`,
      );
    }
    if (new Set(value.chordQualities).size !== value.chordQualities.length) {
      throw new TypeError("options.chordQualities must not contain duplicates.");
    }
    parsed.chordQualities = value.chordQualities as ChordQuality[];
  }
  if (value.voicingSearchOptions !== undefined) {
    const { limit: _ignoredLimit, ...searchOptions } = validateVoicingSearchOptions(value.voicingSearchOptions);
    parsed.voicingSearchOptions = searchOptions;
  }
  if (value.progressionOptions !== undefined) {
    parsed.progressionOptions = validateProgressionOptimizationOptions(value.progressionOptions, 100, "options.progressionOptions");
  }
  return parsed;
}

export async function POST(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError(400, "invalid_request", "Request body must be multipart form data.");
  }

  const uploaded = form.get("file");
  if (uploaded === null || typeof uploaded === "string") {
    return apiError(400, "invalid_request", "A file field is required.");
  }
  if (uploaded.size === 0) {
    return apiError(400, "invalid_request", "The uploaded audio file is empty.");
  }
  if (uploaded.size > MAX_UPLOAD_BYTES) {
    return apiError(413, "invalid_request", "Audio files must be 25 MiB or smaller.");
  }

  const windowText = form.get("windowSeconds");
  let windowSeconds: number | undefined;
  if (windowText !== null) {
    if (typeof windowText !== "string" || windowText.trim() === "") {
      return apiError(400, "invalid_request", "windowSeconds must be a number from 0.1 to 2.0.");
    }
    windowSeconds = Number(windowText);
    if (!Number.isFinite(windowSeconds) || windowSeconds < 0.1 || windowSeconds > 2) {
      return apiError(400, "invalid_request", "windowSeconds must be a number from 0.1 to 2.0.");
    }
  }

  const optionsText = form.get("options");
  let rawOptions: unknown;
  if (optionsText !== null) {
    if (typeof optionsText !== "string") {
      return apiError(400, "invalid_request", "options must be JSON encoded as a form field.");
    }
    try {
      rawOptions = JSON.parse(optionsText) as unknown;
    } catch {
      return apiError(400, "invalid_request", "options must contain valid JSON.");
    }
  }

  try {
    const chordAnalysis = parseAnalysisOptions(rawOptions);
    const result = await analyzeAudioForChords(uploaded, {
      baseUrl: process.env.AUDIO_WORKER_URL ?? "http://127.0.0.1:8010",
      filename: uploaded.name || "audio-upload",
      ...(windowSeconds === undefined ? {} : { windowSeconds }),
      chordAnalysis,
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof AudioWorkerError) {
      if (error.statusCode === 400) return apiError(400, "invalid_request", error.message);
      if (error.statusCode === 413) return apiError(413, "invalid_request", error.message);
      return apiError(502, "internal_error", "Audio analysis worker is unavailable or failed.");
    }
    return apiErrorFromException(error);
  }
}
