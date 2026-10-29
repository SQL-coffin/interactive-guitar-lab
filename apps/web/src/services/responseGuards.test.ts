import { describe, expect, it } from "vitest";
import { detectKeyChanges } from "@interactive-guitar-lab/audio-analysis";
import { analysisFixture } from "@/test/analysisFixture";
import { keyChangeDetection, keyChangeEvent } from "@/test/keyChangeFixture";
import { isAudioAnalysisResponse } from "./responseGuards";

const chroma = (pcs: number[]) => Array.from({ length: 12 }, (_, pc) => (pcs.includes(pc) ? 1 : 0));
/** Backend output for two sustained regions: B major collection, then E natural minor. */
function realDetection() {
  const frames = Array.from({ length: 96 }, (_, i) => ({
    startSeconds: i / 2,
    endSeconds: i / 2 + 0.5,
    chroma: chroma(i < 48 ? [11, 1, 3, 4, 6, 8, 10] : [4, 6, 7, 9, 11, 0, 2]),
  }));
  return detectKeyChanges(frames, { windowSeconds: 12, hopSeconds: 2 });
}

describe("isAudioAnalysisResponse: keyChangeDetection", () => {
  it("does not require the field, so older saved sessions stay valid", () => {
    expect(isAudioAnalysisResponse(analysisFixture())).toBe(true);
  });

  it("accepts the backend's own detection output", () => {
    const detection = realDetection();
    expect(detection.status).toBe("detected");
    expect(isAudioAnalysisResponse({ ...analysisFixture(), keyChangeDetection: detection })).toBe(true);
  });

  it.each([
    ["no-clear-change"],
    ["insufficient-evidence"],
  ] as const)("accepts a %s result with no events", (status) => {
    expect(isAudioAnalysisResponse({ ...analysisFixture(), keyChangeDetection: keyChangeDetection({ status, events: [] }) })).toBe(true);
  });

  const event = keyChangeEvent();
  it.each([
    ["null field", null],
    ["unknown status", { ...keyChangeDetection(), status: "confirmed" }],
    ["missing events", { ...keyChangeDetection(), events: undefined }],
    ["unknown event status", keyChangeDetection({ events: [{ ...event, status: "confirmed" as never }] })],
    ["unknown interpretation", keyChangeDetection({ events: [{ ...event, interpretation: "modulation" as never }] })],
    ["unknown confidence", keyChangeDetection({ events: [{ ...event, confidence: "certain" as never }] })],
    ["non-numeric score", keyChangeDetection({ events: [{ ...event, confidenceScore: "0.6" as never }] })],
    ["missing transition window", keyChangeDetection({ events: [{ ...event, transitionWindow: undefined as never }] })],
    ["bad key candidate", keyChangeDetection({ events: [{ ...event, afterCandidates: [{ label: "G major" } as never] }] })],
    ["pitch class out of range", keyChangeDetection({ events: [{ ...event, evidence: { ...event.evidence, observedPitchClassesAfter: [12] } }] })],
    ["bad bass support", keyChangeDetection({ events: [{ ...event, evidence: { ...event.evidence, bassSupportBefore: -1 } }] })],
    ["non-string chord", keyChangeDetection({ events: [{ ...event, evidence: { ...event.evidence, topChordsAfter: [7 as never] } }] })],
    ["bad window", keyChangeDetection({ windows: [{ startSeconds: 0, endSeconds: 12, candidates: [], leadingCandidate: null, scoreMargin: "x" as never }] })],
  ])("rejects a malformed result: %s", (_label, keyChangeDetectionValue) => {
    expect(isAudioAnalysisResponse({ ...analysisFixture(), keyChangeDetection: keyChangeDetectionValue })).toBe(false);
  });
});
