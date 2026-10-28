import type { BuiltChord, ChordTone } from "../chords/index.js";
import type { FretboardPosition } from "../fretboard/index.js";

export interface VoicingSearchOptions {
  /** Open-string MIDI pitches, ordered low to high. Defaults to standard guitar tuning. */
  tuning?: readonly number[];
  /** Highest fret considered, inclusive. Defaults to 12. */
  maxFret?: number;
  /** Lowest fret considered, inclusive. Defaults to 0. */
  minFret?: number;
  /** Maximum number of frets between the lowest and highest fretted notes. Defaults to 4. */
  maxFretSpan?: number;
  /** Minimum sounding strings. Defaults to 3. */
  minNotes?: number;
  /** Maximum sounding strings. Defaults to 6. */
  maxNotes?: number;
  /** Require the root on this 1-based string number. */
  rootString?: number;
  /** Permit open strings. Defaults to true. */
  allowOpenStrings?: boolean;
  /** Permit muted strings. Defaults to true. */
  allowMutedStrings?: boolean;
  /** Require the root to be present. Defaults to true. */
  requireRoot?: boolean;
  /** Number of sorted results returned. Defaults to 50. */
  limit?: number;
}

export interface VoicingNote extends FretboardPosition {
  degree: string;
  chordToneSpelling: string;
}

export interface Voicing {
  chordSymbol: string;
  /** One entry per string, ordered low to high. null means muted. */
  strings: Array<VoicingNote | null>;
  notes: VoicingNote[];
  frettedNotes: number;
  fretSpan: number;
  lowestFret: number;
  highestFret: number;
  missingDegrees: string[];
  score: number;
}

export interface VoicingSearchResult {
  chord: BuiltChord;
  options: Required<Omit<VoicingSearchOptions, "rootString">> & { rootString?: number };
  results: Voicing[];
  totalFound: number;
}
