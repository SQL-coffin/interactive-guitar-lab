import {
  getFretboard,
  STANDARD_GUITAR_TUNING,
} from "@interactive-guitar-lab/music-theory";
import { apiError, apiErrorFromException } from "@/lib/api";

export function GET(request: Request): Response {
  const params = new URL(request.url).searchParams;
  const maxFretText = params.get("maxFret");
  if (maxFretText === null || maxFretText.trim() === "") {
    return apiError(400, "invalid_request", "maxFret query parameter is required.");
  }

  const maxFret = Number(maxFretText);
  if (!Number.isInteger(maxFret) || maxFret < 0 || maxFret > 36) {
    return apiError(400, "invalid_request", "maxFret must be an integer from 0 to 36.");
  }

  let tuning: number[] = [...STANDARD_GUITAR_TUNING];
  const tuningText = params.get("tuning");
  if (tuningText !== null) {
    const entries = tuningText.split(",");
    if (!entries.length || entries.some((entry) => entry.trim() === "")) {
      return apiError(400, "invalid_request", "tuning must be comma-separated MIDI note numbers.");
    }
    tuning = entries.map(Number);
    if (tuning.some((midi) => !Number.isInteger(midi) || midi < 0 || midi > 127)) {
      return apiError(400, "invalid_request", "tuning must contain valid MIDI note numbers from 0 to 127.");
    }
  }

  try {
    return Response.json({
      tuning,
      maxFret,
      positions: getFretboard({ tuning, maxFret }),
    });
  } catch (error) {
    return apiErrorFromException(error);
  }
}
