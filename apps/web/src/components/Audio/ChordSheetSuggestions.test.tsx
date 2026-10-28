import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { buildChordSheet, type ChordCandidate, type ChordInferenceResult } from "@interactive-guitar-lab/audio-analysis";
import type { AnalysisSession } from "@/state/lab/model";
import type { ProgressionSlot } from "@/state/progressionState";
import { analysisFixture } from "@/test/analysisFixture";
import { ChordSheetSuggestions } from "./ChordSheetSuggestions";

function candidate(symbol: string, root: string, quality: ChordCandidate["quality"]): ChordCandidate {
  return {
    symbol,
    root,
    rootPitchClass: 0,
    quality,
    confidence: 0.8,
    score: 0.8,
    evidence: {
      chordToneEnergy: 0.8,
      nonChordEnergy: 0.2,
      activePitchClasses: [0, 4, 7],
      matchedPitchClasses: [0, 4, 7],
      bassRootMatch: null,
    },
  };
}

function makeSession(): AnalysisSession {
  const fixture = analysisFixture();
  const frames: ChordInferenceResult[] = [
    { startSeconds: 0, endSeconds: 0.5, candidates: [candidate("C", "C", "major")] },
    { startSeconds: 0.5, endSeconds: 1, candidates: [candidate("D7", "D", "dominant7")] },
    { startSeconds: 1, endSeconds: 1.5, candidates: [candidate("C", "C", "major")] },
  ];
  return {
    schemaVersion: 1,
    id: "session-test",
    createdAt: "2026-10-28T00:00:00.000Z",
    source: { filename: "take.wav", sizeBytes: 100, mimeType: "audio/wav" },
    request: { windowSeconds: 0.5, options: {} },
    result: { ...fixture, chordSheet: buildChordSheet(frames) },
  };
}

function makeSlot(session: AnalysisSession): ProgressionSlot {
  const voicing = session.result.chordAnalysis.optimization!.results[0]!.steps[0]!.voicing;
  return {
    id: "slot-1",
    root: "D",
    quality: "dominant7",
    source: {
      sessionId: session.id,
      pathIndex: 0,
      frameIndexes: [1],
      stepIndexes: [1],
      startSeconds: 0.5,
      endSeconds: 1,
      detected: { symbol: "D7", root: "D", quality: "dominant7" },
      voicing,
    },
  };
}

describe("ChordSheetSuggestions", () => {
  it("inspects the source window and applies a suggestion only to a precisely linked chord", async () => {
    const user = userEvent.setup();
    const session = makeSession();
    const slot = makeSlot(session);
    const onSelectWindow = vi.fn();
    const onApplySuggestion = vi.fn();
    const view = render(
      <ChordSheetSuggestions
        session={session}
        linkedSlots={[slot]}
        onSelectWindow={onSelectWindow}
        onApplySuggestion={onApplySuggestion}
      />,
    );

    expect(screen.getByRole("region", { name: "Review possible chord glitches" })).toBeInTheDocument();
    expect(screen.getByText(/This event lasts 0.50 s/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Inspect window" }));
    expect(onSelectWindow).toHaveBeenCalledWith(1);
    await user.click(screen.getByRole("button", { name: "Apply to progression" }));
    expect(onApplySuggestion).toHaveBeenCalledWith("slot-1", "C", "major");

    const appliedSlot: ProgressionSlot = { ...slot, root: "C", quality: "major" };
    view.rerender(
      <ChordSheetSuggestions
        session={session}
        linkedSlots={[appliedSlot]}
        onSelectWindow={onSelectWindow}
        onApplySuggestion={onApplySuggestion}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Applied to progression");
    expect(screen.queryByRole("button", { name: "Apply to progression" })).not.toBeInTheDocument();
    // Applying a hint never edits the immutable analysis record.
    expect(session.result.chordSheet.events[1]!.chordSymbol).toBe("D7");
  });

  it("does not overwrite a different user correction and allows hiding a suggestion", async () => {
    const user = userEvent.setup();
    const session = makeSession();
    const editedSlot: ProgressionSlot = { ...makeSlot(session), root: "A", quality: "minor" };
    const onApplySuggestion = vi.fn();
    render(
      <ChordSheetSuggestions
        session={session}
        linkedSlots={[editedSlot]}
        onSelectWindow={vi.fn()}
        onApplySuggestion={onApplySuggestion}
      />,
    );

    expect(screen.getByText(/already has a different edit/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply to progression" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Hide for now" }));
    expect(screen.queryByRole("region", { name: "Review possible chord glitches" })).not.toBeInTheDocument();
    expect(onApplySuggestion).not.toHaveBeenCalled();
  });

  it("offers inspection only when the progression has no exact source-frame match", () => {
    const session = makeSession();
    const slot = { ...makeSlot(session), source: { ...makeSlot(session).source!, frameIndexes: [0, 1] } };
    render(
      <ChordSheetSuggestions
        session={session}
        linkedSlots={[slot]}
        onSelectWindow={vi.fn()}
        onApplySuggestion={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Inspect window" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply to progression" })).not.toBeInTheDocument();
    expect(screen.getByText(/No exact matching chord exists/)).toBeInTheDocument();
  });
});
