export type IntervalQuality = "perfect" | "minor" | "major" | "augmented" | "diminished";
export interface Interval { number: number; quality: IntervalQuality; semitones: number; abbreviation: string; }
const MAJOR_OFFSETS = [0,2,4,5,7,9,11] as const;
const PERFECT_NUMBERS = new Set([1,4,5]);

export function intervalFromDistance(number: number, semitones: number): Interval {
  if (!Number.isInteger(number) || number<1) throw new RangeError("Interval number must be a positive integer.");
  if (!Number.isInteger(semitones) || semitones<0) throw new RangeError("Semitones must be a non-negative integer.");
  const octaves=Math.floor((number-1)/7);
  const simple=((number-1)%7)+1;
  const natural=MAJOR_OFFSETS[simple-1]!+octaves*12;
  const delta=semitones-natural;
  const perfectType=PERFECT_NUMBERS.has(simple);
  let quality: IntervalQuality;
  if(delta===0) quality=perfectType?"perfect":"major";
  else if(delta===-1) quality=perfectType?"diminished":"minor";
  else if(delta===1) quality="augmented";
  else quality=delta<0?"diminished":"augmented";
  const prefix=quality==="perfect"?"P":quality==="major"?"M":quality==="minor"?"m":quality==="augmented"?"A":"d";
  return {number,quality,semitones,abbreviation:`${prefix}${number}`};
}
