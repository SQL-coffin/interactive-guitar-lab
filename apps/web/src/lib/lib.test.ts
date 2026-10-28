import { describe, expect, it } from "vitest";
import { diagramWindow, voicingTab } from "./diagram";
import { conventionalStringNumber, stringLabel } from "./strings";
import { displaySpelling, findRootOption, spellRootOption } from "./roots";
import { degreeFamily } from "./degrees";
import { qualityLabel } from "./qualities";

const note = (fret: number) => ({ fret }) as never;

describe("diagramWindow", () => {
  it("anchors low voicings at the nut", () => {
    expect(diagramWindow({ lowestFret: 1, highestFret: 3 })).toEqual({ startFret: 1, fretCount: 4, showNut: true });
    expect(diagramWindow({ lowestFret: 0, highestFret: 0 })).toEqual({ startFret: 1, fretCount: 4, showNut: true });
  });
  it("starts higher voicings at their lowest fret and grows to fit the span", () => {
    expect(diagramWindow({ lowestFret: 8, highestFret: 10 })).toEqual({ startFret: 8, fretCount: 4, showNut: false });
    expect(diagramWindow({ lowestFret: 3, highestFret: 8 })).toEqual({ startFret: 3, fretCount: 6, showNut: false });
  });
});

describe("voicingTab", () => {
  it("is compact for single-digit frets and dashed otherwise", () => {
    expect(voicingTab({ strings: [null, note(3), note(2), note(0), note(1), note(0)] })).toBe("x32010");
    expect(voicingTab({ strings: [null, note(10), note(12), null, note(0), note(0)] })).toBe("x-10-12-x-0-0");
  });
});

describe("strings", () => {
  it("converts engine (low-first) numbering to guitar convention", () => {
    expect(conventionalStringNumber(1, 6)).toBe(6);
    expect(conventionalStringNumber(6, 6)).toBe(1);
    expect(stringLabel(1, 6, "E")).toBe("String 6 (low E)");
    expect(stringLabel(6, 6, "E")).toBe("String 1 (high E)");
    expect(stringLabel(3, 6, "D")).toBe("String 4 (D)");
  });
});

describe("roots", () => {
  it("respects spelling preference and finds options by either spelling", () => {
    const option = findRootOption("Db")!;
    expect(spellRootOption(option, "sharp")).toBe("C#");
    expect(spellRootOption(option, "flat")).toBe("Db");
    expect(findRootOption("C#")).toBe(option);
  });
  it("prettifies accidentals without touching the note letter B", () => {
    expect(displaySpelling("Bb")).toBe("B♭");
    expect(displaySpelling("B")).toBe("B");
    expect(displaySpelling("F#")).toBe("F♯");
    expect(displaySpelling("Bbm7")).toBe("B♭m7");
    expect(displaySpelling("C##")).toBe("C𝄪");
  });
});

describe("labels", () => {
  it("classifies degree labels into colour families", () => {
    expect(degreeFamily("1")).toBe("root");
    expect(degreeFamily("♭3")).toBe("third");
    expect(degreeFamily("♭7")).toBe("seventh");
    expect(degreeFamily("4")).toBe("other");
    expect(degreeFamily(undefined)).toBe("other");
  });
  it("falls back to the raw id for unknown qualities", () => {
    expect(qualityLabel("dominant7")).toBe("Dominant 7");
    expect(qualityLabel("add9" as never)).toBe("add9");
  });
});
