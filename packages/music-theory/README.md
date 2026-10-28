# @interactive-guitar-lab/music-theory

Framework-independent TypeScript functions for music-theory calculations.

Current modules:
- `pitch`: pitch classes, note spelling parsing, transposition helpers.
- `intervals`: interval quality from diatonic number and semitone distance.
- `chords`: initial chord construction and diatonic spelling.
- `fretboard`: standard-tuning mapping from string/fret to MIDI pitch and pitch class.

The package is an early foundation, not a complete chord recognizer or fingering search engine. API validation and voicing search are planned next.
