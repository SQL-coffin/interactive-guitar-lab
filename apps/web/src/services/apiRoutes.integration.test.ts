// @vitest-environment node
import { describe, expect, it } from "vitest";
import { POST as optimizeRoute } from "@/app/api/progressions/optimize/route";
import { POST as searchRoute } from "@/app/api/voicings/search/route";
import { createHttpGuitarLabService } from "./httpAdapter";
import { PROGRESSION_OPTIMIZE_LIMITS } from "./contract";
import { candidatesPerChord, DEFAULT_PROGRESSION_SETTINGS, MAX_OPTIMIZE_SEGMENT, MAX_PROGRESSION_LENGTH, optimizeSegment } from "@/state/progressionState";

/**
 * Runs the real HTTP adapter against the real route handlers (no network, no mocks), so a
 * request the UI can build is proven to be accepted by the server, and contract drift fails here.
 */
const routes: Record<string, (request: Request) => Promise<Response>> = {
  "/api/voicings/search": searchRoute,
  "/api/progressions/optimize": optimizeRoute,
};
const fetchThroughRoutes: typeof fetch = async (input, init) => {
  const url = new URL(String(input), "http://localhost");
  const handler = routes[url.pathname];
  if (!handler) throw new Error(`No route for ${url.pathname}`);
  return handler(new Request(url, init));
};
const service = createHttpGuitarLabService("/api", fetchThroughRoutes);

async function layersFor(chordCount: number, requested: number) {
  const roots = ["C", "G", "A", "F", "D", "E"];
  const limit = candidatesPerChord(requested, chordCount);
  return Promise.all(
    Array.from({ length: chordCount }, (_, i) =>
      service.searchVoicings({ root: roots[i % roots.length]!, quality: "major", options: { maxFret: 12, maxFretSpan: 4, minNotes: 4, limit } })
        .then((r) => r.results)),
  );
}

describe("progression requests built by the UI are accepted by the real route", () => {
  it("keeps the largest UI progression within the server's candidate limits (regression: 12 x 20 → HTTP 400)", async () => {
    // Long progressions (e.g. from audio) are optimized in segments no larger than the route allows.
    expect(MAX_OPTIMIZE_SEGMENT).toBe(PROGRESSION_OPTIMIZE_LIMITS.maxLayers);
    const longest = Array.from({ length: MAX_PROGRESSION_LENGTH }, (_, i) => ({ id: String(i), root: "C", quality: "major" as const }));
    const segment = optimizeSegment({ slots: longest, settings: { ...DEFAULT_PROGRESSION_SETTINGS, segmentStart: 1_000 } });
    expect(segment.slots).toHaveLength(MAX_OPTIMIZE_SEGMENT);
    expect(segment.start).toBe(MAX_PROGRESSION_LENGTH - MAX_OPTIMIZE_SEGMENT);
    const layers = await layersFor(segment.slots.length, 20);
    expect(layers.flat().length).toBeLessThanOrEqual(PROGRESSION_OPTIMIZE_LIMITS.maxTotalCandidates);
    const result = await service.optimizeProgression({ layers, options: { limit: 5 } });
    expect(result.results).toHaveLength(5);
    expect(result.candidateCounts).toHaveLength(12);
  });

  it("uses the requested candidate count when it fits", async () => {
    const layers = await layersFor(4, DEFAULT_PROGRESSION_SETTINGS.voicingsPerChord);
    expect(layers.map((l) => l.length)).toEqual([8, 8, 8, 8]);
    const result = await service.optimizeProgression({ layers, options: { limit: 3 } });
    expect(result.results[0]!.steps.map((s) => s.chordSymbol)).toEqual(["C", "G", "A", "F"]);
  });

  it("documents the server limits the UI relies on", async () => {
    const one = (await layersFor(1, 1))[0]![0]!;
    const tooMany = Array.from({ length: PROGRESSION_OPTIMIZE_LIMITS.maxLayers + 1 }, () => [one]);
    await expect(service.optimizeProgression({ layers: tooMany })).rejects.toMatchObject({ code: "invalid_request", status: 400 });
    const tooWide = [Array.from({ length: PROGRESSION_OPTIMIZE_LIMITS.maxCandidatesPerLayer + 1 }, () => one)];
    await expect(service.optimizeProgression({ layers: tooWide })).rejects.toMatchObject({ status: 400 });
    const overTotal = Array.from({ length: 7 }, () => Array.from({ length: 28 }, () => one));
    await expect(service.optimizeProgression({ layers: overTotal })).rejects.toMatchObject({ status: 400 });
    await expect(service.optimizeProgression({ layers: [[one]], options: { limit: PROGRESSION_OPTIMIZE_LIMITS.maxResultLimit + 1 } }))
      .rejects.toMatchObject({ status: 400 });
  });
});
