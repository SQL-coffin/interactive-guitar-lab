import { describe, expect, it, vi } from "vitest";
import { searchVoicings } from "@interactive-guitar-lab/music-theory";
import { createHttpGuitarLabService } from "./httpAdapter";
import { createLocalGuitarLabService } from "./localAdapter";

/** Minimal XMLHttpRequest stand-in that lets each test script the server's reply. */
class FakeXhr {
  static last: FakeXhr;
  method = "";
  url = "";
  body: FormData | null = null;
  status = 0;
  responseText = "";
  upload: { onprogress: ((e: { loaded: number; total: number; lengthComputable: boolean }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor() { FakeXhr.last = this; }
  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader() {}
  send(body: FormData) { this.body = body; }
  abort() { this.onabort?.(); }
  respond(status: number, body: unknown) {
    this.status = status;
    this.responseText = typeof body === "string" ? body : JSON.stringify(body);
    this.onload?.();
  }
}

const validResponse = {
  audio: { schemaVersion: "1.0", filename: "a.wav", durationSeconds: 2, sampleRate: 22050, windowSeconds: 1, rhythm: { tempoBpm: null, beatTimesSeconds: [] } },
  chordAnalysis: { frameResults: [], progressionFrameIndexes: [], skippedSilentFrameIndexes: [], optimization: null },
};

const service = () => createHttpGuitarLabService("/api", vi.fn(), () => new FakeXhr() as unknown as XMLHttpRequest);
const file = new File(["RIFF"], "take 1.wav", { type: "audio/wav" });

describe("http adapter: audio analysis", () => {
  it("posts multipart form data, reports upload progress, and returns the parsed body", async () => {
    const onUploadProgress = vi.fn();
    const pending = service().analyzeAudio(
      { file, windowSeconds: 1, windowStrategy: "auto", options: { chordCandidateLimit: 3, progressionOptions: { limit: 2 } } },
      { onUploadProgress },
    );
    const xhr = FakeXhr.last;
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe("/api/audio-analysis");
    expect((xhr.body!.get("file") as File).name).toBe("take 1.wav");
    expect(xhr.body!.get("windowSeconds")).toBe("1");
    expect(JSON.parse(xhr.body!.get("options") as string)).toEqual({ chordCandidateLimit: 3, progressionOptions: { limit: 2 } });
    xhr.upload.onprogress!({ loaded: 2, total: 4, lengthComputable: true });
    xhr.upload.onprogress!({ loaded: 3, total: 0, lengthComputable: false });
    expect(onUploadProgress.mock.calls).toEqual([[{ loaded: 2, total: 4 }], [{ loaded: 3, total: null }]]);
    xhr.respond(200, validResponse);
    await expect(pending).resolves.toEqual(validResponse);
  });

  it("surfaces the contract error body with its HTTP status", async () => {
    const pending = service().analyzeAudio({ file });
    FakeXhr.last.respond(502, { error: { code: "internal_error", message: "Audio analysis worker is unavailable or failed." } });
    await expect(pending).rejects.toMatchObject({ code: "internal_error", status: 502, message: "Audio analysis worker is unavailable or failed." });
  });

  it("rejects unexpected response shapes and non-JSON bodies", async () => {
    const shapeless = service().analyzeAudio({ file });
    FakeXhr.last.respond(200, { audio: {} });
    await expect(shapeless).rejects.toMatchObject({ code: "internal_error", message: "The API returned an unexpected audio analysis response." });
    const html = service().analyzeAudio({ file });
    FakeXhr.last.respond(504, "<html>Gateway Timeout</html>");
    await expect(html).rejects.toMatchObject({ code: "internal_error", status: 504 });
  });

  it("maps network failures and aborts", async () => {
    const offline = service().analyzeAudio({ file });
    FakeXhr.last.onerror!();
    await expect(offline).rejects.toMatchObject({ code: "network_error" });

    const controller = new AbortController();
    const aborted = service().analyzeAudio({ file }, { signal: controller.signal });
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("local adapter progression optimization", () => {
  it("uses the shared engine in offline mode", async () => {
    const layers = ["C", "G"].map((root) => searchVoicings(root, "major", { limit: 3 }).results);
    const result = await createLocalGuitarLabService().optimizeProgression({ layers, options: { limit: 2 } });
    expect(result.results).toHaveLength(2);
    expect(result.results[0]!.steps.map((step) => step.chordSymbol)).toEqual(["C", "G"]);
  });

  it("local adapter cannot analyze audio and says why", async () => {
    await expect(createLocalGuitarLabService().analyzeAudio({ file })).rejects.toMatchObject({
      message: expect.stringContaining("/api/audio-analysis"),
    });
  });
});
