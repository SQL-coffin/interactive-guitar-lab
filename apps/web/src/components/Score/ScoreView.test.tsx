import { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeChromaProgression, buildChordSheet } from "@interactive-guitar-lab/audio-analysis";
import { createLocalGuitarLabService, type AudioAnalysisResponse } from "@/services";
import { GuitarLabServiceProvider } from "@/state/ServiceContext";
import { LabSessionProvider } from "@/state/lab/LabSessionProvider";
import { createMemoryRepository, type LabRepository } from "@/state/lab/repository";
import { AudioAnalysis } from "@/components/Audio/AudioAnalysis";

const chroma = (pcs: number[]) => Array.from({ length: 12 }, (_, pc) => (pcs.includes(pc) ? 1 : 0));
const C = chroma([0, 4, 7]);
const G = chroma([7, 11, 2]);
const F = chroma([5, 9, 0]);
const SILENT = chroma([]);

interface Spec {
  beats: number[];
  frames: Array<[number, number, number[]]>; // [start, end, chroma]
  numerator: number | null;
  downbeats: number[];
  barDuration: number | null;
  confidence: number | null;
  windowingMode?: "beat-aligned" | "fixed-window";
}

/** Response assembled by the backend's own functions from synthetic chroma frames. */
function build(spec: Spec): AudioAnalysisResponse {
  const duration = Math.max(...spec.frames.map((f) => f[1]));
  const frames = spec.frames.map(([startSeconds, endSeconds, values]) => ({ startSeconds, endSeconds, chroma: values, bassPitchClass: null }));
  const rhythm = {
    tempoBpm: 120, beatTimesSeconds: spec.beats,
    timeSignatureNumerator: spec.numerator, timeSignatureDenominator: spec.numerator === null ? null : 4,
    meterConfidence: spec.confidence, barDurationSeconds: spec.barDuration, downbeatTimesSeconds: spec.downbeats,
  };
  const chordAnalysis = analyzeChromaProgression(frames, { chordQualities: ["major"], chordCandidateLimit: 1, voicingsPerChord: 2, progressionOptions: { limit: 1 } });
  return {
    audio: { schemaVersion: "1.0", filename: "song.wav", durationSeconds: duration, sampleRate: 22050, windowSeconds: 0.5, windowStrategy: "manual", windowingMode: spec.windowingMode ?? "beat-aligned", rhythm },
    chordAnalysis,
    chordSheet: buildChordSheet(chordAnalysis.frameResults, {
      beatTimesSeconds: rhythm.beatTimesSeconds, tempoBpm: 120, beatsPerBar: spec.numerator,
      timeSignatureNumerator: rhythm.timeSignatureNumerator, timeSignatureDenominator: rhythm.timeSignatureDenominator,
      meterConfidence: rhythm.meterConfidence, barDurationSeconds: rhythm.barDurationSeconds, downbeatTimesSeconds: rhythm.downbeatTimesSeconds,
    }),
  };
}

const beats = (step: number, count: number) => Array.from({ length: count }, (_, i) => +(i * step).toFixed(6));
/** One frame per beat; `plan` gives the chroma for each beat. */
const perBeat = (b: number[], plan: number[][], end: number): Array<[number, number, number[]]> =>
  plan.map((values, i) => [b[i]!, b[i + 1] ?? end, values]);

// 4/4 at 120 BPM, 3 bars: C for 6 beats (crosses the bar line), 2 silent beats, then G for a bar.
const fourFour = () => {
  const b = beats(0.5, 12);
  return build({ beats: b, numerator: 4, downbeats: [0, 2, 4], barDuration: 2, confidence: 0.8, frames: perBeat(b, [C, C, C, C, C, C, SILENT, SILENT, G, G, G, G], 6) });
};

beforeEach(() => {
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() }));
  vi.spyOn(window, "confirm").mockReturnValue(true);
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

function App({ result, repository }: { result: AudioAnalysisResponse; repository: LabRepository }) {
  const [service] = useState(() => ({ ...createLocalGuitarLabService(), analyzeAudio: vi.fn(async () => result) }));
  return (
    <GuitarLabServiceProvider service={service}>
      <LabSessionProvider repository={repository}>
        <AudioAnalysis />
      </LabSessionProvider>
    </GuitarLabServiceProvider>
  );
}

async function openScore(result: AudioAnalysisResponse, repository: LabRepository = createMemoryRepository()) {
  const view = render(<App result={result} repository={repository} />);
  const user = userEvent.setup();
  await user.upload(screen.getByLabelText(/Choose audio file/), new File(["RIFF"], "song.wav", { type: "audio/wav" }));
  await user.click(screen.getByRole("button", { name: "Analyze recording" }));
  await screen.findByText("Tempo (estimate)");
  await user.click(screen.getByRole("radio", { name: "Score · 简谱" }));
  const score = await screen.findByRole("region", { name: "Score · 简谱" });
  return { user, score, repository, view };
}

