// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as postAudioAnalysis } from "@/app/api/audio-analysis/route";

afterEach(() => vi.unstubAllGlobals());

const MiB = 1024 * 1024;
const URL_ = "http://localhost/api/audio-analysis";

function workerResponse(frameCount: number) {
  const chroma = Array.from({ length: 12 }, (_, pc) => ([0, 4, 7].includes(pc) ? 1 : 0));
  return new Response(JSON.stringify({
    schemaVersion: "1.0", filename: "a.wav", durationSeconds: frameCount, sampleRate: 22050, windowSeconds: 1,
    rhythm: { tempoBpm: null, beatTimesSeconds: [] },
    frames: Array.from({ length: frameCount }, (_, i) => ({ startSeconds: i, endSeconds: i + 1, chroma, bassPitchClass: 0 })),
  }), { status: 200 });
}

/** A multipart body streamed in 1 MiB chunks, recording how much the route actually read. */
function streamedUpload(fileBytes: number, { declareLength }: { declareLength: number | null }) {
  const boundary = "----igl-test";
  const head = new TextEncoder().encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.wav"\r\nContent-Type: audio/wav\r\n\r\n`);
  const tail = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
  const total = head.byteLength + fileBytes + tail.byteLength;
  const stats = { pulledBytes: 0, cancelled: false };
  let sentFile = 0;
  let sentHead = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      let chunk: Uint8Array;
      if (!sentHead) { chunk = head; sentHead = true; }
      else if (sentFile < fileBytes) { const n = Math.min(MiB, fileBytes - sentFile); chunk = new Uint8Array(n); sentFile += n; }
      else { controller.enqueue(tail); controller.close(); stats.pulledBytes += tail.byteLength; return; }
      stats.pulledBytes += chunk.byteLength;
      controller.enqueue(chunk);
    },
    cancel() { stats.cancelled = true; },
  });
  const headers: Record<string, string> = { "content-type": `multipart/form-data; boundary=${boundary}` };
  if (declareLength !== null) headers["content-length"] = String(declareLength);
  const request = new Request(URL_, { method: "POST", body, headers, duplex: "half" } as RequestInit);
  return { request, stats, total };
}

function form(fields: Record<string, string>, fileBytes = 16) {
  const data = new FormData();
  data.append("file", new File([new Uint8Array(fileBytes)], "a.wav", { type: "audio/wav" }));
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return new Request(URL_, { method: "POST", body: data });
}

describe("audio-analysis upload limits (before multipart parsing)", () => {
  it("rejects a declared Content-Length over the limit without reading the body", async () => {
    const worker = vi.fn();
    vi.stubGlobal("fetch", worker);
    const { request, stats } = streamedUpload(200 * MiB, { declareLength: 200 * MiB });
    const response = await postAudioAnalysis(request);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: { code: "invalid_request", message: "Request body must be 26 MiB or smaller." } });
    expect(stats.pulledBytes).toBeLessThan(2 * MiB); // at most the stream's initial buffered chunk
    expect(worker).not.toHaveBeenCalled();
  });

  it("stops reading an oversized body without Content-Length as soon as it crosses the limit", async () => {
    const worker = vi.fn();
    vi.stubGlobal("fetch", worker);
    const { request, stats, total } = streamedUpload(200 * MiB, { declareLength: null });
    const response = await postAudioAnalysis(request);
    expect(response.status).toBe(413);
    expect(stats.cancelled).toBe(true);
    expect(stats.pulledBytes).toBeLessThanOrEqual(28 * MiB);
    expect(stats.pulledBytes).toBeLessThan(total);
    expect(worker).not.toHaveBeenCalled();
  });

  it("does not trust an understated Content-Length", async () => {
    const { request, stats } = streamedUpload(40 * MiB, { declareLength: 1_000 });
    const response = await postAudioAnalysis(request);
    expect(response.status).toBe(413);
    expect(stats.pulledBytes).toBeLessThanOrEqual(28 * MiB);
  });

  it("still enforces the 25 MiB per-file limit inside an allowed request", async () => {
    const { request } = streamedUpload(25 * MiB + 512 * 1024, { declareLength: null });
    const response = await postAudioAnalysis(request);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { message: "Audio files must be 25 MiB or smaller." } });
  });

  it("accepts an ordinary streamed upload and forwards it to the worker", async () => {
    const worker = vi.fn(async () => workerResponse(4));
    vi.stubGlobal("fetch", worker);
    const { request } = streamedUpload(3 * MiB, { declareLength: null });
    const response = await postAudioAnalysis(request);
    expect(response.status).toBe(200);
    expect(worker).toHaveBeenCalledTimes(1);
  });

  it("rejects non-multipart bodies before reading them", async () => {
    const response = await postAudioAnalysis(new Request(URL_, { method: "POST", body: "{}", headers: { "content-type": "application/json" } }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { message: "Request body must be multipart form data." } });
  });
});

