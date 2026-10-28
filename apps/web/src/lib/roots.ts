export type SpellingPreference = "sharp" | "flat";

export interface RootOption {
  /** Spelling used when sharps are preferred. */
  sharp: string;
  /** Spelling used when flats are preferred. */
  flat: string;
}

/** Static selector options — the engine parses whichever spelling is chosen. */
export const ROOT_OPTIONS: readonly RootOption[] = [
  { sharp: "C", flat: "C" },
  { sharp: "C#", flat: "Db" },
  { sharp: "D", flat: "D" },
  { sharp: "D#", flat: "Eb" },
  { sharp: "E", flat: "E" },
  { sharp: "F", flat: "F" },
  { sharp: "F#", flat: "Gb" },
  { sharp: "G", flat: "G" },
  { sharp: "G#", flat: "Ab" },
  { sharp: "A", flat: "A" },
  { sharp: "A#", flat: "Bb" },
  { sharp: "B", flat: "B" },
];

export function spellRootOption(option: RootOption, preference: SpellingPreference): string {
  return option[preference];
}

export function findRootOption(spelling: string): RootOption | undefined {
  return ROOT_OPTIONS.find((option) => option.sharp === spelling || option.flat === spelling);
}

/** Pretty-print ASCII accidentals for display ("Bb" → "B♭"). */
export function displaySpelling(spelling: string): string {
  return spelling.replace(/##/g, "𝄪").replace(/#/g, "♯").replace(/bb$/, "𝄫").replace(/(?<=^[A-G])b/, "♭");
}
