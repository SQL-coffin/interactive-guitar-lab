import { buildChord, type ChordQuality } from "../chords/index.js";
import { getNoteAtPosition, STANDARD_GUITAR_TUNING } from "../fretboard/index.js";
import { validateVoicing } from "./validator.js";
import type { Voicing, VoicingNote, VoicingSearchOptions, VoicingSearchResult } from "./types.js";

const DEFAULTS = {
  maxFret: 12,
  minFret: 0,
  maxFretSpan: 4,
  minNotes: 3,
  maxNotes: 6,
  allowOpenStrings: true,
  allowMutedStrings: true,
  requireRoot: true,
  requireAllTones: false,
  limit: 50,
} as const;

function scoreVoicing(voicing: Voicing): number {
  const muted = voicing.strings.filter((note) => note === null).length;
  const open = voicing.notes.filter((note) => note.fret === 0).length;
  const uniqueFrets = new Set(voicing.notes.filter((note) => note.fret > 0).map((note) => note.fret)).size;
  const bass = voicing.notes[0];
  const rootBassBonus = bass?.degree === "1" ? 4 : 0;
  const missingPenalty = voicing.missingDegrees.length * 8;
  return voicing.fretSpan * 3 + voicing.frettedNotes * 0.6 + uniqueFrets * 1.2 + muted * 0.4
    - open * 0.8 - rootBassBonus + missingPenalty;
}

/**
 * Enumerates fretboard candidates, independently validates each result, then ranks by a
 * transparent ergonomic heuristic. This is a bounded search, not a claim of optimal fingering.
 */
export function searchVoicings(
  root: string,
  quality: ChordQuality,
  input: VoicingSearchOptions = {},
): VoicingSearchResult {
  const tuning = [...(input.tuning ?? STANDARD_GUITAR_TUNING)];
  const options = { ...DEFAULTS, ...input, tuning };
  const chord = buildChord(root, quality);
  if (tuning.length < 1 || tuning.some((midi) => !Number.isInteger(midi) || midi < 0 || midi > 127)) {
    throw new RangeError("tuning must contain valid MIDI note numbers.");
  }
  if (!Number.isInteger(options.minFret) || !Number.isInteger(options.maxFret)
      || options.minFret < 0 || options.maxFret > 36 || options.minFret > options.maxFret) {
    throw new RangeError("Fret range must satisfy 0 <= minFret <= maxFret <= 36.");
  }
  if (!Number.isInteger(options.maxFretSpan) || options.maxFretSpan < 0) throw new RangeError("maxFretSpan must be a non-negative integer.");
  if (!Number.isInteger(options.minNotes) || !Number.isInteger(options.maxNotes)
      || options.minNotes < 1 || options.maxNotes < options.minNotes || options.maxNotes > tuning.length) {
    throw new RangeError("Note count must satisfy 1 <= minNotes <= maxNotes <= string count.");
  }
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 1000) throw new RangeError("limit must be an integer from 1 to 1000.");
  if (options.rootString !== undefined && (!Number.isInteger(options.rootString) || options.rootString < 1 || options.rootString > tuning.length)) {
    throw new RangeError("rootString must be a valid 1-based string number.");
  }

  const toneByPitch = new Map(chord.tones.map((tone) => [tone.pitchClass, tone]));
  const candidates: Array<Array<VoicingNote | null>> = tuning.map((_, index) => {
    const stringNumber = index + 1;
    const positions: Array<VoicingNote | null> = [];
    if (options.allowMutedStrings && stringNumber !== options.rootString) positions.push(null);
    for (let fret = options.minFret; fret <= options.maxFret; fret++) {
      if (!options.allowOpenStrings && fret === 0) continue;
      const position = getNoteAtPosition(tuning, stringNumber, fret);
      const tone = toneByPitch.get(position.pitchClass);
      if (!tone) continue;
      if (options.rootString === stringNumber && position.pitchClass !== chord.tones[0]!.pitchClass) continue;
      positions.push({ ...position, degree: tone.degree, chordToneSpelling: tone.spelling });
    }
    return positions;
  });

  const found: Voicing[] = [];
  const chosen: Array<VoicingNote | null> = [];
  function visit(stringIndex: number): void {
    if (stringIndex === tuning.length) {
      const notes = chosen.filter((note): note is VoicingNote => note !== null);
      if (notes.length < options.minNotes || notes.length > options.maxNotes) return;
      const present = new Set(notes.map((note) => note.pitchClass));
      if (options.requireRoot && !present.has(chord.tones[0]!.pitchClass)) return;
      if (options.requireAllTones && chord.tones.some((tone) => !present.has(tone.pitchClass))) return;
      const frets = notes.filter((note) => note.fret > 0).map((note) => note.fret);
      const lowestFret = frets.length ? Math.min(...frets) : 0;
      const highestFret = frets.length ? Math.max(...frets) : 0;
      const fretSpan = highestFret - lowestFret;
      if (fretSpan > options.maxFretSpan) return;
      const strings = [...chosen];
      const missingDegrees = chord.tones.filter((tone) => !present.has(tone.pitchClass)).map((tone) => tone.degree);
      const voicing: Voicing = {
        chordSymbol: chord.symbol,
        strings,
        notes,
        frettedNotes: notes.filter((note) => note.fret > 0).length,
        fretSpan,
        lowestFret,
        highestFret,
        missingDegrees,
        score: 0,
      };
      voicing.score = scoreVoicing(voicing);
      if (validateVoicing(voicing, chord, { ...options, tuning }).valid) found.push(voicing);
      return;
    }
    for (const candidate of candidates[stringIndex]!) {
      chosen.push(candidate);
      // Cheap branch pruning avoids exploring combinations that already exceed the note limit.
      if (chosen.filter((note) => note !== null).length <= options.maxNotes) visit(stringIndex + 1);
      chosen.pop();
    }
  }
  visit(0);

  found.sort((a, b) => a.score - b.score || a.highestFret - b.highestFret || a.frettedNotes - b.frettedNotes);
  return {
    chord,
    options: { ...options, tuning },
    results: found.slice(0, options.limit),
    totalFound: found.length,
  };
}
