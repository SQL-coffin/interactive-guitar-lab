// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as postAudioAnalysis } from "@/app/api/audio-analysis/route";

afterEach(() => vi.unstubAllGlobals());

const chroma = Array.from({ length: 12 }, (_, pc) => ([0, 4, 7].includes(pc) ? 1 : 0));
const noteEvents = {
  schemaVersion: "1.0",
  model: { name: "heuristic-cqt-onset-baseline", version: "0.1.0", source: "heuristic", calibrated: false },
  frameRateHz: 86.1328,
  pitchRangeMidi: { min: 40, max: 88 },
  truncated: false,
  events: [{ pitchMidi: 60, onsetSeconds: 0.1, offsetSeconds: 0.9, onsetConfidence: 0.9, offsetConfidence: 0.8, pitchConfidence: 0.95, source: "heuristic" }],
};

function stubWorker() {
  const worker = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const requested = (init?.body as FormData).get("includeNoteEvents") === "true";
    return new Response(JSON.stringify({
      schemaVersion: "1.0", filename: "a.wav", durationSeconds: 1, sampleRate: 22050, windowSeconds: 0.5,
      rhythm: { tempoBpm: null, beatTimesSeconds: [] },
      frames: [{ startSeconds: 0, endSeconds: 1, chroma, bassPitchClass: 0 }],
      ...(requested ? { noteEvents } : {}),
    }), { status: 200 });
  });
  vi.stubGlobal("fetch", worker);
  return worker;
}

function request(fields: Record<string, string> = {}) {
  const form = new FormData();
  form.append("file", new File(["audio"], "a.wav", { type: "audio/wav" }));
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return new Request("http://localhost/api/audio-analysis", { method: "POST", body: form });
}

describe("audio-analysis opt-in note events", () => {
  it("keeps the default request and response unchanged", async () => {
    const worker = stubWorker();
    const response = await postAudioAnalysis(request());
    const body = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect((worker.mock.calls[0]![1]?.body as FormData).has("includeNoteEvents")).toBe(false);
    expect(body).not.toHaveProperty("noteEvents");
  });

  it("returns note events from the same worker call when requested", async () => {
    const worker = stubWorker();
    const response = await postAudioAnalysis(request({ includeNoteEvents: "true" }));
    const body = await response.json() as { noteEvents?: typeof noteEvents; chordSheet?: unknown };
    expect(response.status).toBe(200);
    expect(worker).toHaveBeenCalledOnce();
    expect(body.noteEvents?.events).toHaveLength(1);
    expect(body.chordSheet).toBeDefined();
  });

  it("rejects a malformed includeNoteEvents value before calling the worker", async () => {
    const worker = stubWorker();
    const response = await postAudioAnalysis(request({ includeNoteEvents: "yes" }));
    expect(response.status).toBe(400);
    expect(worker).not.toHaveBeenCalled();
  });
});
