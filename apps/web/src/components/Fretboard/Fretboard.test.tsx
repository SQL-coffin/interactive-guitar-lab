import { useReducer } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { buildChord, getFretboard, STANDARD_GUITAR_TUNING } from "@interactive-guitar-lab/music-theory";
import { EMPTY_SELECTION, fretboardSelectionReducer } from "@/state/fretboardSelection";
import { Fretboard } from "./Fretboard";
import { FretboardInspector } from "./FretboardInspector";

// Fixture data comes from the engine, exactly as the service would return it.
const positions = getFretboard({ tuning: [...STANDARD_GUITAR_TUNING], maxFret: 5 });
const chord = buildChord("A", "minor");

function Harness() {
  const [selection, dispatch] = useReducer(fretboardSelectionReducer, EMPTY_SELECTION);
  return (
    <>
      <Fretboard positions={positions} stringCount={6} maxFret={5} chord={chord} labelMode="degree" selection={selection} onSelectionChange={dispatch} />
      <FretboardInspector positions={positions} stringCount={6} chord={chord} selection={selection} onClear={() => dispatch({ type: "clear" })} />
    </>
  );
}

describe("Fretboard", () => {
  it("exposes one tab stop and moves focus with arrow keys", async () => {
    render(<Harness />);
    const user = userEvent.setup();
    const start = screen.getByRole("button", { name: /^String 1 \(high E\), open: E/ });
    expect(start).toHaveAttribute("tabindex", "0");
    expect(screen.getAllByRole("button").filter((b) => b.getAttribute("tabindex") === "0")).toHaveLength(1);

    await user.tab();
    expect(start).toHaveFocus();
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowDown}");
    expect(screen.getByRole("button", { name: /^String 2 \(B\), fret 2: C♯/ })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("button", { name: /^String 2 \(B\), fret 5: E, degree 5 of Am/ })).toHaveFocus();
    await user.keyboard("{Home}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}");
    expect(screen.getByRole("button", { name: /^String 6 \(low E\), open: E/ })).toHaveFocus();
  });

  it("toggles note markers with Enter and reports them in the inspector", async () => {
    render(<Harness />);
    const user = userEvent.setup();
    const c = screen.getByRole("button", { name: /^String 2 \(B\), fret 1: C, degree ♭3 of Am/ });
    c.focus();
    await user.keyboard("{Enter}");
    expect(c).toHaveAttribute("aria-pressed", "true");
    const list = screen.getByRole("list", { name: "Placed note markers" });
    expect(list).toHaveTextContent("Degree ♭3 of Am");
    expect(list).toHaveTextContent("MIDI 60");

    await user.click(screen.getByRole("button", { name: /^String 3 \(G\), fret 1: G♯/ }));
    expect(list).toHaveTextContent("Not in Am");
    await user.keyboard(" ");
    expect(screen.getByRole("button", { name: /^String 3 \(G\), fret 1/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("highlights a string or fret and clears the selection", async () => {
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Highlight String 5 (A)" }));
    await user.click(screen.getByRole("button", { name: "Highlight fret 3" }));
    expect(screen.getByRole("button", { name: "Highlight String 5 (A)" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Fret 3")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.getByRole("button", { name: "Highlight fret 3" })).toHaveAttribute("aria-pressed", "false");
  });
});
