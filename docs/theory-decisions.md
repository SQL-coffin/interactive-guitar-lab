# Music Theory Decisions

## Pitch representation
- Pitch class is an integer 0–11 in twelve-tone equal temperament (C = 0).
- MIDI numbers identify absolute semitone positions.
- Spelling is retained separately from pitch class; C# and Db may share a pitch class but are not interchangeable in all theoretical contexts.
- The initial engine supports double accidentals in parsing and chord-tone spelling where representable.

## Supported chord qualities
- Major: 1, 3, 5
- Minor: 1, b3, 5
- Dominant seventh: 1, 3, 5, b7
- Major seventh: 1, 3, 5, 7
- Minor seventh: 1, b3, 5, b7
- Suspended second: 1, 2, 5
- Suspended fourth: 1, 4, 5
- Diminished triad: 1, b3, b5
- Augmented triad: 1, 3, #5
- Added ninth: 1, 3, 5, 9 (the ninth is 14 semitones above the root and is spelled as a ninth)

Chord symbols use `sus2`, `sus4`, `dim`, `aug`, and `add9` suffixes. Added tones are represented as distinct scale degrees even when they share a pitch class with a simple interval in another octave.

## Fretboard conventions
- Tuning arrays are ordered from lowest-pitched string to highest-pitched string.
- String numbers are one-based relative to that array: string 1 is the lowest-pitched string. This is intentionally different from conventional guitar diagram numbering.
- Fret 0 means an open string.
- Standard tuning MIDI values are [40, 45, 50, 55, 59, 64] (low E through high E).

## Chord recognition
A pitch-class set does not always determine a unique chord name or harmonic function. Future recognition APIs should return candidates and evidence, especially for inversions, omitted tones, and ambiguous contexts.
