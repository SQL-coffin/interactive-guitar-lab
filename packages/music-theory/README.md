# @interactive-guitar-lab/music-theory

Framework-independent TypeScript functions for music-theory calculations.

Current modules:
- `pitch`: pitch classes, note spelling parsing, transposition helpers.
- `intervals`: interval quality from diatonic number and semitone distance.
- `chords`: initial chord construction and diatonic spelling.
- `fretboard`: standard-tuning mapping from string/fret to MIDI pitch and pitch class.

- `voicings`: bounded chord-shape enumeration, independent rule validation, and ergonomic ranking.

## Voicing search

```ts
import { searchVoicings } from "@interactive-guitar-lab/music-theory";

const result = searchVoicings("A", "major7", {
  maxFret: 12,
  maxFretSpan: 4,
  rootString: 5,
  requireAllTones: true,
  limit: 20,
});

console.log(result.results); // ranked playable candidates
```

String numbers are 1-based from the lowest-pitched string (string 1 is low E in standard tuning). A muted string is represented by `null`. The ranking is a heuristic, not a guarantee of the best fingering or a substitute for human playability review. Search currently supports chord qualities exposed by the `chords` module.