const bars = (score: HTMLElement) => within(score).queryAllByRole("group", { name: /^(Bar \d+|Pickup),/ });

describe("score view", () => {
  it("falls back to a time-based view when the meter is unknown, never assuming 4/4", async () => {
    const b = beats(0.5, 8);
    const { score } = await openScore(build({ beats: b, numerator: null, downbeats: [], barDuration: null, confidence: null, frames: perBeat(b, [C, C, C, C, G, G, G, G], 4) }));
    expect(within(score).getByText("Time signature").nextSibling).toHaveTextContent("Unknown");
    expect(within(score).getByText(/nothing is assumed to be 4\/4/)).toBeInTheDocument();
    expect(bars(score)).toHaveLength(0);
    expect(within(score).getByLabelText("Chord timeline (time signature unknown)")).toBeInTheDocument();
    expect(within(score).queryByText("4/4")).toBeNull();
    expect(screen.getByRole("region", { name: "Overview" })).toHaveTextContent("Time signatureUnknown");
  });

  it("lays out 4/4 bars from the downbeats, ties a chord across the bar line, and writes rests", async () => {
    const { score } = await openScore(fourFour());
    expect(within(score).getByText("Time signature").nextSibling).toHaveTextContent("4/4");
    expect(bars(score).map((b) => b.getAttribute("aria-label"))).toEqual(["Bar 1, 2.00 seconds", "Bar 2, 2.00 seconds", "Bar 3, 2.00 seconds"]);
    const chordLabels = within(score).getAllByRole("button", { name: /: [CG](\b| \(continued\))/ }).map((b) => b.getAttribute("aria-label"));
    expect(chordLabels).toEqual(["Bar 1, beat 1: C", "Bar 2, beat 1: C (continued)", "Bar 3, beat 1: G"]);
    // Beats 3–4 of bar 2 are silent: drawn as rests (0), not as a sustained chord.
    const bar2 = bars(score)[1]!;
    expect(bar2.querySelector('[data-kind="rest"]')).not.toBeNull();
    expect(within(bar2).getAllByText("0")).toHaveLength(2);
    // The melody lane is empty: chord analysis is not turned into fake melody notes.
    expect(score.querySelectorAll(".jianpu-note")).toHaveLength(0);
    expect(within(score).getByText(/Melody: not transcribed/)).toBeInTheDocument();
  });

  it("lays out 3/4 bars", async () => {
    const b = beats(0.5, 9);
    const { score } = await openScore(build({ beats: b, numerator: 3, downbeats: [0, 1.5, 3], barDuration: 1.5, confidence: 0.7, frames: perBeat(b, [C, C, C, F, F, F, G, G, G], 4.5) }));
    expect(within(score).getByText("Time signature").nextSibling).toHaveTextContent("3/4");
    expect(bars(score)).toHaveLength(3);
    expect(within(score).getAllByRole("button", { name: /beat 1: [CFG]$/ }).map((b) => b.getAttribute("aria-label")))
      .toEqual(["Bar 1, beat 1: C", "Bar 2, beat 1: F", "Bar 3, beat 1: G"]);
  });

  it("places chords on uneven beats by their real timestamps", async () => {
    // Bar 1's third beat arrives late (1.2 s instead of 1.0 s).
    const b = [0, 0.5, 1.2, 1.6, 2, 2.5, 3, 3.5];
    const { score } = await openScore(build({ beats: b, numerator: 4, downbeats: [0, 2], barDuration: 2, confidence: 0.7, frames: perBeat(b, [C, C, G, G, F, F, F, F], 4) }));
    expect(within(score).getByRole("button", { name: "Bar 1, beat 3: G" })).toBeInTheDocument();
  });

  it("flags audio before the first detected beat instead of snapping it into the first bar", async () => {
    // Beats are only detected from 1.0 s, but C already sounds from 0 s.
    const b = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5];
    const frames: Array<[number, number, number[]]> = [[0, 1, C], ...perBeat(b, [C, C, C, C, G, G, G, G], 5)];
    const { score } = await openScore(build({ beats: b, numerator: 4, downbeats: [2, 4], barDuration: 2, confidence: 0.8, frames }));
    expect(within(score).getByText(/The first 1\.0 s come before the first detected beat/)).toBeInTheDocument();
    expect(within(score).getByRole("button", { name: /^Pickup, beat 1: C.*low rhythm confidence/ })).toBeInTheDocument();
    expect(within(score).getByText("1 = ? · 4/4 · ♩ ≈ 120")).toBeInTheDocument();
  });

  it("marks off-grid chords as low confidence, keeps the raw time, and lets the user confirm", async () => {
    const b = beats(0.5, 8);
    // Fixed windows that start between sixteenths (0.3 s) cannot be snapped reliably.
    const { score, user } = await openScore(build({ beats: b, numerator: 4, downbeats: [0, 2], barDuration: 2, confidence: 0.35, windowingMode: "fixed-window",
      frames: [[0, 0.3, SILENT], [0.3, 2.3, C], [2.3, 4, G]] }));
    expect(within(score).getByText(/Low meter confidence \(0.35\)/)).toBeInTheDocument();
    expect(within(score).getByText(/fixed analysis windows/)).toBeInTheDocument();
    const chord = within(score).getByRole("button", { name: /: C, low rhythm confidence/ });
    await user.click(chord);
    const timing = within(score).getByRole("region", { name: "Chord timing" });
    expect(timing).toHaveTextContent("Detected0:00.3 – 0:02.3");
    expect(timing).toHaveTextContent("low confidence");
    await user.click(within(timing).getByRole("button", { name: "Confirm position" }));
    // 0.3 s = 0.6 beat = 2.4 sixteenths → shown on the nearest sixteenth once confirmed.
    expect(within(score).getByRole("button", { name: /^Bar 1, beat 1 \+ 2\/4: C$/ })).toBeInTheDocument();
    expect(timing).toHaveTextContent("Detected0:00.3 – 0:02.3");
    await user.click(within(timing).getByRole("button", { name: "Move start one sixteenth earlier" }));
    expect(within(score).getByRole("button", { name: /^Bar 1, beat 1 \+ 1\/4: C$/ })).toBeInTheDocument();
    expect(timing).toHaveTextContent("adjusted by you");
  });

  it("edits the melody by hand and restores it after a reload; the analysis stays unchanged", async () => {
    const repository = createMemoryRepository();
    const result = fourFour();
    const first = await openScore(result, repository);
    const { user, score } = first;
    const rawBefore = JSON.stringify(result);

    // Cursor at bar 1 beat 1, quarter 5, then a half note 3 that crosses into bar 2 at beat 4.
    await user.click(within(score).getByRole("button", { name: "Bar 1, beat 1: melody slot" }));
    await user.click(within(score).getByRole("button", { name: "Degree 5" }));
    expect(within(score).getByRole("button", { name: "Bar 1, beat 1: 5, quarter" })).toBeInTheDocument();
    await user.click(within(score).getByRole("button", { name: "Bar 1, beat 4: melody slot" }));
    await user.selectOptions(within(score).getByLabelText("Duration"), "half");
    await user.click(within(score).getByRole("button", { name: "High ˙" }));
    await user.click(within(score).getByRole("button", { name: "Degree 3" }));
    expect(within(score).getByRole("button", { name: "Bar 1, beat 4: 3 octave +1, quarter" })).toBeInTheDocument();
    expect(within(score).getByRole("button", { name: "Bar 2, beat 1: 3 octave +1, quarter" })).toBeInTheDocument();
    // Edit: change the first note to 6 and make it an eighth.
    await user.click(within(score).getByRole("button", { name: "Bar 1, beat 1: 5, quarter" }));
    await user.click(within(score).getByRole("button", { name: "Degree 6" }));
    await user.selectOptions(within(score).getByLabelText("Duration"), "eighth");
    expect(within(score).getByRole("button", { name: "Bar 1, beat 1: 6, eighth" })).toBeInTheDocument();
    // A rest via the keyboard: cursor after the eighth.
    await user.click(within(score).getByRole("button", { name: "Done" }));
    await user.click(within(score).getByRole("button", { name: "Bar 1, beat 2: melody slot" }));
    await user.selectOptions(within(score).getByLabelText("Duration"), "quarter");
    within(score).getByLabelText(/Jianpu score/).focus();
    await user.keyboard("0");
    expect(within(score).getByRole("button", { name: "Bar 1, beat 2: rest, quarter" })).toBeInTheDocument();

    expect(within(score).getByText("Unsaved changes")).toBeInTheDocument();
    await user.click(within(score).getByRole("button", { name: "Save score" }));
    await waitFor(() => expect(within(score).queryByText("Unsaved changes")).toBeNull());
    const [session] = await repository.listSessions();
    const saved = await repository.getScore(session!.id);
    expect(saved!.melody.map((n) => [n.startTick, n.ticks, n.degree, n.octave, n.source])).toEqual([
      [0, 2, 6, 0, "manual"], [4, 4, 0, 0, "manual"], [12, 8, 3, 1, "manual"],
    ]);
    expect(saved!.transcription).toEqual({ status: "not-available" });
    expect(JSON.stringify((await repository.getSession(session!.id))!.result)).toBe(rawBefore);

    first.view.unmount();
    render(<App result={result} repository={repository} />);
    const user2 = userEvent.setup();
    await screen.findByText("Tempo (estimate)");
    await user2.click(screen.getByRole("radio", { name: "Score · 简谱" }));
    const restored = await screen.findByRole("region", { name: "Score · 简谱" });
    expect(await within(restored).findByRole("button", { name: "Bar 1, beat 1: 6, eighth" })).toBeInTheDocument();
    expect(within(restored).getByRole("button", { name: "Bar 2, beat 1: 3 octave +1, quarter" })).toBeInTheDocument();
  });
});
