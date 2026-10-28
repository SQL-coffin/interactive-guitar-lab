export const NATURAL_PITCH_CLASSES = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
} as const;

export type LetterName = keyof typeof NATURAL_PITCH_CLASSES;
export type Accidental = -2 | -1 | 0 | 1 | 2;
export interface SpelledPitch { letter: LetterName; accidental: Accidental; pitchClass: number; }

const LETTERS = Object.keys(NATURAL_PITCH_CLASSES) as LetterName[];

export function normalizePitchClass(value: number): number {
  if (!Number.isInteger(value)) throw new TypeError("Pitch class must be an integer.");
  return ((value % 12) + 12) % 12;
}

export function parseSpelledPitch(spelling: string): SpelledPitch {
  const match = /^([A-Ga-g])([#b]{0,2})$/.exec(spelling.trim());
  if (!match) throw new TypeError(`Invalid note spelling: ${spelling}`);
  const letter = match[1]!.toUpperCase() as LetterName;
  const marks = match[2]!;
  if (marks.includes("#") && marks.includes("b")) throw new TypeError("A note spelling cannot mix sharps and flats.");
  const accidental = (marks.startsWith("#") ? marks.length : -marks.length) as Accidental;
  return { letter, accidental, pitchClass: normalizePitchClass(NATURAL_PITCH_CLASSES[letter] + accidental) };
}

export function pitchClassFromSpelling(spelling: string): number {
  return parseSpelledPitch(spelling).pitchClass;
}

export function pitchClassToSharpName(pitchClass: number): string {
  return ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][normalizePitchClass(pitchClass)]!;
}

export function pitchClassToFlatName(pitchClass: number): string {
  return ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"][normalizePitchClass(pitchClass)]!;
}

export function transposePitchClass(pitchClass: number, semitones: number): number {
  if (!Number.isInteger(semitones)) throw new TypeError("Semitone offset must be an integer.");
  return normalizePitchClass(normalizePitchClass(pitchClass) + semitones);
}

export function nextLetter(letter: LetterName, diatonicSteps: number): LetterName {
  if (!Number.isInteger(diatonicSteps)) throw new TypeError("Diatonic steps must be an integer.");
  const index = LETTERS.indexOf(letter);
  return LETTERS[((index + diatonicSteps) % LETTERS.length + LETTERS.length) % LETTERS.length]!;
}
