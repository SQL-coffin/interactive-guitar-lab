import { buildChord } from "@interactive-guitar-lab/music-theory";
import { apiError, apiErrorFromException, validateChordQuality } from "@/lib/api";

export function GET(request: Request): Response {
  const url = new URL(request.url);
  const root = url.searchParams.get("root");
  const quality = url.searchParams.get("quality");

  if (!root || !quality) {
    return apiError(400, "invalid_request", "Both root and quality query parameters are required.");
  }
  if (!validateChordQuality(quality)) {
    return apiError(400, "invalid_request", `Unsupported chord quality: ${quality}.`);
  }

  try {
    return Response.json(buildChord(root, quality));
  } catch (error) {
    return apiErrorFromException(error);
  }
}
