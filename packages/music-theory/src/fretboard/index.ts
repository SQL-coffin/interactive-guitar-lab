import { normalizePitchClass, pitchClassToSharpName } from "../pitch/index.js";

export interface FretboardPosition { string: number; fret: number; midi: number; pitchClass: number; noteName: string; }
export interface FretboardOptions { /** Open-string MIDI pitches, low to high. */ tuning: number[]; maxFret: number; }
export const STANDARD_GUITAR_TUNING = [40,45,50,55,59,64] as const;

export function getFretboard({tuning,maxFret}: FretboardOptions): FretboardPosition[] {
  if (tuning.length === 0 || tuning.some(n => !Number.isInteger(n) || n < 0 || n > 127)) throw new RangeError("Tuning must contain valid MIDI note numbers.");
  if (!Number.isInteger(maxFret) || maxFret < 0 || maxFret > 36) throw new RangeError("maxFret must be an integer from 0 to 36.");
  const result: FretboardPosition[] = [];
  tuning.forEach((openMidi,index) => {
    for (let fret=0; fret<=maxFret; fret++) {
      const midi=openMidi+fret;
      if (midi>127) continue;
      const pitchClass=normalizePitchClass(midi);
      result.push({string:index+1,fret,midi,pitchClass,noteName:pitchClassToSharpName(pitchClass)});
    }
  });
  return result;
}

export function getNoteAtPosition(tuning: readonly number[], stringNumber: number, fret: number): FretboardPosition {
  if (!Number.isInteger(stringNumber) || stringNumber<1 || stringNumber>tuning.length) throw new RangeError("stringNumber is outside the supplied tuning.");
  if (!Number.isInteger(fret) || fret<0 || fret>36) throw new RangeError("fret must be an integer from 0 to 36.");
  const openMidi=tuning[stringNumber-1]!;
  const midi=openMidi+fret;
  if (!Number.isInteger(openMidi) || openMidi<0 || midi>127) throw new RangeError("Position is outside the supported MIDI range.");
  const pitchClass=normalizePitchClass(midi);
  return {string:stringNumber,fret,midi,pitchClass,noteName:pitchClassToSharpName(pitchClass)};
}
