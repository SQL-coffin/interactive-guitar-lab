# Audio Analysis Package

This package connects the Python audio feature worker to the existing TypeScript theory engine.

## Pipeline

1. `extractAudioFeatures(blob, { baseUrl, filename })` uploads an audio blob to `POST /v1/features/chroma`, returning fixed-window chroma plus best-effort BPM and beat timestamps.
2. `inferChordCandidates(frame)` ranks templates for the engine-supported chord qualities against each 12-bin chroma vector.
3. `analyzeChromaProgression(frames)` searches playable voicings for top chord hypotheses and asks `optimizeVoicingProgression` to jointly rank chord hypotheses and fingerings across the sequence.
4. `analyzeAudioForChords(blob, options)` composes those steps into a single server-side entry point.

5. Note events (optional, independent of chord inference):
   - `extractNoteEvents(blob, { baseUrl, filename })` calls `POST /v1/features/note-events`.
   - `analyzeAudioNoteEvents(blob, options)` validates the events and adds a `summary` (event count, unresolved offsets, max polyphony, pitch span).
   - `analyzeAudioForChords(blob, { ..., includeNoteEvents: true })` gets chroma and note events from **one** upload and adds an optional `noteEvents` field. Chord, key and chord-sheet output is identical with or without it.
   - `parseNoteEventAnalysis`, `parseNoteEvent`, `validateNoteEvents` and `sortNoteEvents` are the runtime validators. They reject non-finite or negative timestamps, offsets at or before the onset, confidences outside [0, 1], unpaired `offsetSeconds`/`offsetConfidence`, unsorted lists and more than `MAX_NOTE_EVENTS` (10,000) events.

## Suggested call

```ts
const result = await analyzeAudioForChords(audioBlob, {
  baseUrl: process.env.AUDIO_WORKER_URL ?? "http://127.0.0.1:8010",
  filename: "song.wav",
  chordAnalysis: {
    chordCandidateLimit: 3,
    voicingsPerChord: 5,
    voicingSearchOptions: { maxFret: 15, maxFretSpan: 4 },
    progressionOptions: { limit: 5 },
  },
});
```

Use this from a server-side API handler; do not expose an internal worker URL or direct audio-worker access to an untrusted browser.

## Scoring notes

- Chord `confidence` is a cosine-style similarity score, not a calibrated probability.
- The optimizer combines voicing ergonomics, chord-fit penalty, hand-position movement, per-string fret movement, muting changes, and lowest-note movement.
- Scores and weights are transparent and configurable. The default values are an initial heuristic and should be tuned against annotated recordings.
- Chord inference uses chroma windows only. Note events are a separate, opt-in heuristic layer: they do not feed chord, key or voicing analysis, and their confidences are uncalibrated scores. There is no velocity field, because spectral level is not picking intensity.
- The chroma path does not return exact chord boundaries. Its windows should be interpreted as analysis intervals. Beat-aligned segmentation is a later phase.

The first version intentionally uses the shared theory engine for chord definitions and voicing validation. Chord recognition is an evidence-ranked hypothesis, especially on full song mixes, rather than a guarantee of a perfect transcription.
