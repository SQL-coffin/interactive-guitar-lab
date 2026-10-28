import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ChordSegment } from "@/lib/score/chordTrack";
import type { ScoreBar } from "@/lib/score/grid";
import type { MelodyNote, NoteSegment } from "@/lib/score/melody";
import { DOT_OFFSET, JianpuBar, TICK_WIDTH } from "./JianpuBar";

const PAD = 14; // left padding of a bar, as in JianpuBar
const tickX = (tick: number) => PAD + tick * TICK_WIDTH;

const bar: ScoreBar = { index: 0, number: 1, pickup: false, startSeconds: 0, endSeconds: 2, beatTimesSeconds: [0, 0.5, 1, 1.5], ticks: 16, startTick: 0, irregular: false };

function seg(startTick: number, ticks: number, degree: MelodyNote["degree"], extra: Partial<NoteSegment> = {}): NoteSegment {
  return {
    note: { id: `n${startTick}`, startTick, ticks, degree, accidental: 0, octave: 0, source: "manual" },
    barIndex: 0, startTick, ticks, tiedFromPrevious: false, tiedToNext: false, ...extra,
  };
}

function draw(noteSegments: NoteSegment[], chordSegments: ChordSegment[] = []) {
  const { container } = render(
    <JianpuBar
      bar={bar} ticksPerBeat={4} isLast={false} chordSegments={chordSegments} noteSegments={noteSegments}
      selectedEventIndex={null} selectedNoteId={null} cursorTick={null}
      onSelectChord={() => {}} onSelectNote={() => {}} onSelectSlot={() => {}}
    />,
  );
  return container;
}

const notes = (c: HTMLElement) => [...c.querySelectorAll<SVGGElement>(".jianpu-note")];
const num = (el: Element, attr: string) => Number(el.getAttribute(attr));
const parts = (g: Element, kind: string) => [...g.querySelectorAll(`[data-glyph="${kind}"]`)];

describe("JianpuBar dotted notes", () => {
  it("draws the dotted-quarter dot beside its digit, not on the following beat, and keeps 6 ticks", () => {
    const c = draw([seg(0, 6, 5), seg(6, 2, 3)]);
    const [dotted, next] = notes(c);
    expect(dotted).toHaveAttribute("aria-label", "Bar 1, beat 1: 5, dotted quarter");
    const head = parts(dotted!, "head")[0]!;
    const dots = parts(dotted!, "dot");
    expect(dots).toHaveLength(1);
    const gap = num(dots[0]!, "cx") - num(head, "x");
    expect(gap).toBe(DOT_OFFSET);
    expect(gap).toBeGreaterThanOrEqual(6); // clear of the digit
    expect(gap).toBeLessThanOrEqual(12); // still attached to it
    // Inside the first beat: the dot does not drift onto beat 2, where the old renderer put it.
    expect(num(dots[0]!, "cx")).toBeLessThan(tickX(4));
    // No dashes or underlines for a dotted quarter.
    expect(parts(dotted!, "dash")).toHaveLength(0);
    expect(parts(dotted!, "underline")).toHaveLength(0);
    // The logical length is unchanged: the next note starts after 6 ticks (beat 2 + 2/4).
    expect(next).toHaveAttribute("aria-label", "Bar 1, beat 2 + 2/4: 3, eighth");
    expect(num(parts(next!, "head")[0]!, "x")).toBeGreaterThan(tickX(6));
    expect(num(parts(next!, "head")[0]!, "x")).toBeGreaterThan(num(dots[0]!, "cx"));
  });

  it("draws the dotted-eighth dot beside its digit with one underline across head and dot, and keeps 3 ticks", () => {
    const c = draw([seg(0, 3, 6), seg(3, 1, 1)]);
    const [dotted, next] = notes(c);
    expect(dotted).toHaveAttribute("aria-label", "Bar 1, beat 1: 6, dotted eighth");
    const head = parts(dotted!, "head")[0]!;
    const dot = parts(dotted!, "dot")[0]!;
    const gap = num(dot, "cx") - num(head, "x");
    expect(gap).toBe(DOT_OFFSET);
    expect(num(dot, "cx")).toBeLessThan(tickX(3)); // before the following sixteenth
    // One underline (减时线) spanning the head and its dot: exactly the 3 ticks of the value.
    const lines = parts(dotted!, "underline");
    expect(lines).toHaveLength(1);
    expect(num(lines[0]!, "x1")).toBe(tickX(0) + 1);
    expect(num(lines[0]!, "x2")).toBe(tickX(3) - 1);
    expect(num(lines[0]!, "x2")).toBeGreaterThan(num(dot, "cx"));
    // The following sixteenth starts at tick 3 with its own two underlines.
    expect(next).toHaveAttribute("aria-label", "Bar 1, beat 1 + 3/4: 1, sixteenth");
    const nextLines = parts(next!, "underline");
    expect(nextLines).toHaveLength(2);
    expect(num(nextLines[0]!, "x1")).toBe(tickX(3) + 1);
  });

  it("draws dotted chord hits in the rhythm lane the same way", () => {
    const chord: ChordSegment = { barIndex: 0, startTick: 0, ticks: 6, kind: "chord", eventIndex: 0, chordSymbol: "C", tiedFromPrevious: false, tiedToNext: false, confident: true };
    const lane = draw([], [chord]).querySelector('[data-kind="chord"]')!;
    const dot = parts(lane, "dot")[0]!;
    expect(num(dot, "cx") - num(parts(lane, "head")[0]!, "x")).toBe(DOT_OFFSET);
  });
});

describe("JianpuBar dashes, ties and bar-crossing notes", () => {
  it("keeps dashes on their own beats", () => {
    const c = draw([seg(0, 16, 1)]);
    const dashes = parts(notes(c)[0]!, "dash");
    expect(dashes.map((d) => (num(d, "x1") + num(d, "x2")) / 2)).toEqual([1, 2, 3].map((k) => tickX(k * 4) + 2 * TICK_WIDTH));
  });

  it("ties a dotted quarter to its remainder from digit to digit", () => {
    // 7 ticks = dotted quarter tied to a sixteenth.
    const c = draw([seg(0, 7, 2)]);
    const g = notes(c)[0]!;
    expect(g).toHaveAttribute("aria-label", "Bar 1, beat 1: 2, dotted quarter tied to sixteenth");
    const heads = parts(g, "head");
    expect(heads.map((h) => num(h, "x"))).toEqual([tickX(0) + 10, tickX(6) + TICK_WIDTH / 2]);
    const tie = g.querySelector("path")!.getAttribute("d")!;
    expect(tie.startsWith(`M ${tickX(0) + 10} `)).toBe(true);
    expect(tie.endsWith(` ${tickX(6) + TICK_WIDTH / 2} ${112 - 20}`)).toBe(true);
  });

  it("ties a note across the bar line in both bars", () => {
    const end = draw([seg(12, 4, 5, { tiedToNext: true })]);
    const endTie = notes(end)[0]!.querySelector("path")!.getAttribute("d")!;
    expect(endTie.startsWith(`M ${tickX(12) + 10} `)).toBe(true);
    expect(endTie).toMatch(new RegExp(` ${tickX(16) + PAD - 2} \\d+$`));
    const start = draw([seg(0, 2, 5, { tiedFromPrevious: true })]);
    const startTie = notes(start)[0]!.querySelector("path")!.getAttribute("d")!;
    expect(startTie.startsWith("M 2 ")).toBe(true);
    expect(startTie).toMatch(new RegExp(` ${tickX(0) + 10} \\d+$`));
  });
});
