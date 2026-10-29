import { useState } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalGuitarLabService, type AudioAnalysisResponse, type GuitarLabService } from "@/services";
import { GuitarLabServiceProvider } from "@/state/ServiceContext";
import { AudioAnalysis } from "@/components/Audio/AudioAnalysis";
import { ProgressionBuilder } from "@/components/Progression/ProgressionBuilder";
import { analysisFixture } from "@/test/analysisFixture";
import { routerPush } from "@/test/setup";
import { LabSessionProvider } from "./LabSessionProvider";
import { createMemoryRepository, type LabRepository } from "./repository";

beforeEach(() => {
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:take"), revokeObjectURL: vi.fn() }));
  vi.spyOn(window, "confirm").mockReturnValue(true);
  localStorage.clear();
  routerPush.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

const wav = () => new File(["RIFF...."], "take.wav", { type: "audio/wav" });

/** Mimics the App Router: the provider stays mounted while the page component is swapped out. */
function App({ service, repository }: { service: GuitarLabService; repository: LabRepository }) {
  const [page, setPage] = useState<"audio" | "progressions">("audio");
  return (
    <GuitarLabServiceProvider service={service}>
      <LabSessionProvider repository={repository}>
        <nav>
          <button type="button" onClick={() => setPage("audio")}>Go to audio</button>
          <button type="button" onClick={() => setPage("progressions")}>Go to progressions</button>
        </nav>
        {page === "audio" ? <AudioAnalysis /> : <ProgressionBuilder />}
      </LabSessionProvider>
    </GuitarLabServiceProvider>
  );
}

function setup(analyzeAudio?: GuitarLabService["analyzeAudio"], repository: LabRepository = createMemoryRepository()) {
  const fixture = analysisFixture();
  const analyze = vi.fn<GuitarLabService["analyzeAudio"]>(analyzeAudio ?? (async () => fixture));
  const service = { ...createLocalGuitarLabService(), analyzeAudio: analyze };
  const view = render(<App service={service} repository={repository} />);
  return { analyze, service, repository, fixture, view, user: userEvent.setup() };
}

async function runAnalysis(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(await screen.findByLabelText(/Choose audio file/), wav());
  await user.click(screen.getByRole("button", { name: "Analyze recording" }));
  await screen.findByText("≈ 90.0 BPM");
}

describe("analysis session survives navigation (regression)", () => {
  it("keeps a completed analysis when leaving and returning, without a new request", async () => {
    const { analyze, user } = setup();
    await runAnalysis(user);
    await user.click(screen.getByRole("button", { name: "Go to progressions" }));
    expect(screen.queryByText("≈ 90.0 BPM")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Go to audio" }));
    expect(screen.getByText("≈ 90.0 BPM")).toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: "Top hypothesis per window" })).toBeInTheDocument();
    expect(analyze).toHaveBeenCalledTimes(1);
  });

  it("persists the selected window strategy with an analysis session", async () => {
    const { user, analyze, repository, fixture } = setup(async () => ({
      ...fixture,
      audio: { ...fixture.audio, windowStrategy: "auto", windowingMode: "adaptive-beat-aligned" },
    }));
    await user.upload(await screen.findByLabelText(/Choose audio file/), wav());
    await user.selectOptions(screen.getByLabelText("Window strategy"), "auto");
    await user.click(screen.getByRole("button", { name: "Analyze recording" }));
    expect(await screen.findByText("Auto · adaptive beat-aligned")).toBeInTheDocument();
    expect(analyze.mock.calls[0]![0]).toMatchObject({ windowStrategy: "auto" });
    await waitFor(async () => expect(await repository.listSessions()).toHaveLength(1));
    const summary = (await repository.listSessions())[0]!;
    const saved = (await repository.getSession(summary.id))!;
    expect(saved.request.windowStrategy).toBe("auto");
    expect(saved.result.audio.windowStrategy).toBe("auto");
  });

  it("does not abort an analysis that is still running when the user navigates away", async () => {
    let finish: (value: AudioAnalysisResponse) => void = () => {};
    let signal: AbortSignal | undefined;
    const { user, fixture } = setup((_req, opts) => {
      signal = opts?.signal;
      return new Promise((resolve) => { finish = resolve; });
    });
    await user.upload(await screen.findByLabelText(/Choose audio file/), wav());
    await user.click(screen.getByRole("button", { name: "Analyze recording" }));
    await user.click(screen.getByRole("button", { name: "Go to progressions" }));
    expect(signal?.aborted).toBe(false);
    await act(async () => finish(fixture));
    await user.click(screen.getByRole("button", { name: "Go to audio" }));
    expect(await screen.findByText("≈ 90.0 BPM")).toBeInTheDocument();
  });

  it("restores the saved session after a reload without re-running the analysis", async () => {
    const repository = createMemoryRepository();
    const first = setup(undefined, repository);
    await runAnalysis(first.user);
    await waitFor(async () => expect(await repository.listSessions()).toHaveLength(1));
    first.view.unmount(); // the tab goes away; only storage and the active id remain

    const second = setup(undefined, repository);
    expect(await screen.findByText("≈ 90.0 BPM")).toBeInTheDocument();
    expect(second.analyze).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Overview" })).toHaveTextContent("take.wav");
    expect(screen.getByText(/Audio isn.t stored with saved analyses/)).toBeInTheDocument();
    const recent = screen.getByRole("region", { name: "Recent analyses" });
    expect(within(recent).getByText("Active")).toBeInTheDocument();
  });

  it("opens a recent analysis from the list and can close it", async () => {
    const repository = createMemoryRepository();
    const first = setup(undefined, repository);
    await runAnalysis(first.user);
    await first.user.click(screen.getByRole("button", { name: "Close session" }));
    expect(screen.queryByText("≈ 90.0 BPM")).not.toBeInTheDocument();
    await first.user.click(await screen.findByRole("button", { name: "Open analysis of take.wav" }));
    expect(await screen.findByText("≈ 90.0 BPM")).toBeInTheDocument();
    expect(first.analyze).toHaveBeenCalledTimes(1);
  });
});

