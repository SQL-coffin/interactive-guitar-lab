/**
 * Cross-language contract test: real Python worker responses must pass the TypeScript runtime
 * validators. Fixtures come from `services/audio-worker/contract_fixtures.py`.
 *
 * By default this reads the committed fixtures in contracts/audio-worker. CI regenerates them
 * from the current worker and points WORKER_CONTRACT_FIXTURES_DIR at the fresh copy, so the check
 * does not depend on someone remembering to update the committed files.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeAudioForChords } from "./analyze-audio.js";
import { extractAudioFeatures, extractNoteEvents } from "./worker-client.js";

const fixtureDir = resolve(process.env.WORKER_CONTRACT_FIXTURES_DIR ?? join(__dirname, "../../../contracts/audio-worker"));
const fixtures = new Map(
  readdirSync(fixtureDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => [name.slice(0, -".json".length), JSON.parse(readFileSync(join(fixtureDir, name), "utf8")) as Record<string, unknown>]),
);
const cases = ["silence", "single-tone", "overlapping-open-ended"];
const base = { baseUrl: "http://127.0.0.1:8010", filename: "fixture.wav" };

function serve(body: unknown) {
  const mockFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal("fetch", mockFetch);
  return mockFetch;
}

function fixture(key: string): Record<string, unknown> {
  const body = fixtures.get(key);
  if (!body) throw new Error(`Missing contract fixture ${key}.json in ${fixtureDir}`);
  return body;
}

afterEach(() => vi.unstubAllGlobals());

describe(`Python worker → TypeScript contract (${fixtureDir})`, () => {
  it("has a fixture for every endpoint variant and case", () => {
    for (const name of cases) {
      for (const prefix of ["note-events", "chroma-default", "chroma-with-note-events"]) {
        expect(fixtures.has(`${prefix}.${name}`), `${prefix}.${name}`).toBe(true);
      }
    }
  });

  it.each(cases)("accepts the /v1/features/note-events response for %s", async (name) => {
    const body = fixture(`note-events.${name}`);
    serve(body);
    const result = await extractNoteEvents(new Blob(["wav"]), base);
    expect(result.noteEvents).toEqual(body.noteEvents);
    const events = result.noteEvents.events;
    expect(events.map((event) => event.onsetSeconds)).toEqual([...events.map((event) => event.onsetSeconds)].sort((a, b) => a - b));
  });

  it.each(cases)("accepts the default chroma response for %s without note events", async (name) => {
    const body = fixture(`chroma-default.${name}`);
    expect(body).not.toHaveProperty("noteEvents");
    const mockFetch = serve(body);
    const features = await extractAudioFeatures(new Blob(["wav"]), base);
    expect((mockFetch.mock.calls[0]![1]?.body as FormData).has("includeNoteEvents")).toBe(false);
    expect(features).not.toHaveProperty("noteEvents");
    expect(features.frames).toHaveLength((body.frames as unknown[]).length);
  });

  it.each(cases)("accepts the opt-in chroma response for %s and leaves chord analysis unchanged", async (name) => {
    serve(fixture(`chroma-default.${name}`));
    const without = await analyzeAudioForChords(new Blob(["wav"]), base);
    const body = fixture(`chroma-with-note-events.${name}`);
    serve(body);
    const withEvents = await analyzeAudioForChords(new Blob(["wav"]), { ...base, includeNoteEvents: true });
    expect(withEvents.noteEvents).toEqual(body.noteEvents);
    const { noteEvents: _noteEvents, ...rest } = withEvents;
    expect(rest).toEqual(without);
  });

  it("captures the documented edge cases: no events for silence, null offset for an open-ended note", () => {
    const silence = fixture("note-events.silence").noteEvents as { events: unknown[] };
    expect(silence.events).toEqual([]);
    const open = fixture("note-events.overlapping-open-ended").noteEvents as { events: Array<{ offsetSeconds: number | null }> };
    expect(open.events).toHaveLength(2);
    expect(open.events[1]!.offsetSeconds).toBeNull();
  });
});
