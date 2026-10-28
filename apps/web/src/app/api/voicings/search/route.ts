import {
  searchVoicings,
} from "@interactive-guitar-lab/music-theory";
import {
  apiError,
  apiErrorFromException,
  isRecord,
  validateChordQuality,
  validateVoicingSearchOptions,
} from "@/lib/api";

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
  if (typeof body.root !== "string" || body.root.trim() === "") {
    return apiError(400, "invalid_request", "root must be a non-empty note name.");
  }
  if (!validateChordQuality(body.quality)) {
    return apiError(400, "invalid_request", "quality must be a supported chord quality.");
  }

  try {
    const options = validateVoicingSearchOptions(body.options);
    return Response.json(searchVoicings(body.root, body.quality, options));
  } catch (error) {
    return apiErrorFromException(error);
  }
}
