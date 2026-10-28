import { NATURAL_PITCH_CLASSES, nextLetter, normalizePitchClass, parseSpelledPitch, type LetterName } from "../pitch/index.js";

export type ChordQuality = "major" | "minor" | "dominant7" | "major7" | "minor7" | "sus4";
export interface ChordTone { spelling: string; pitchClass: number; degree: string; semitonesFromRoot: number; }
export interface BuiltChord { symbol: string; root: string; quality: ChordQuality; formula: string[]; tones: ChordTone[]; }

const DEFINITIONS: Record<ChordQuality, { suffix: string; formula: string[]; degrees: Array<{ steps: number; semitones: number; degree: string }> }> = {
  major: { suffix: "", formula: ["1","3","5"], degrees: [{steps:0,semitones:0,degree:"1"},{steps:2,semitones:4,degree:"3"},{steps:4,semitones:7,degree:"5"}] },
  minor: { suffix: "m", formula: ["1","♭3","5"], degrees: [{steps:0,semitones:0,degree:"1"},{steps:2,semitones:3,degree:"♭3"},{steps:4,semitones:7,degree:"5"}] },
  dominant7: { suffix: "7", formula: ["1","3","5","♭7"], degrees: [{steps:0,semitones:0,degree:"1"},{steps:2,semitones:4,degree:"3"},{steps:4,semitones:7,degree:"5"},{steps:6,semitones:10,degree:"♭7"}] },
  major7: { suffix: "Maj7", formula: ["1","3","5","7"], degrees: [{steps:0,semitones:0,degree:"1"},{steps:2,semitones:4,degree:"3"},{steps:4,semitones:7,degree:"5"},{steps:6,semitones:11,degree:"7"}] },
  minor7: { suffix: "m7", formula: ["1","♭3","5","♭7"], degrees: [{steps:0,semitones:0,degree:"1"},{steps:2,semitones:3,degree:"♭3"},{steps:4,semitones:7,degree:"5"},{steps:6,semitones:10,degree:"♭7"}] },
  sus4: { suffix: "sus4", formula: ["1","4","5"], degrees: [{steps:0,semitones:0,degree:"1"},{steps:3,semitones:5,degree:"4"},{steps:4,semitones:7,degree:"5"}] }
};

function spellTone(rootLetter: LetterName, steps: number, targetPc: number): string {
  const letter = nextLetter(rootLetter, steps);
  let accidental = normalizePitchClass(targetPc - NATURAL_PITCH_CLASSES[letter]);
  if (accidental > 6) accidental -= 12;
  if (accidental < -2 || accidental > 2) throw new Error("Chord tone requires an unsupported accidental.");
  return letter + (accidental > 0 ? "#".repeat(accidental) : "b".repeat(-accidental));
}

export function buildChord(root: string, quality: ChordQuality): BuiltChord {
  const parsedRoot = parseSpelledPitch(root);
  const definition = DEFINITIONS[quality];
  if (!definition) throw new TypeError(`Unsupported chord quality: ${quality}`);
  const tones = definition.degrees.map(({steps, semitones, degree}) => {
    const pitchClass = normalizePitchClass(parsedRoot.pitchClass + semitones);
    return { spelling: spellTone(parsedRoot.letter, steps, pitchClass), pitchClass, degree, semitonesFromRoot: semitones };
  });
  return { symbol: `${root}${definition.suffix}`, root, quality, formula: [...definition.formula], tones };
}

export function getSupportedChordQualities(): ChordQuality[] {
  return Object.keys(DEFINITIONS) as ChordQuality[];
}
