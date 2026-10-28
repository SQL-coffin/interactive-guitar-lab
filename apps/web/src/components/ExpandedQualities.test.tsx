import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createLocalGuitarLabService, type GuitarLabService } from "@/services";
import { GuitarLabServiceProvider } from "@/state/ServiceContext";
import { LabSessionProvider } from "@/state/lab/LabSessionProvider";
import { createMemoryRepository } from "@/state/lab/repository";
import { GuitarLab } from "./GuitarLab";
import { ProgressionBuilder } from "./Progression/ProgressionBuilder";
import { qualityLabel } from "@/lib/qualities";

function renderWith(ui: React.ReactElement, service: GuitarLabService = createLocalGuitarLabService()) {
  render(
    <GuitarLabServiceProvider service={service}>
      <LabSessionProvider repository={createMemoryRepository()}>{ui}</LabSessionProvider>
    </GuitarLabServiceProvider>,
  );
  return service;
}

/** [degree, note] pairs from the chord-tone table, exactly as rendered. */
async function toneRows(symbol: string) {
  const table = await screen.findByRole("table", { name: `Chord tones of ${symbol}` });
  return within(table).getAllByRole("row").slice(1).map((row) => {
    const cells = within(row).getAllByRole("cell");
    return [cells[0]!.textContent, cells[1]!.textContent];
  });
}

describe("chord explorer with the expanded qualities", () => {
  it("groups the qualities returned by the API", async () => {
    renderWith(<GuitarLab />);
    const group = (name: string) => screen.findByRole("group", { name });
    expect(within(await group("Triads")).getAllByRole("radio").map((r) => r.closest("label")!.textContent))
      .toEqual(["Major", "Minor", "Diminished", "Augmented"]);
    expect(within(await group("Seventh chords")).getAllByRole("radio")).toHaveLength(3);
    expect(within(await group("Suspended & added")).getAllByRole("radio").map((r) => r.closest("label")!.textContent))
      .toEqual(["Sus 2", "Sus 4", "Add 9"]);
  });

  it.each([
    // [root radio, quality label, API symbol, expected [degree, note] rows]
    ["C", "Add 9", "Cadd9", [["1", "C"], ["3", "E"], ["5", "G"], ["9", "D"]]],
    ["D", "Sus 2", "Dsus2", [["1", "D"], ["2", "E"], ["5", "A"]]],
    ["C", "Augmented", "Caug", [["1", "C"], ["3", "E"], ["♯5", "G♯"]]],
    ["B", "Diminished", "Bdim", [["1", "B"], ["♭3", "D"], ["♭5", "F"]]],
  ])("selects %s %s and renders the API's notes and degrees", async (root, label, symbol, rows) => {
    const service = createLocalGuitarLabService();
    const search = vi.spyOn(service, "searchVoicings");
    renderWith(<GuitarLab />, service);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: label }));
    await user.click(screen.getByRole("radio", { name: root }));
    expect(await screen.findByLabelText(`Chord ${symbol}`)).toBeInTheDocument();
    expect(await toneRows(symbol)).toEqual(rows);
    const { quality } = search.mock.calls.at(-1)![0];
    expect(qualityLabel(quality)).toBe(label);
    // Voicings come back for the new quality and the fretboard labels tones with the API's degrees.
    expect(await screen.findByRole("article", { name: /^Voicing 1:/ })).toBeInTheDocument();
    const lastDegree = rows.at(-1)![0]!;
    expect(screen.getAllByRole("button", { name: new RegExp(`degree ${lastDegree.replace(/[♯♭]/g, "\\$&")} of ${symbol}`) }).length).toBeGreaterThan(0);
  });

  it("shows the ninth of add9 as 9, never 2, on the fretboard and in voicings", async () => {
    renderWith(<GuitarLab />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: "Add 9" }));
    await screen.findByLabelText("Chord Cadd9");
    expect(screen.getAllByRole("button", { name: /: D, degree 9 of Cadd9/ }).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("button", { name: /degree 2 of Cadd9/ })).toHaveLength(0);
    const card = await screen.findByRole("article", { name: /^Voicing 1:/ });
    expect(within(card).getByText("Degrees").nextElementSibling!.textContent).toMatch(/\b9\b/);
    expect(within(card).getByText("Degrees").nextElementSibling!.textContent).not.toMatch(/\b2\b/);
  });

  it("keeps the existing qualities working", async () => {
    renderWith(<GuitarLab />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: "Minor 7" }));
    await user.click(screen.getByRole("radio", { name: "A" }));
    expect(await toneRows("Am7")).toEqual([["1", "A"], ["♭3", "C"], ["5", "E"], ["♭7", "G"]]);
    await user.click(screen.getByRole("radio", { name: "Sus 4" }));
    expect(await toneRows("Asus4")).toEqual([["1", "A"], ["4", "D"], ["5", "E"]]);
  });
});

describe("progression builder with the expanded qualities", () => {
  it("adds and edits chords with the new qualities using the API's symbols and tones", async () => {
    renderWith(<ProgressionBuilder />);
    const user = userEvent.setup();
    const qualitySelect = await screen.findByLabelText("New chord Quality");
    expect([...qualitySelect.querySelectorAll("optgroup")].map((g) => g.label)).toEqual(["Triads", "Seventh chords", "Suspended & added"]);

    await user.selectOptions(qualitySelect, "add9");
    await user.click(screen.getByRole("button", { name: "Add C chord" }));
    await user.selectOptions(screen.getByLabelText("New chord Root"), "G");
    await user.selectOptions(qualitySelect, "sus2");
    await user.click(screen.getByRole("button", { name: "Add G chord" }));

    expect(await screen.findByRole("listitem", { name: "Chord 1 of 2: Cadd9" })).toBeInTheDocument();
    expect(await screen.findByRole("listitem", { name: "Chord 2 of 2: Gsus2" })).toBeInTheDocument();
    const tones = within(await screen.findByRole("list", { name: "Cadd9 chord tones" })).getAllByRole("listitem").map((li) => li.textContent);
    expect(tones).toEqual(["1C", "3E", "5G", "9D"]);

    // Edit both slots to the other two new qualities.
    await user.selectOptions(screen.getByLabelText("Chord 1 Quality"), "diminished");
    await user.selectOptions(screen.getByLabelText("Chord 2 Quality"), "augmented");
    expect(await screen.findByRole("listitem", { name: "Chord 1 of 2: Cdim" })).toBeInTheDocument();
    expect(await screen.findByRole("listitem", { name: "Chord 2 of 2: Gaug" })).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Gaug chord tones" })).getAllByRole("listitem").map((li) => li.textContent))
      .toEqual(["1G", "3B", "♯5D♯"]);

    // Voicing paths are computed for the new qualities through the existing service.
    await user.click(screen.getByRole("button", { name: "Find voicing paths" }));
    const steps = within(await screen.findByRole("list", { name: "Path 1 chord shapes" })).getAllByRole("button");
    expect(steps.map((s) => s.getAttribute("aria-label")!.split(",")[0])).toEqual(["Step 1: Cdim", "Step 2: Gaug"]);
  });
});