describe("progression from an analysis", () => {
  it("keeps chord order, timestamps and window links; corrections leave the analysis untouched", async () => {
    const { user, repository } = setup();
    await runAnalysis(user);
    await waitFor(async () => expect(await repository.listSessions()).toHaveLength(1));
    const [summary] = await repository.listSessions();
    const rawBefore = JSON.stringify((await repository.getSession(summary!.id))!.result);

    await user.click(screen.getByRole("button", { name: "Create progression from path 1" }));
    expect(screen.getByText("Created a progression with 3 chords from path 1.")).toBeInTheDocument();
    const strip = screen.getByRole("list", { name: "Chords in the active progression" });
    expect(within(strip).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Chord 1: C, 0:00.0 to 0:02.0",
      "Chord 2: C, 0:03.0 to 0:04.0",
      "Chord 3: G, 0:04.0 to 0:06.0",
    ]);
    // Selecting a chord returns to its first window on the timeline.
    await user.click(within(strip).getAllByRole("button")[2]!);
    expect(screen.getByRole("region", { name: /Window 5/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Go to progressions" }));
    const slots = await screen.findAllByRole("listitem", { name: /^Chord \d of 3/ });
    expect(slots.map((s) => s.getAttribute("aria-label"))).toEqual([
      "Chord 1 of 3: C, detected", "Chord 2 of 3: C, detected", "Chord 3 of 3: G, detected",
    ]);
    expect(within(slots[0]!).getByText("0:00.0–0:02.0 · 2 windows")).toBeInTheDocument();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    // Correct chord 2 (C → Am).
    await user.selectOptions(within(slots[1]!).getByLabelText("Chord 2 Root"), "A");
    await user.selectOptions(within(slots[1]!).getByLabelText("Chord 2 Quality"), "minor");
    expect(await screen.findByRole("listitem", { name: "Chord 2 of 3: Am, corrected (detected C)" })).toBeInTheDocument();
    expect(screen.getByText("Edited · detected C")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save progression" }));
    await waitFor(async () => expect(await repository.listProgressions()).toHaveLength(1));
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
    const saved = (await repository.getProgression((await repository.listProgressions())[0]!.id))!;
    expect(saved.slots.map((s) => [s.root, s.quality, s.source?.detected.symbol, s.source?.startSeconds]))
      .toEqual([["C", "major", "C", 0], ["A", "minor", "C", 3], ["G", "major", "G", 4]]);
    // The raw analysis is byte-for-byte unchanged.
    expect(JSON.stringify((await repository.getSession(summary!.id))!.result)).toBe(rawBefore);

    // Back on the analysis page the correction is shown, distinct from detected chords.
    await user.click(screen.getByRole("button", { name: "Go to audio" }));
    const chips = within(screen.getByRole("list", { name: "Chords in the active progression" })).getAllByRole("button");
    expect(chips[1]).toHaveAccessibleName("Chord 2: A minor (corrected; detected C), 0:03.0 to 0:04.0");
    expect(chips[0]).toHaveAttribute("data-corrected", "false");
  });

  it("restores a saved progression after a reload and links chords back to their windows", async () => {
    const repository = createMemoryRepository();
    const first = setup(undefined, repository);
    await runAnalysis(first.user);
    await first.user.click(screen.getByRole("button", { name: "Create progression from path 1" }));
    await first.user.click(screen.getByRole("button", { name: "Go to progressions" }));
    await first.user.click(await screen.findByRole("button", { name: "Save progression" }));
    await waitFor(async () => expect(await repository.listProgressions()).toHaveLength(1));
    first.view.unmount();

    const second = setup(undefined, repository);
    await second.user.click(screen.getByRole("button", { name: "Go to progressions" }));
    const slots = await screen.findAllByRole("listitem", { name: /^Chord \d of 3/ });
    expect(slots).toHaveLength(3);
    expect(screen.getByText(/^Saved /)).toBeInTheDocument();
    await second.user.click(within(slots[2]!).getByRole("button", { name: "Show in analysis" }));
    expect(routerPush).toHaveBeenCalledWith("/audio");
    await second.user.click(screen.getByRole("button", { name: "Go to audio" }));
    expect(await screen.findByRole("region", { name: /Window 5/ })).toBeInTheDocument();
    expect(second.analyze).not.toHaveBeenCalled();
  });
});
