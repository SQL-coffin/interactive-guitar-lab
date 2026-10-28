# Jianpu score view (phase 1)

The audio page has a second view, **Score · 简谱**, next to the chord analysis. It lays out the
analysis on bars in Chinese numbered notation. Phase 1 covers meter, bars, chord rhythm and an
editable melody lane. **It does not transcribe melodies.**

## What comes from the analysis

Everything is read from the existing `/api/audio-analysis` response. No new backend fields.

| Shown | Source |
| --- | --- |
| Tempo `♩ ≈ N` | `audio.rhythm.tempoBpm` |
| Time signature | `timeSignatureNumerator` / `timeSignatureDenominator`, otherwise **Unknown** |
| Bar length, meter confidence | `barDurationSeconds`, `meterConfidence` (a heuristic score) |
| Bar lines | `downbeatTimesSeconds` (real timestamps, so uneven bars stay uneven) |
| Positions inside a bar | `beatTimesSeconds`, interpolated piecewise between detected beats |
| Chords | `chordSheet.events` `startSeconds` / `endSeconds` |

Times are never derived from `frameIndex × windowSeconds`. When the meter is unknown, the view
falls back to a proportional time-based chord timeline. It never assumes 4/4.

## Quantization (`apps/web/src/lib/score`)

- One tick is a sixteenth note. Beats before the first downbeat form a pickup bar.
- A time is snapped to the nearest sixteenth only when it lies within 0.3 tick of it. A chord is
  low confidence when either boundary is further off the grid than that, falls in an irregular
  bar (detected beat count ≠ meter), or lies outside the bars (for example audio before the first
  detected beat). Low-confidence chords are drawn dashed with "?" and `≈`, with no note value.
- Consecutive identical chords are already merged into one event by the chord sheet. Events
  crossing a bar line are split into tied segments. Gaps become rests, written as `0` per beat.
- Raw timestamps stay visible in the chord timing panel. Users can nudge start and end on the
  grid, confirm a position or reset it. These adjustments are an overlay
  (`chordAdjustments`); the stored analysis is never modified.

## Melody

The melody lane holds only notes the user enters (`source: "manual"`): degree 1–7 or rest,
duration from whole to sixteenth (including dotted values), octave dots and accidentals. Notes are
tied across bar lines automatically. `MelodyNote.source: "transcription"`, `DetectedNoteEvent`
and `transcription.status` are reserved for a future onset/pitch detector. Today the status is
always `"not-available"`.

## Persistence

Scores are saved per analysis session in the IndexedDB store `scores` (DB version 2, keyed by
`sessionId`) with an explicit **Save score**. Unsaved changes trigger the leave-page warning.
Deleting a session deletes its score.

## Known limits

- Only 3/4 and 4/4 are evaluated by the worker; other meters show as Unknown.
- The key is not detected; `1 = ?` until the user picks one.
- Synthesized test tones whose first beat is detected late (≈ 1 s) leave the opening chord
  outside the bars; the view says so instead of snapping it.
