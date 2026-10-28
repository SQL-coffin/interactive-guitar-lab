import { describe, expect, it, vi } from "vitest";
import { createHttpGuitarLabService } from "./httpAdapter";
import { createLocalGuitarLabService } from "./localAdapter";
import { ServiceError } from "./errors";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("http adapter", () => {
  it("builds the documented requests", async () => {
    const fetchMock = vi.fn(async () => json({ qualities: ["major"] }));
    const service = createHttpGuitarLabService("/api/", fetchMock as typeof fetch);

    await expect(service.listChordQualities()).resolves.toEqual(["major"]);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/chords/qualities", expect.objectContaining({ method: "GET" }));

    await service.getChord({ root: "C#", quality: "minor" });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/chords?root=C%23&quality=minor", expect.anything());

    await service.getFretboard({ maxFret: 12, tuning: [40, 45] });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/fretboard?maxFret=12&tuning=40%2C45", expect.anything());

    await service.searchVoicings({ root: "A", quality: "major7", options: { maxFret: 9 } });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/voicings/search",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ root: "A", quality: "major7", options: { maxFret: 9 } }),
      }),
    );
  });

  it("maps the error body to a ServiceError", async () => {
    const service = createHttpGuitarLabService("/api", (async () =>
      json({ error: { code: "invalid_request", message: "Invalid note spelling: H" } }, 400)) as typeof fetch);
    await expect(service.getChord({ root: "H", quality: "major" })).rejects.toMatchObject({
      name: "ServiceError",
      code: "invalid_request",
      status: 400,
      message: "Invalid note spelling: H",
    });
  });

  it("maps non-contract failures and network errors", async () => {
    const broken = createHttpGuitarLabService("/api", (async () => new Response("oops", { status: 502 })) as typeof fetch);
    await expect(broken.listChordQualities()).rejects.toMatchObject({ code: "internal_error", status: 502 });

    const offline = createHttpGuitarLabService("/api", (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch);
    await expect(offline.listChordQualities()).rejects.toMatchObject({ code: "network_error" });
  });
});

describe("local adapter", () => {
  const service = createLocalGuitarLabService();

  it("delegates to the engine", async () => {
    const chord = await service.getChord({ root: "A", quality: "minor7" });
    expect(chord.tones.map((t) => t.spelling)).toEqual(["A", "C", "E", "G"]);
    const board = await service.getFretboard({ maxFret: 12 });
    expect(board.tuning).toEqual([40, 45, 50, 55, 59, 64]);
    expect(board.positions).toHaveLength(6 * 13);
    const result = await service.searchVoicings({ root: "C", quality: "major", options: { limit: 3 } });
    expect(result.results).toHaveLength(3);
  });

  it("converts engine validation errors into invalid_request", async () => {
    const error = await service.getChord({ root: "H", quality: "major" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({ code: "invalid_request" });
  });

  it("honours an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(service.listChordQualities({ signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});
