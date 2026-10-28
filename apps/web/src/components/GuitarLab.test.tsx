import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createLocalGuitarLabService, ServiceError, type GuitarLabService } from "@/services";
import { GuitarLabServiceProvider } from "@/state/ServiceContext";
import { GuitarLab } from "./GuitarLab";

function renderLab(service: GuitarLabService = createLocalGuitarLabService()) {
  render(
    <GuitarLabServiceProvider service={service}>
      <GuitarLab />
    </GuitarLabServiceProvider>,
  );
  return service;
}

const voicingsRegion = () => screen.getByRole("region", { name: "Voicings" });

describe("GuitarLab", () => {
  it("loads C major with tones, fretboard markers and ranked voicings", async () => {
    renderLab();
    const chord = screen.getByRole("region", { name: "Chord tones" });
    expect(await within(chord).findByLabelText("Chord C")).toBeInTheDocument();
    expect(within(chord).getByText("1 – 3 – 5")).toBeInTheDocument();

    expect(await screen.findByRole("grid", { name: /Guitar fretboard/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^String 6 \(low E\), fret 8: C, degree 1 of C/ })).toBeInTheDocument();

    const first = await within(voicingsRegion()).findByRole("article", { name: /^Voicing 1:/ });
    expect(within(first).getByRole("button", { name: "Shown on fretboard" })).toHaveAttribute("aria-pressed", "true");
    expect(within(first).getByRole("img", { name: /C chord diagram/ })).toBeInTheDocument();
  });

  it("re-queries when root and quality change, using the flat spelling preference", async () => {
    const service = createLocalGuitarLabService();
    const search = vi.spyOn(service, "searchVoicings");
    renderLab(service);
    const user = userEvent.setup();
    await within(voicingsRegion()).findByRole("article", { name: /^Voicing 1:/ });

    await user.click(screen.getByRole("radio", { name: "♭" }));
    await user.click(screen.getByRole("radio", { name: "B♭" }));
    await user.click(await screen.findByRole("radio", { name: "Dominant 7" }));

    expect(await screen.findByLabelText("Chord Bb7")).toBeInTheDocument();
    expect(search).toHaveBeenLastCalledWith(
      expect.objectContaining({ root: "Bb", quality: "dominant7" }),
      expect.anything(),
    );
    const tones = screen.getByRole("table", { name: /Chord tones of Bb7/ });
    expect(within(tones).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[1]!.textContent))
      .toEqual(["B♭", "D", "F", "A♭"]);
  });

  it("pins a different voicing to the fretboard", async () => {
    renderLab();
    const user = userEvent.setup();
    const second = await within(voicingsRegion()).findByRole("article", { name: /^Voicing 2:/ });
    await user.click(within(second).getByRole("button", { name: "Show on fretboard" }));
    expect(within(second).getByRole("button", { name: "Shown on fretboard" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("button", { name: /in selected voicing/ }).length).toBeGreaterThanOrEqual(4);
  });

  it("shows an empty state with a reset action when constraints exclude everything", async () => {
    renderLab();
    const user = userEvent.setup();
    await within(voicingsRegion()).findByRole("article", { name: /^Voicing 1:/ });
    // All six strings sounding within a one-fret span, no open strings, below fret 6 → the engine finds nothing for C.
    await user.click(screen.getByLabelText("Allow open strings"));
    fireEvent.change(screen.getByRole("slider", { name: /Max fret span/ }), { target: { value: "1" } });
    fireEvent.change(screen.getByRole("slider", { name: /Min strings sounded/ }), { target: { value: "6" } });
    await user.selectOptions(screen.getByLabelText("Highest fret"), "5");

    expect(await within(voicingsRegion()).findByText(/No playable C voicings match/)).toBeInTheDocument();
    await user.click(within(voicingsRegion()).getByRole("button", { name: "Reset constraints" }));
    expect(await within(voicingsRegion()).findByRole("article", { name: /^Voicing 1:/ })).toBeInTheDocument();
  });

  it("surfaces service errors with a working retry", async () => {
    const real = createLocalGuitarLabService();
    let fail = true;
    const service: GuitarLabService = {
      ...real,
      searchVoicings: (req, opts) =>
        fail ? Promise.reject(new ServiceError("network_error", "Could not reach the Guitar Lab API.")) : real.searchVoicings(req, opts),
    };
    renderLab(service);
    const user = userEvent.setup();

    const alert = await within(voicingsRegion()).findByRole("alert");
    expect(alert).toHaveTextContent("Voicing search failed");
    expect(alert).toHaveTextContent("Could not reach the Guitar Lab API.");

    fail = false;
    await user.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await within(voicingsRegion()).findByRole("article", { name: /^Voicing 1:/ })).toBeInTheDocument();
  });

  it("shows loading states while requests are pending and ignores stale responses", async () => {
    const real = createLocalGuitarLabService();
    const pending: Array<() => void> = [];
    const service: GuitarLabService = {
      ...real,
      getChord: (req, opts) =>
        new Promise((resolve, reject) => {
          pending.push(() => real.getChord(req, opts).then(resolve, reject));
        }),
    };
    renderLab(service);
    const user = userEvent.setup();
    expect(await screen.findByText("Building chord…")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "D" }));
    // Resolve the newer request first, then the stale C request.
    pending[1]!();
    expect(await screen.findByLabelText("Chord D")).toBeInTheDocument();
    pending[0]!();
    await waitFor(() => expect(screen.queryByLabelText("Chord C")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Chord D")).toBeInTheDocument();
  });
});
