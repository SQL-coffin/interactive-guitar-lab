import type { Voicing } from "@/services";

export interface DiagramWindow {
  /** First fret row drawn below the nut / top line. */
  startFret: number;
  /** Number of fret rows drawn. */
  fretCount: number;
  /** True when the window starts at fret 1, so the nut is drawn. */
  showNut: boolean;
}

const MIN_ROWS = 4;

/** Chooses which frets a chord diagram shows. Pure layout; no theory involved. */
export function diagramWindow(voicing: Pick<Voicing, "lowestFret" | "highestFret">): DiagramWindow {
  const { lowestFret, highestFret } = voicing;
  if (highestFret <= MIN_ROWS) return { startFret: 1, fretCount: MIN_ROWS, showNut: true };
  const startFret = Math.max(1, lowestFret);
  return { startFret, fretCount: Math.max(MIN_ROWS, highestFret - startFret + 1), showNut: startFret === 1 };
}

/** Tab-style shorthand, low string first: "x02210", or "x-10-12-12-11-10" when any fret ≥ 10. */
export function voicingTab(voicing: Pick<Voicing, "strings">): string {
  const parts = voicing.strings.map((note) => (note === null ? "x" : String(note.fret)));
  return parts.some((part) => part.length > 1) ? parts.join("-") : parts.join("");
}