describe("audio-analysis work budget", () => {
  it("accepts the browser defaults", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => workerResponse(8)));
    const response = await postAudioAnalysis(form({
      windowSeconds: "1",
      options: JSON.stringify({ chordCandidateLimit: 3, voicingsPerChord: 5, voicingSearchOptions: { maxFret: 12, maxFretSpan: 4, minNotes: 4 }, progressionOptions: { limit: 3 } }),
    }));
    expect(response.status).toBe(200);
    const body = await response.json() as { chordAnalysis: { optimization: { results: unknown[] } } };
    expect(body.chordAnalysis.optimization.results).toHaveLength(3);
  });

  it("validates and forwards the auto window strategy", async () => {
    const worker = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const formData = init?.body as FormData;
      expect(formData.get("windowStrategy")).toBe("auto");
      return workerResponse(4);
    });
    vi.stubGlobal("fetch", worker);
    const response = await postAudioAnalysis(form({ windowStrategy: "auto" }));
    expect(response.status).toBe(200);
    expect(worker).toHaveBeenCalledOnce();
  });

  it("rejects an unsupported window strategy before calling the worker", async () => {
    const worker = vi.fn();
    vi.stubGlobal("fetch", worker);
    const response = await postAudioAnalysis(form({ windowStrategy: "guess" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "invalid_request", message: "windowStrategy must be either manual or auto." },
    });
    expect(worker).not.toHaveBeenCalled();
  });

  it("rejects an excessive candidate product before calling the worker", async () => {
    const worker = vi.fn();
    vi.stubGlobal("fetch", worker);
    const response = await postAudioAnalysis(form({ options: JSON.stringify({ chordCandidateLimit: 72, voicingsPerChord: 50 }) }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { message: expect.stringContaining("must be at most 30 (requested 3600)") } });
    expect(worker).not.toHaveBeenCalled();
  });

  it("caps the audio progression limit at 10 before calling the worker", async () => {
    const worker = vi.fn();
    vi.stubGlobal("fetch", worker);
    const response = await postAudioAnalysis(form({ options: JSON.stringify({ progressionOptions: { limit: 11 } }) }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { message: "options.progressionOptions.limit must be an integer from 1 to 10." } });
    expect(worker).not.toHaveBeenCalled();
  });

  it("returns 413 when the worker reports more frames than the budget allows", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => workerResponse(1_201)));
    const response = await postAudioAnalysis(form({ windowSeconds: "0.5" }));
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_request", message: expect.stringContaining("1201 analysis windows") } });
  });

  it("returns 413 for an over-budget workload without running it", { timeout: 3_000 }, async () => {
    vi.stubGlobal("fetch", vi.fn(async () => workerResponse(700)));
    const response = await postAudioAnalysis(form({ options: JSON.stringify({ chordCandidateLimit: 6, voicingsPerChord: 5 }) }));
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { message: expect.stringContaining("too large") } });
  });
});
