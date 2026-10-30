import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeChromaProgression, buildChordSheet } from "@interactive-guitar-lab/audio-analysis";
import { createLocalGuitarLabService, ServiceError, type AudioAnalysisResponse, type GuitarLabService } from "@/services";
import { GuitarLabServiceProvider } from "@/state/ServiceContext";
import { LabSessionProvider } from "@/state/lab/LabSessionProvider";
import { createMemoryRepository } from "@/state/lab/repository";
import { AudioAnalysis } from "./AudioAnalysis";

// Fixture produced by the backend's own analysis pipeline from synthetic chroma, so its
// shape is the real contract. C major, C major, silence, G major.
const chroma = (pcs: number[]) => Array.from({ length: 12 }, (_, pc) => (pcs.includes(pc) ? 1 : 0));
const frames = [
  { startSeconds: 0, endSeconds: 1, chroma: chroma([0, 4, 7]), bassPitchClass: 0 },
  { startSeconds: 1, endSeconds: 2, chroma: chroma([0, 4, 7]), bassPitchClass: 0 },
  { startSeconds: 2, endSeconds: 3, chroma: chroma([]), bassPitchClass: null },
  { startSeconds: 3, endSeconds: 4, chroma: chroma([7, 11, 2]), bassPitchClass: 7 },
];
const chordAnalysis = analyzeChromaProgression(frames, { chordCandidateLimit: 3, voicingsPerChord: 3, progressionOptions: { limit: 2 } });
const fixture: AudioAnalysisResponse = {
  audio: {
    schemaVersion: "1.0",
    filename: "take.wav",
    durationSeconds: 4,
    sampleRate: 22050,
    windowSeconds: 1,
    windowStrategy: "manual",
    windowingMode: "fixed-window" as const,
    rhythm: { tempoBpm: 96, beatTimesSeconds: [0.5, 1.1, 1.7], timeSignatureNumerator: null, timeSignatureDenominator: null, meterConfidence: null, barDurationSeconds: null, downbeatTimesSeconds: [] },
  },
  chordAnalysis,
  chordSheet: buildChordSheet(chordAnalysis.frameResults),
};

beforeEach(() => {
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:take"), revokeObjectURL: vi.fn() }));
});
afterEach(() => vi.unstubAllGlobals());

function renderAudio(analyzeAudio: GuitarLabService["analyzeAudio"]) {
  const service = { ...createLocalGuitarLabService(), analyzeAudio };
  render(
    <GuitarLabServiceProvider service={service}>
      <LabSessionProvider repository={createMemoryRepository()}>
        <AudioAnalysis />
      </LabSessionProvider>
    </GuitarLabServiceProvider>,
  );
}

const wav = () => new File(["RIFF...."], "take.wav", { type: "audio/wav" });

