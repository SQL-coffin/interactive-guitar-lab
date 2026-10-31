import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeAudioForChords } from "./analyze-audio.js";
import { analyzeAudioNoteEvents } from "./analyze-note-events.js";
import { extractAudioFeatures, extractNoteEvents } from "./worker-client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const C_MAJOR = Array.from({ length: 12 }, (_, pc) => ([0, 4, 7].includes(pc) ? 1 : 0));

function noteEvents(events: unknown[] = [
  { pitchMidi: 57, onsetSeconds: 0.2, offsetSeconds: 0.9, onsetConfidence: 0.85, offsetConfidence: 0.99, pitchConfidence: 0.99, source: "heuristic" },
  { pitchMidi: 64, onsetSeconds: 0.5, offsetSeconds: null, onsetConfidence: 0.9, offsetConfidence: null, pitchConfidence: 0.98, source: "heuristic" },
]) {
  return {
    schemaVersion: "1.0",
    model: { name: "heuristic-cqt-onset-baseline", version: "0.1.0", source: "heuristic", calibrated: false },
    frameRateHz: 86.1328,
    pitchRangeMidi: { min: 40, max: 88 },
    truncated: false,
    events,
  };
}

function chromaPayload(extra: Record<string, unknown> = {}) {
  return {
    schemaVersion: "1.0",
    filename: "song.wav",
    durationSeconds: 1,
    sampleRate: 22050,
    windowSeconds: 0.5,
    rhythm: { tempoBpm: null, beatTimesSeconds: [] },
    frames: [
      { startSeconds: 0, endSeconds: 0.5, chroma: C_MAJOR, bassPitchClass: 0 },
      { startSeconds: 0.5, endSeconds: 1, chroma: C_MAJOR, bassPitchClass: 0 },
    ],
    ...extra,
  };
}

function noteEventPayload(events?: unknown[]) {
  return { schemaVersion: "1.0", filename: "riff.wav", durationSeconds: 1, sampleRate: 22050, noteEvents: noteEvents(events) };
}

function respondWith(payload: unknown) {
  const mockFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify(payload), { status: 200 }));
  vi.stubGlobal("fetch", mockFetch);
  return mockFetch;
}

const base = { baseUrl: "http://127.0.0.1:8010", filename: "song.wav" };

