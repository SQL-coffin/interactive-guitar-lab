import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeAudioForChords } from "./analyze-audio.js";
import { extractAudioFeatures } from "./worker-client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function workerPayload() {
  return {
    schemaVersion: "1.0",
    filename: "song.wav",
    durationSeconds: 0.5,
    sampleRate: 22050,
    windowSeconds: 0.5,
    rhythm: { tempoBpm: 120, beatTimesSeconds: [0, 0.5] },
    frames: [{ startSeconds: 0, endSeconds: 0.5, chroma: Array.from({ length: 12 }, (_, i) => i === 0 ? 1 : 0), bassPitchClass: 9 }],
  };
}

describe("audio worker HTTP client", () => {
  it("sends multipart audio and validates the feature response", async () => {
    const mockFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(workerPayload()), { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);
    const result = await extractAudioFeatures(new Blob(["audio"], { type: "audio/wav" }), {
      baseUrl: "http://127.0.0.1:8010",
      filename: "song.wav",
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch.mock.calls[0]![0]).toBe("http://127.0.0.1:8010/v1/features/chroma");
    expect(result.frames).toHaveLength(1);
    expect(result.frames[0]!.chroma[0]).toBe(1);
    expect(result.rhythm.tempoBpm).toBe(120);
    expect(result.rhythm.beatTimesSeconds).toEqual([0, 0.5]);
    expect(result.windowingMode).toBe("fixed-window");
    expect(result.frames[0]!.bassPitchClass).toBe(9);
    const requestInit = mockFetch.mock.calls[0]![1];
    expect(requestInit?.method).toBe("POST");
    expect(requestInit?.body).toBeInstanceOf(FormData);
  });

  it("validates and preserves the meter/downbeat fields from the worker", async () => {
    const base = workerPayload();
    const payload = {
      ...base,
      windowingMode: "beat-aligned",
      rhythm: {
        ...base.rhythm,
        timeSignatureNumerator: 3,
        timeSignatureDenominator: 4,
        meterConfidence: 0.81,
        barDurationSeconds: 1.5,
        downbeatTimesSeconds: [0],
      },
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })));
    const result = await extractAudioFeatures(new Blob(["audio"]), {
      baseUrl: "http://127.0.0.1:8010",
      filename: "song.wav",
    });
    expect(result.windowingMode).toBe("beat-aligned");
    expect(result.rhythm).toMatchObject({
      timeSignatureNumerator: 3,
      timeSignatureDenominator: 4,
      meterConfidence: 0.81,
      barDurationSeconds: 1.5,
      downbeatTimesSeconds: [0],
    });
  });

  it("forwards auto strategy and accepts adaptive beat-aligned responses", async () => {
    const payload = {
      ...workerPayload(),
      windowStrategy: "auto",
      windowingMode: "adaptive-beat-aligned",
      windowSeconds: 2,
    };
    const mockFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(payload), { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);
    const result = await extractAudioFeatures(new Blob(["audio"]), {
      baseUrl: "http://127.0.0.1:8010",
      filename: "song.wav",
      windowStrategy: "auto",
    });
    const form = mockFetch.mock.calls[0]![1]?.body as FormData;
    expect(form.get("windowStrategy")).toBe("auto");
    expect(result.windowStrategy).toBe("auto");
    expect(result.windowingMode).toBe("adaptive-beat-aligned");
    expect(result.windowSeconds).toBe(2);
  });

  it("propagates structured worker errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ detail: "Unable to decode audio." }),
      { status: 400 },
    )));
    await expect(extractAudioFeatures(new Blob(["bad"]), {
      baseUrl: "http://127.0.0.1:8010",
      filename: "bad.mp3",
    })).rejects.toMatchObject({ message: "Unable to decode audio.", statusCode: 400 });
  });

  it("rejects malformed responses before they reach chord inference", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      ...workerPayload(),
      frames: [{ startSeconds: 0, endSeconds: 0.5, chroma: [1, 2] }],
    }), { status: 200 })));
    await expect(extractAudioFeatures(new Blob(["audio"]), {
      baseUrl: "http://127.0.0.1:8010",
      filename: "song.wav",
    })).rejects.toThrow("invalid chroma data");
  });

  it("validates worker URL and request settings", async () => {
    await expect(extractAudioFeatures(new Blob(["audio"]), {
      baseUrl: "not-a-url",
      filename: "song.wav",
    })).rejects.toThrow(TypeError);
    await expect(extractAudioFeatures(new Blob(["audio"]), {
      baseUrl: "http://127.0.0.1:8010",
      filename: "song.wav",
      windowSeconds: 3,
    })).rejects.toThrow(RangeError);
  });

  it("aborts the worker request when the caller's signal aborts", async () => {
    let workerSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      workerSignal = init?.signal ?? undefined;
      workerSignal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));
    const caller = new AbortController();
    const pending = extractAudioFeatures(new Blob(["audio"]), { baseUrl: "http://127.0.0.1:8010", filename: "a.wav", signal: caller.signal });
    caller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AudioWorkerError" });
    expect(workerSignal?.aborted).toBe(true);
  });

  it("runs the complete mocked audio-to-chord-to-voicing pipeline", async () => {
    const aMaj7 = Array.from({ length: 12 }, (_, i) => [9, 1, 4, 8].includes(i) ? 1 : 0);
    const fSharpMinor7 = Array.from({ length: 12 }, (_, i) => [6, 9, 1, 4].includes(i) ? 1 : 0);
    const payload = {
      ...workerPayload(),
      durationSeconds: 1,
      frames: [
        { startSeconds: 0, endSeconds: 0.5, chroma: aMaj7, bassPitchClass: 9 },
        { startSeconds: 0.5, endSeconds: 1, chroma: fSharpMinor7, bassPitchClass: 6 },
      ],
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })));

    const result = await analyzeAudioForChords(new Blob(["audio"], { type: "audio/wav" }), {
      baseUrl: "http://127.0.0.1:8010",
      filename: "song.wav",
      chordAnalysis: {
        chordCandidateLimit: 1,
        voicingsPerChord: 3,
        voicingSearchOptions: { maxFret: 8, maxFretSpan: 4 },
        progressionOptions: { limit: 1 },
      },
    });

    expect(result.audio.durationSeconds).toBe(1);
    expect(result.chordAnalysis.frameResults).toHaveLength(2);
    expect(result.chordAnalysis.optimization!.results[0]!.steps.map((step) => step.chordSymbol))
      .toEqual(["AMaj7", "F#m7"]);
  });
});
