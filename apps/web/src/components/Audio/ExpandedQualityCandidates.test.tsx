import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeChromaProgression, buildChordSheet } from "@interactive-guitar-lab/audio-analysis";
import { createLocalGuitarLabService, type AudioAnalysisResponse } from "@/services";
import { GuitarLabServiceProvider } from "@/state/ServiceContext";
import { LabSessionProvider } from "@/state/lab/LabSessionProvider";
import { createMemoryRepository } from "@/state/lab/repository";
import { AudioAnalysis } from "./AudioAnalysis";

// Produced by the backend's own pipeline, so candidates use the real quality ids.
const chroma = (pcs: number[]) => Array.from({ length: 12 }, (_, pc) => (pcs.includes(pc) ? 1 : 0));
function fixture(): AudioAnalysisResponse {
  const frames = [
    { startSeconds: 0, endSeconds: 1, chroma: chroma([0, 4, 7, 2]), bassPitchClass: 0 }, // C E G D → Cadd9
    { startSeconds: 1, endSeconds: 2, chroma: chroma([0, 4, 8]), bassPitchClass: 0 }, // C E G♯ → Caug
  ];
  const audio = { schemaVersion: "1.0" as const, filename: "colour.wav", durationSeconds: 2, sampleRate: 22050, windowSeconds: 1, windowingMode: "fixed-window" as const, rhythm: { tempoBpm: null, beatTimesSeconds: [], timeSignatureNumerator: null, timeSignatureDenominator: null, meterConfidence: null, barDurationSeconds: null, downbeatTimesSeconds: [] } };
  const chordAnalysis = analyzeChromaProgression(frames, { chordCandidateLimit: 3, voicingsPerChord: 3, progressionOptions: { limit: 1 } });
  return {
    audio,
    chordAnalysis,
    chordSheet: buildChordSheet(chordAnalysis.frameResults, { beatTimesSeconds: [], tempoBpm: null }),
  };
}

beforeEach(() => {
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() }));
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe("audio candidates with the expanded qualities", () => {
  it("formats new quality ids with the shared labels and shows the API's symbols", async () => {
    const result = fixture();
    const [w1, w2] = result.chordAnalysis.frameResults;
    // Guard the premise: the backend ranks the new qualities first for these windows.
    expect([w1!.candidates[0]!.quality, w2!.candidates[0]!.quality]).toEqual(["add9", "augmented"]);

    render(
      <GuitarLabServiceProvider service={{ ...createLocalGuitarLabService(), analyzeAudio: async () => result }}>
        <LabSessionProvider repository={createMemoryRepository()}>
          <AudioAnalysis />
        </LabSessionProvider>
      </GuitarLabServiceProvider>,
    );
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText(/Choose audio file/), new File(["RIFF"], "colour.wav", { type: "audio/wav" }));
    await user.click(screen.getByRole("button", { name: "Analyze recording" }));
    const segments = within(await screen.findByRole("toolbar", { name: "Top hypothesis per window" })).getAllByRole("button");
    expect(segments.map((s) => s.textContent)).toEqual(["Cadd9", "Caug"]);

    for (const [index, symbol, label] of [[0, "Cadd9", "Add 9"], [1, "Caug", "Augmented"]] as const) {
      await user.click(segments[index]!);
      const detail = screen.getByRole("region", { name: new RegExp(`^Window ${index + 1}`) });
      const top = within(detail).getAllByRole("listitem")[0]!;
      expect(top).toHaveTextContent(symbol);
      expect(top).toHaveTextContent(label);
      expect(within(detail).queryByText(/^(add9|augmented)$/)).toBeNull();
    }
  });
});
