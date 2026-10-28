import type { Voicing } from "@/services";

export type StringChange = "held" | "moved" | "muted" | "unmuted" | "silent";

export interface StringTransition {
  /** Engine string number (1 = lowest pitch). */
  string: number;
  from: number | null;
  to: number | null;
  change: StringChange;
}

export interface VoicingTransition {
  strings: StringTransition[];
  /** Strings that keep the same fret while sounding in both shapes. */
  held: number;
  /** Strings that sound in both shapes but change fret. */
  moved: number;
  /** Strings that switch between muted and sounding. */
  muteChanges: number;
  /** Sum of absolute fret changes on strings sounding in both shapes. */
  fretTravel: number;
}

/**
 * Compares two voicings string by string. This only reads the returned voicing data; the
 * optimizer's own transition cost comes from the backend and is shown separately.
 */
export function diffVoicings(from: Pick<Voicing, "strings">, to: Pick<Voicing, "strings">): VoicingTransition {
  const count = Math.max(from.strings.length, to.strings.length);
  const strings: StringTransition[] = [];
  let held = 0;
  let moved = 0;
  let muteChanges = 0;
  let fretTravel = 0;
  for (let i = 0; i < count; i++) {
    const a = from.strings[i]?.fret ?? null;
    const b = to.strings[i]?.fret ?? null;
    let change: StringChange;
    if (a === null && b === null) change = "silent";
    else if (a === null) change = "unmuted";
    else if (b === null) change = "muted";
    else if (a === b) change = "held";
    else change = "moved";
    if (change === "held") held++;
    if (change === "moved") {
      moved++;
      fretTravel += Math.abs((a ?? 0) - (b ?? 0));
    }
    if (change === "muted" || change === "unmuted") muteChanges++;
    strings.push({ string: i + 1, from: a, to: b, change });
  }
  return { strings, held, moved, muteChanges, fretTravel };
}