describe("AudioAnalysis", () => {
  it("shows nothing but an empty state before a real result arrives", () => {
    renderAudio(vi.fn());
    expect(screen.getByText("No analysis yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Analyze recording" })).toBeDisabled();
    expect(screen.queryByText(/Tempo/)).not.toBeInTheDocument();
  });

  it("uploads with progress, then renders tempo, timeline and window detail from the response", async () => {
    let finish: (value: AudioAnalysisResponse) => void = () => {};
    const analyze = vi.fn<GuitarLabService["analyzeAudio"]>((_req, opts) => {
      opts?.onUploadProgress?.({ loaded: 4, total: 8 });
      return new Promise((resolve) => { finish = resolve; });
    });
    renderAudio(analyze);
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText(/Choose audio file/), wav());
    await user.selectOptions(screen.getByLabelText("Analysis window"), "0.5");
    await user.click(screen.getByRole("button", { name: "Analyze recording" }));

    expect(await screen.findByText(/Uploading take.wav · 50%/)).toBeInTheDocument();
    expect(analyze.mock.calls[0]![0]).toMatchObject({ windowSeconds: 0.5, options: { voicingSearchOptions: { minNotes: 4 } } });
    finish(fixture);

    expect(await screen.findByText("≈ 96.0 BPM")).toBeInTheDocument();
    expect(screen.getByText("Beats detected").nextSibling).toHaveTextContent("3");
    const lane = screen.getByRole("toolbar", { name: "Top hypothesis per window" });
    const segments = within(lane).getAllByRole("button");
    expect(segments.map((s) => s.getAttribute("aria-label")?.split(":")[0])).toHaveLength(4);
    expect(segments[2]).toHaveAccessibleName(/silent/);

    await user.click(segments[3]!);
    const detail = screen.getByRole("region", { name: /Window 4/ });
    const topSymbol = fixture.chordAnalysis.frameResults[3]!.candidates[0]!.symbol;
    expect(within(detail).getAllByText(topSymbol).length).toBeGreaterThan(0);
    expect(within(detail).getByText(/not a probability/)).toBeInTheDocument();
    expect(within(detail).getByText("used by path")).toBeInTheDocument();
    expect(within(detail).getByRole("grid", { name: /Guitar fretboard/ })).toBeInTheDocument();

    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("region", { name: /Window 3/ })).toHaveTextContent(/silent/);
  });

  it("forwards Auto mode and explains the adaptive result", async () => {
    let finish: (value: AudioAnalysisResponse) => void = () => {};
    const analyze = vi.fn<GuitarLabService["analyzeAudio"]>(() => new Promise((resolve) => { finish = resolve; }));
    renderAudio(analyze);
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText(/Choose audio file/), wav());
    await user.selectOptions(screen.getByLabelText("Window strategy"), "auto");
    expect(screen.getByLabelText("Analysis window")).toBeDisabled();
    expect(screen.getByText(/Auto chooses coarser beat-aligned windows/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Analyze recording" }));
    expect(analyze.mock.calls[0]![0]).toMatchObject({ windowStrategy: "auto", windowSeconds: 1 });

    const autoFixture: AudioAnalysisResponse = {
      ...fixture,
      audio: { ...fixture.audio, windowSeconds: 2, windowStrategy: "auto", windowingMode: "adaptive-beat-aligned" },
    };
    finish(autoFixture);
    expect(await screen.findByText("Auto · adaptive beat-aligned")).toBeInTheDocument();
    expect(screen.getByText(/4 · 1.00 s/)).toBeInTheDocument();
  });

  it("shows relative major and minor alternatives when key evidence is ambiguous", async () => {
    const ambiguousFixture: AudioAnalysisResponse = {
      ...fixture,
      keyAnalysis: {
        status: "ambiguous",
        candidates: [
          { tonic: "C", tonicPitchClass: 0, mode: "major", label: "C major", score: 0.756 },
          { tonic: "A", tonicPitchClass: 9, mode: "minor", label: "A minor", score: 0.712 },
        ],
        ambiguityKind: "relative-major-minor",
        scoreMargin: 0.044,
        evidence: { activeDurationSeconds: 4, observedPitchClasses: [0, 2, 4, 5, 7, 9, 11] },
        explanation: "These relative major/minor keys share the same pitch collection. The audio does not establish one tonal center clearly enough, so both possibilities are shown.",
      },
    };
    const analyze = vi.fn<GuitarLabService["analyzeAudio"]>().mockResolvedValue(ambiguousFixture);
    renderAudio(analyze);
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText(/Choose audio file/), wav());
    await user.click(screen.getByRole("button", { name: "Analyze recording" }));

    expect(await screen.findByRole("list", { name: "Possible keys" })).toBeInTheDocument();
    expect(screen.getByText("C major")).toBeInTheDocument();
    expect(screen.getByText("A minor")).toBeInTheDocument();
    expect(screen.getByText(/does not establish one tonal center clearly enough/i)).toBeInTheDocument();
  });

  it("explains a worker outage and retries", async () => {
    const analyze = vi.fn<GuitarLabService["analyzeAudio"]>()
      .mockRejectedValueOnce(new ServiceError("internal_error", "Audio analysis worker is unavailable or failed.", 502))
      .mockResolvedValueOnce(fixture);
    renderAudio(analyze);
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText(/Choose audio file/), wav());
    await user.click(screen.getByRole("button", { name: "Analyze recording" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The audio analysis worker is unavailable");
    expect(alert).toHaveTextContent("services/audio-worker");
    await user.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("≈ 96.0 BPM")).toBeInTheDocument();
  });

  it("rejects oversized files before uploading", async () => {
    const analyze = vi.fn();
    renderAudio(analyze);
    const user = userEvent.setup();
    const big = wav();
    Object.defineProperty(big, "size", { value: 26 * 1024 * 1024 });
    await user.upload(screen.getByLabelText(/Choose audio file/), big);
    await user.click(screen.getByRole("button", { name: "Analyze recording" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("25 MiB or smaller");
    expect(analyze).not.toHaveBeenCalled();
  });
});
