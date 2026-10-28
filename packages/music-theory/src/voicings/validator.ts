import type { BuiltChord } from "../chords/index.js";
import type { VoicingSearchOptions, Voicing } from "./types.js";

export interface VoicingValidation {
  valid: boolean;
  errors: string[];
}

/** Validates a voicing independently of the search generator. */
export function validateVoicing(
  voicing: Voicing,
  chord: BuiltChord,
  options: VoicingSearchOptions = {},
): VoicingValidation {
  const errors: string[] = [];
  const tuning = options.tuning ?? [40, 45, 50, 55, 59, 64];
  const minFret = options.minFret ?? 0;
  const maxFret = options.maxFret ?? 12;
  const maxFretSpan = options.maxFretSpan ?? 4;
  const minNotes = options.minNotes ?? 3;
  const maxNotes = options.maxNotes ?? tuning.length;
  const allowOpenStrings = options.allowOpenStrings ?? true;
  const allowMutedStrings = options.allowMutedStrings ?? true;
  const requireRoot = options.requireRoot ?? true;

  if (voicing.strings.length !== tuning.length) errors.push("Voicing must contain exactly one entry per string.");
  if (!allowMutedStrings && voicing.strings.some((note) => note === null)) errors.push("Muted strings are not allowed.");

  const notes = voicing.strings.filter((note) => note !== null);
  if (notes.length < minNotes) errors.push(`Voicing must sound at least ${minNotes} notes.`);
  if (notes.length > maxNotes) errors.push(`Voicing must sound no more than ${maxNotes} notes.`);

  const chordPitchClasses = new Set(chord.tones.map((tone) => tone.pitchClass));
  for (let i = 0; i < voicing.strings.length; i++) {
    const note = voicing.strings[i];
    if (note === null) continue;
    if (note.string !== i + 1) errors.push("String entries must be ordered low to high and use 1-based string numbers.");
    if (note.fret < minFret || note.fret > maxFret) errors.push(`String ${i + 1} is outside the allowed fret range.`);
    if (!allowOpenStrings && note.fret === 0) errors.push("Open strings are not allowed.");
    if (note.midi !== tuning[i]! + note.fret) errors.push(`String ${i + 1} has an inconsistent MIDI pitch.`);
    if (!chordPitchClasses.has(note.pitchClass)) errors.push(`String ${i + 1} plays a note outside the chord.`);
  }

  const fretted = notes.filter((note) => note.fret > 0);
  const fretNumbers = fretted.map((note) => note.fret);
  const span = fretNumbers.length ? Math.max(...fretNumbers) - Math.min(...fretNumbers) : 0;
  if (span > maxFretSpan) errors.push(`Fret span exceeds the maximum of ${maxFretSpan}.`);

  const presentPitchClasses = new Set(notes.map((note) => note.pitchClass));
  const missing = chord.tones.filter((tone) => !presentPitchClasses.has(tone.pitchClass));
  if (requireRoot && !presentPitchClasses.has(chord.tones[0]!.pitchClass)) errors.push("The root note is required but missing.");
  if (options.rootString !== undefined) {
    if (!Number.isInteger(options.rootString) || options.rootString < 1 || options.rootString > tuning.length) {
      errors.push("rootString is outside the supplied tuning.");
    } else if (voicing.strings[options.rootString - 1]?.pitchClass !== chord.tones[0]!.pitchClass) {
      errors.push("The selected root string must play the chord root.");
    }
  }
  // A missing chord tone is permitted for shell voicings, unless the search explicitly requests all tones.
  if ((options as VoicingSearchOptions & { requireAllTones?: boolean }).requireAllTones && missing.length) {
    errors.push(`Missing chord tones: ${missing.map((tone) => tone.degree).join(", ")}.`);
  }
  return { valid: errors.length === 0, errors };
}
