// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { searchVoicings } from "@interactive-guitar-lab/music-theory";
import { GET as getQualities } from "@/app/api/chords/qualities/route";
import { GET as getChord } from "@/app/api/chords/route";
import { POST as postVoicingSearch } from "@/app/api/voicings/search/route";
import { GET as getFretboard } from "@/app/api/fretboard/route";
import { POST as postAudioAnalysis } from "@/app/api/audio-analysis/route";
import { POST as postProgressionOptimization } from "@/app/api/progressions/optimize/route";

afterEach(() => vi.unstubAllGlobals());

describe("Next.js backend API routes", () => {
  it("exposes the engine-supported chord qualities", async () => {
    const response = getQualities();
    const body = await response.json() as { qualities: string[] };
    expect(response.status).toBe(200);
    expect(body.qualities).toContain("major7");
    expect(body.qualities).toContain("minor7");
    expect(body.qualities).toEqual(expect.arrayContaining(["sus2", "augmented", "diminished", "add9"]));
  });

  it("builds a chord and returns contract-shaped validation errors", async () => {
    const valid = await getChord(new Request("http://localhost/api/chords?root=A&quality=major7"));
    const chord = await valid.json() as { symbol: string; tones: unknown[] };
    expect(valid.status).toBe(200);
    expect(chord.symbol).toBe("AMaj7");
    expect(chord.tones.length).toBe(4);

    const add9 = await getChord(new Request("http://localhost/api/chords?root=C&quality=add9"));
    const add9Body = await add9.json() as { symbol: string; formula: string[]; tones: Array<{ spelling: string }> };
    expect(add9.status).toBe(200);
    expect(add9Body.symbol).toBe("Cadd9");
    expect(add9Body.formula).toEqual(["1", "3", "5", "9"]);
    expect(add9Body.tones.map((tone) => tone.spelling)).toEqual(["C", "E", "G", "D"]);

    const missing = await getChord(new Request("http://localhost/api/chords?root=A"));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ error: { code: "invalid_request" } });

    const unsupported = await getChord(new Request("http://localhost/api/chords?root=A&quality=power999"));
    expect(unsupported.status).toBe(400);
  });

  it("searches playable voicings and rejects invalid JSON options", async () => {
    const response = await postVoicingSearch(new Request("http://localhost/api/voicings/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ root: "A", quality: "major7", options: { maxFret: 8, limit: 3 } }),
    }));
    const body = await response.json() as { results: Array<{ chordSymbol: string }> };
    expect(response.status).toBe(200);
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results.length).toBeLessThanOrEqual(3);
    expect(body.results[0]!.chordSymbol).toBe("AMaj7");

    const malformed = await postVoicingSearch(new Request("http://localhost/api/voicings/search", {
      method: "POST",
      body: "{",
    }));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: { code: "invalid_request" } });
  });

  it("returns fretboard positions and validates its parameters", async () => {
    const response = getFretboard(new Request("http://localhost/api/fretboard?maxFret=2"));
    const body = await response.json() as { tuning: number[]; maxFret: number; positions: unknown[] };
    expect(response.status).toBe(200);
    expect(body.tuning).toEqual([40, 45, 50, 55, 59, 64]);
    expect(body.maxFret).toBe(2);
    expect(body.positions).toHaveLength(18);

    const missing = getFretboard(new Request("http://localhost/api/fretboard"));
    expect(missing.status).toBe(400);
    const badTuning = getFretboard(new Request("http://localhost/api/fretboard?maxFret=12&tuning=40,nope"));
    expect(badTuning.status).toBe(400);
  });

  it("runs the full audio endpoint and returns chord/fingering candidates", async () => {
    const aMaj7 = Array.from({ length: 12 }, (_, i) => [9, 1, 4, 8].includes(i) ? 1 : 0);
    const fSharpMinor7 = Array.from({ length: 12 }, (_, i) => [6, 9, 1, 4].includes(i) ? 1 : 0);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      schemaVersion: "1.0",
      filename: "song.wav",
      durationSeconds: 1,
      sampleRate: 22050,
      windowSeconds: 0.5,
      rhythm: { tempoBpm: 120, beatTimesSeconds: [0, 0.5] },
      frames: [
        { startSeconds: 0, endSeconds: 0.5, chroma: aMaj7 },
        { startSeconds: 0.5, endSeconds: 1, chroma: fSharpMinor7 },
      ],
    }), { status: 200 })));

    const form = new FormData();
    form.append("file", new File(["dummy audio"], "song.wav", { type: "audio/wav" }));
    form.append("windowSeconds", "0.5");
    form.append("options", JSON.stringify({
      chordCandidateLimit: 1,
      voicingsPerChord: 3,
      voicingSearchOptions: { maxFret: 8, maxFretSpan: 4 },
      progressionOptions: { limit: 1 },
    }));
    const response = await postAudioAnalysis(new Request("http://localhost/api/audio-analysis", {
      method: "POST",
      body: form,
    }));
    const body = await response.json() as {
      audio: { durationSeconds: number; rhythm: { tempoBpm: number | null } };
      chordAnalysis: { optimization: { results: Array<{ steps: Array<{ chordSymbol: string }> }> } | null };
    };

    expect(response.status).toBe(200);
    expect(body.audio.durationSeconds).toBe(1);
    expect(body.audio.rhythm.tempoBpm).toBe(120);
    expect(body.chordAnalysis.optimization!.results[0]!.steps.map((step) => step.chordSymbol))
      .toEqual(["AMaj7", "F#m7"]);
  });

  it("cancels the worker request when the client disconnects", async () => {
    let workerSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      workerSignal = init?.signal ?? undefined;
      workerSignal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = new AbortController();
    const form = new FormData();
    form.append("file", new File(["audio"], "song.wav", { type: "audio/wav" }));
    const pending = postAudioAnalysis(new Request("http://localhost/api/audio-analysis", {
      method: "POST",
      body: form,
      signal: client.signal,
    }));
    await vi.waitFor(() => expect(workerSignal).toBeDefined());
    client.abort();
    const response = await pending;
    expect(workerSignal!.aborted).toBe(true);
    expect(response.status).toBe(502);
    // A client cancel is not a worker outage, so it is not logged as one.
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("logs worker outages server-side without exposing configuration", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const form = new FormData();
    form.append("file", new File(["audio"], "song.wav", { type: "audio/wav" }));
    const response = await postAudioAnalysis(new Request("http://localhost/api/audio-analysis", { method: "POST", body: form }));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: { code: "internal_error", message: "Audio analysis worker is unavailable or failed." } });
    expect(errors).toHaveBeenCalledTimes(1);
    const logged = String(errors.mock.calls[0]![0]);
    expect(logged).toContain("[audio-analysis] worker failure");
    expect(logged).toContain("fetch failed");
    expect(logged).not.toContain("127.0.0.1");
    errors.mockRestore();
  });

  it("rejects malformed audio-analysis form data and options", async () => {
    const noFile = await postAudioAnalysis(new Request("http://localhost/api/audio-analysis", {
      method: "POST",
      body: new FormData(),
    }));
    expect(noFile.status).toBe(400);

    const form = new FormData();
    form.append("file", new File(["audio"], "song.wav", { type: "audio/wav" }));
    form.append("options", JSON.stringify({ chordCandidateLimit: 0 }));
    const invalidOptions = await postAudioAnalysis(new Request("http://localhost/api/audio-analysis", {
      method: "POST",
      body: form,
    }));
    expect(invalidOptions.status).toBe(400);
    expect(await invalidOptions.json()).toMatchObject({ error: { code: "invalid_request" } });
  });

  it("optimizes supplied progression candidates through the HTTP contract", async () => {
    const candidates = searchVoicings("A", "major", { limit: 2 }).results;
    const response = await postProgressionOptimization(new Request("http://localhost/api/progressions/optimize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layers: [candidates, candidates], options: { limit: 2 } }),
    }));
    const body = await response.json() as {
      results: Array<{ steps: Array<{ chordSymbol: string }>; totalCost: number }>;
      candidateCounts: number[];
      options: { limit: number };
    };

    expect(response.status).toBe(200);
    expect(body.results).toHaveLength(2);
    expect(body.results[0]!.steps.map((step) => step.chordSymbol)).toEqual(["A", "A"]);
    expect(Number.isFinite(body.results[0]!.totalCost)).toBe(true);
    expect(body.candidateCounts).toEqual([2, 2]);
    expect(body.options.limit).toBe(2);
  });

  it("rejects malformed and oversized progression optimization inputs", async () => {
    const invalidLayer = await postProgressionOptimization(new Request("http://localhost/api/progressions/optimize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layers: [[{}]] }),
    }));
    expect(invalidLayer.status).toBe(400);
    expect(await invalidLayer.json()).toMatchObject({ error: { code: "invalid_request" } });

    const tooManyResults = await postProgressionOptimization(new Request("http://localhost/api/progressions/optimize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layers: [[searchVoicings("A", "major", { limit: 1 }).results[0]]], options: { limit: 21 } }),
    }));
    expect(tooManyResults.status).toBe(400);
    expect(await tooManyResults.json()).toMatchObject({ error: { code: "invalid_request" } });

    const tooManyLayers = await postProgressionOptimization(new Request("http://localhost/api/progressions/optimize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layers: Array.from({ length: 13 }, () => [{}]) }),
    }));
    expect(tooManyLayers.status).toBe(400);
  });
});