describe("note-event worker client", () => {
  it("posts to the dedicated endpoint and validates the response", async () => {
    const mockFetch = respondWith(noteEventPayload());
    const result = await extractNoteEvents(new Blob(["audio"]), base);
    expect(mockFetch.mock.calls[0]![0]).toBe("http://127.0.0.1:8010/v1/features/note-events");
    const form = mockFetch.mock.calls[0]![1]?.body as FormData;
    expect([...form.keys()]).toEqual(["file"]);
    expect(result.noteEvents.events.map((event) => event.pitchMidi)).toEqual([57, 64]);
    expect(result.noteEvents.events[1]!.offsetSeconds).toBeNull();
  });

  it("rejects invalid timestamps and confidences from the worker", async () => {
    for (const bad of [
      { pitchMidi: 57, onsetSeconds: -1, offsetSeconds: 0.5, onsetConfidence: 0.5, offsetConfidence: 0.5, pitchConfidence: 0.5, source: "heuristic" },
      { pitchMidi: 57, onsetSeconds: 0.2, offsetSeconds: 0.1, onsetConfidence: 0.5, offsetConfidence: 0.5, pitchConfidence: 0.5, source: "heuristic" },
      { pitchMidi: 57, onsetSeconds: 0.2, offsetSeconds: 0.5, onsetConfidence: 2, offsetConfidence: 0.5, pitchConfidence: 0.5, source: "heuristic" },
      { pitchMidi: 57, onsetSeconds: 0.2, offsetSeconds: 5, onsetConfidence: 0.5, offsetConfidence: 0.5, pitchConfidence: 0.5, source: "heuristic" },
    ]) {
      respondWith(noteEventPayload([bad]));
      await expect(extractNoteEvents(new Blob(["audio"]), base)).rejects.toMatchObject({
        name: "AudioWorkerError",
        message: expect.stringContaining("invalid note events"),
      });
    }
  });

  it("rejects unsorted events from the worker", async () => {
    const [first, second] = noteEvents().events;
    respondWith(noteEventPayload([second, first]));
    await expect(extractNoteEvents(new Blob(["audio"]), base)).rejects.toThrow("sorted");
  });

  it("propagates caller cancellation to the worker request", async () => {
    let workerSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      workerSignal = init?.signal ?? undefined;
      workerSignal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));
    const caller = new AbortController();
    const pending = extractNoteEvents(new Blob(["audio"]), { ...base, signal: caller.signal });
    caller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AudioWorkerError" });
    expect(workerSignal?.aborted).toBe(true);
  });

  it("fails with an AudioWorkerError when the worker exceeds the timeout", async () => {
    let workerSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      workerSignal = init?.signal ?? undefined;
      workerSignal?.addEventListener("abort", () => reject(workerSignal?.reason));
    })));
    await expect(extractNoteEvents(new Blob(["audio"]), { ...base, timeoutMs: 1_000 }))
      .rejects.toMatchObject({ name: "AudioWorkerError", message: expect.stringContaining("request failed") });
    expect(workerSignal?.aborted).toBe(true);
    expect((workerSignal?.reason as DOMException).name).toBe("TimeoutError");
  });

  it("applies the same timeout and URL validation as the chroma client", async () => {
    await expect(extractNoteEvents(new Blob(["a"]), { ...base, timeoutMs: 999 })).rejects.toThrow(RangeError);
    await expect(extractNoteEvents(new Blob(["a"]), { ...base, baseUrl: "ftp://worker" })).rejects.toThrow(TypeError);
  });

  it("maps worker HTTP errors like the chroma client", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "Audio duration exceeds the 600-second limit." }), { status: 400 })));
    await expect(extractNoteEvents(new Blob(["a"]), base)).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining("600-second") });
  });

  it("summarises events in the standalone orchestration", async () => {
    respondWith(noteEventPayload());
    const result = await analyzeAudioNoteEvents(new Blob(["audio"]), base);
    expect(result.audio).toEqual({ schemaVersion: "1.0", filename: "riff.wav", durationSeconds: 1, sampleRate: 22050 });
    expect(result.summary).toMatchObject({ eventCount: 2, unresolvedOffsetCount: 1, maxPolyphony: 2 });
  });
});

describe("opt-in note events on the chroma request", () => {
  it("does not request or return note events by default", async () => {
    const mockFetch = respondWith(chromaPayload());
    const features = await extractAudioFeatures(new Blob(["audio"]), base);
    const form = mockFetch.mock.calls[0]![1]?.body as FormData;
    expect(form.has("includeNoteEvents")).toBe(false);
    expect("noteEvents" in features).toBe(false);
  });

  it("ignores an unrequested noteEvents field so the chroma contract is unchanged", async () => {
    respondWith(chromaPayload({ noteEvents: { garbage: true } }));
    const features = await extractAudioFeatures(new Blob(["audio"]), base);
    expect("noteEvents" in features).toBe(false);
  });

  it("requests note events from the same upload and keeps chord analysis identical", async () => {
    respondWith(chromaPayload());
    const without = await analyzeAudioForChords(new Blob(["audio"]), base);
    const mockFetch = respondWith(chromaPayload({ noteEvents: noteEvents() }));
    const withEvents = await analyzeAudioForChords(new Blob(["audio"]), { ...base, includeNoteEvents: true });

    expect(mockFetch).toHaveBeenCalledOnce();
    const form = mockFetch.mock.calls[0]![1]?.body as FormData;
    expect(form.get("includeNoteEvents")).toBe("true");
    expect(Object.keys(without).sort()).toEqual(["audio", "chordAnalysis", "chordSheet", "keyAnalysis", "keyChangeDetection"]);
    const { noteEvents: events, ...rest } = withEvents;
    expect(rest).toEqual(without);
    expect("noteEvents" in withEvents.audio).toBe(false);
    expect(events?.events).toHaveLength(2);
  });

  it("rejects a requested but missing or invalid noteEvents block", async () => {
    respondWith(chromaPayload());
    await expect(extractAudioFeatures(new Blob(["audio"]), { ...base, includeNoteEvents: true }))
      .rejects.toThrow("invalid note events");
  });
});
