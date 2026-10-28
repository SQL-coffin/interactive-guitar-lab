import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createLocalGuitarLabService, ServiceError, type GuitarLabService } from "@/services";
import { GuitarLabServiceProvider } from "@/state/ServiceContext";
import { LabSessionProvider } from "@/state/lab/LabSessionProvider";
import { createMemoryRepository } from "@/state/lab/repository";
import { ProgressionBuilder } from "./ProgressionBuilder";

function renderBuilder(service: GuitarLabService = createLocalGuitarLabService()) {
  render(
    <GuitarLabServiceProvider service={service}>
      <LabSessionProvider repository={createMemoryRepository()}>
        <ProgressionBuilder />
      </LabSessionProvider>
    </GuitarLabServiceProvider>,
  );
  return service;
}

const slots = () => within(screen.getByRole("list", { name: "Chords in progression" })).getAllByRole("listitem", { name: /^Chord \d of/ });

describe("ProgressionBuilder", () => {
  it("builds, reorders and removes chords using chord identities from the service", async () => {
    renderBuilder();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Start with C – G – Am – F/ }));
    expect(await screen.findByRole("list", { name: "Am chord tones" })).toHaveTextContent("♭3");

    await user.click(screen.getByRole("button", { name: "Move chord 3 later" }));
    expect(slots().map((s) => s.getAttribute("aria-label"))).toEqual([
      "Chord 1 of 4: C", "Chord 2 of 4: G", "Chord 3 of 4: F", "Chord 4 of 4: Am",
    ]);

    await user.click(screen.getByRole("button", { name: "Remove chord 2" }));
    await user.selectOptions(screen.getByLabelText("New chord Root"), "D");
    await user.selectOptions(screen.getByLabelText("New chord Quality"), "sus4");
    await user.click(screen.getByRole("button", { name: "Add D chord" }));
    expect(await screen.findByText("Dsus4")).toBeInTheDocument();
    expect(slots()).toHaveLength(4);
  });

  it("requests candidates per chord, renders ranked paths and flags stale results", async () => {
    const service = createLocalGuitarLabService();
    const search = vi.spyOn(service, "searchVoicings");
    const optimize = vi.spyOn(service, "optimizeProgression");
    renderBuilder(service);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Start with C – G – Am – F/ }));
    await user.click(screen.getByRole("button", { name: "Find voicing paths" }));

    const tabs = await screen.findAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(search).toHaveBeenCalledTimes(4);
    expect(search.mock.calls[0]![0]).toEqual({ root: "C", quality: "major", options: { maxFret: 12, maxFretSpan: 4, minNotes: 4, limit: 8 } });
    expect(optimize.mock.calls[0]![0].layers.map((layer) => layer.length)).toEqual([8, 8, 8, 8]);
    expect(optimize.mock.calls[0]![0].options).toEqual({ limit: 3 });

    const steps = within(screen.getByRole("list", { name: "Path 1 chord shapes" })).getAllByRole("button");
    expect(steps.map((s) => s.getAttribute("aria-label")?.split(",")[0])).toEqual(["Step 1: C", "Step 2: G", "Step 3: Am", "Step 4: F"]);
    await user.click(steps[1]!);
    expect(screen.getByRole("region", { name: /Change from C \(step 1\) to G \(step 2\)/ })).toHaveTextContent("optimizer transition cost");
    expect(screen.getByText(/not a judgement of musical quality/)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Highest fret"), "9");
    expect(screen.getByText(/changed since these paths were computed/)).toBeInTheDocument();
  });

  it("shows an empty state naming the chord the voicing search returned nothing for", async () => {
    const real = createLocalGuitarLabService();
    const optimize = vi.spyOn(real, "optimizeProgression");
    renderBuilder({
      ...real,
      // An empty `results` array is a valid API response; simulate it for G only.
      searchVoicings: async (req, opts) => {
        const response = await real.searchVoicings(req, opts);
        return req.root === "G" ? { ...response, results: [], totalFound: 0 } : response;
      },
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Start with C – G – Am – F/ }));
    await user.click(screen.getByRole("button", { name: "Find voicing paths" }));
    expect(await screen.findByText("No playable path under these settings")).toBeInTheDocument();
    expect(screen.getByText(/found no shapes for G\./)).toBeInTheDocument();
    expect(optimize).not.toHaveBeenCalled();
  });

  it("reports service failures with a retry", async () => {
    const real = createLocalGuitarLabService();
    let fail = true;
    renderBuilder({
      ...real,
      searchVoicings: (req, opts) =>
        fail ? Promise.reject(new ServiceError("network_error", "Could not reach the Guitar Lab API.")) : real.searchVoicings(req, opts),
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Start with C – G – Am – F/ }));
    await user.click(screen.getByRole("button", { name: "Find voicing paths" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not reach the Guitar Lab API.");
    fail = false;
    await user.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findAllByRole("tab")).toHaveLength(3);
  });
});
