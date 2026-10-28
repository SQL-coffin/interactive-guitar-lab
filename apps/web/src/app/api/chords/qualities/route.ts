import { getSupportedChordQualities } from "@interactive-guitar-lab/music-theory";

export function GET(): Response {
  return Response.json({ qualities: getSupportedChordQualities() });
}
