import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { keyChangeDetection, keyChangeEvent } from "@/test/keyChangeFixture";
import { KeyChangePanel } from "./KeyChangePanel";

const renderPanel = (detection: Parameters<typeof KeyChangePanel>[0]["detection"], onSelectEvent = vi.fn()) => {
  render(<KeyChangePanel detection={detection} durationSeconds={10} onSelectEvent={onSelectEvent} />);
  return { onSelectEvent, panel: screen.getByRole("region", { name: /Key changes/ }) };
};

describe("KeyChangePanel", () => {
  it("lists detected events with times, keys, confidence, persistence and evidence", () => {
    const { panel } = renderPanel(keyChangeDetection());
    const item = within(within(panel).getByRole("list", { name: "Candidate key changes" })).getByRole("listitem");

    expect(within(item).getByRole("button", { name: /Change 1 at 0:03.2: C major to G major \/ E minor/ })).toBeInTheDocument();
    expect(item).toHaveTextContent("0:01.5–0:04.0");
    expect(item).toHaveTextContent("Moderate confidence · score 0.63 (heuristic)");
    expect(item).toHaveTextContent("2 windows before · 3 windows after (≈ 6 s)");
    expect(item).toHaveTextContent("Possible change · not confirmed");
    expect(item).toHaveTextContent("可能是局部主音化或正式转调");
    // A heuristic score is never presented as a probability.
    expect(panel.textContent).not.toMatch(/%|(?<![.\d])63/);

    const evidence = within(item).getByRole("table");
    expect(within(evidence).getByRole("row", { name: /Pitch classes/ })).toHaveTextContent("C E GD F♯ G B");
    expect(within(evidence).getByRole("row", { name: /Bass support/ })).toHaveTextContent("C");
    expect(within(evidence).getByRole("row", { name: /Bass support/ })).toHaveTextContent("No clear bass");
    expect(within(evidence).getByRole("row", { name: /Chord candidates/ })).toHaveTextContent("F♯m7b5");
    expect(item).toHaveTextContent("A different local tonal-profile winner persists");
  });

  it("keeps uncertain events uncertain", () => {
    const { panel } = renderPanel(keyChangeDetection({
      events: [keyChangeEvent({ status: "uncertain", interpretation: "uncertain", confidence: "low", confidenceScore: 0.3 })],
    }));
    expect(panel).toHaveTextContent("Uncertain · 不确定");
    expect(panel).toHaveTextContent("Low confidence · score 0.30 (heuristic)");
    expect(panel).not.toHaveTextContent("Possible change");
  });

  it("reports the selected event to the caller", async () => {
    const event = keyChangeEvent({ timeSeconds: 7.5 });
    const { onSelectEvent, panel } = renderPanel(keyChangeDetection({ events: [keyChangeEvent(), event] }));
    await userEvent.setup().click(within(panel).getByRole("button", { name: /Change 2 at 0:07.5/ }));
    expect(onSelectEvent).toHaveBeenCalledWith(event);
  });

  it("says when no change met the persistence requirement", () => {
    const { panel } = renderPanel(keyChangeDetection({ status: "no-clear-change", events: [], explanation: "No sustained change met the requirement." }));
    expect(within(panel).getByRole("status")).toHaveTextContent("No clear key change");
    expect(panel).toHaveTextContent("persistence requirement");
    expect(within(panel).queryByRole("list")).not.toBeInTheDocument();
  });

  it("says when the evidence is insufficient", () => {
    const { panel } = renderPanel(keyChangeDetection({ status: "insufficient-evidence", events: [], explanation: "The audio is too short." }));
    expect(within(panel).getByRole("status")).toHaveTextContent("Not enough evidence");
    expect(panel).toHaveTextContent("The audio is too short.");
    expect(within(panel).queryByRole("list")).not.toBeInTheDocument();
  });

  it("explains that sessions saved before detection existed have no key-change data", () => {
    const { panel } = renderPanel(undefined);
    expect(within(panel).getByRole("note")).toHaveTextContent(/predates key-change detection/);
  });
});
