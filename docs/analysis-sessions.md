# Analysis sessions and progressions from audio

## Why results used to disappear

All audio-analysis state (the run status, the response and the chosen `File`) lived in `useState`
inside the `/audio` page component (`useAudioAnalysis` + `AudioAnalysis`). The App Router unmounts
a page on every route change, so leaving the page discarded the result. The hook's unmount cleanup
also called `controller.abort()`, so navigating away mid-analysis cancelled the request
(`net::ERR_ABORTED`). Nothing was persisted, so a reload lost everything. The Progression Builder
had the same problem: its chords lived in a page-local `useReducer`.

## Architecture

`LabSessionProvider` (`apps/web/src/state/lab/`) sits in the root layout, which stays mounted
across routes. It owns:

- the analysis run (`useAudioAnalysis`, moved here), so navigation cannot abort or discard it;
- the active `AnalysisSession` and the recent-session list;
- the active progression draft (`progressionReducer` plus dirty/saved state) and the progression
  optimizer state;
- a timeline focus request, used by "Show in analysis".

Pages read from the provider through `useLab()`. View-only state (selected window, path tab,
label mode) stays local to each page. The analysis payload is held once, in the provider.

## Data model (`state/lab/model.ts`)

- `AnalysisSession`: `id`, `createdAt`, `source` (filename, size, MIME type), `request`
  (`windowSeconds`, options sent) and `result`, the **unmodified** `POST /api/audio-analysis`
  response. That response holds duration, tempo, beats, windows, per-window hypotheses with
  fit/score/evidence, and every optimizer path with costs and steps. It is never edited.
- `ProgressionSlot.source` (`SlotSource`): the link from a progression chord back to its analysis:
  `sessionId`, `pathIndex`, `frameIndexes`, `stepIndexes`, `startSeconds`/`endSeconds`, the
  `detected` chord (symbol, root, quality, as returned) and the optimizer's `voicing` for it.
- **Override layer:** a slot's `root`/`quality` is the chord in use. A correction changes only
  those fields; `source.detected` is preserved, so `isCorrected()` and "Revert" are always
  possible and the raw analysis is untouched.
- `SavedProgression`: name, optional `sessionId`, slots and optimizer settings.

`extractChordSequence(result, pathIndex)` reads the chord the chosen path uses in each window.
Consecutive windows with the same chord become one chord, and a silent window ends a run. Root and
quality are taken from the matching hypothesis in that window; nothing is inferred or invented.

## Persistence

- **IndexedDB** database `guitar-theory-lab`, with stores `sessions` (full records),
  `sessionIndex` (summaries, so the recent list never loads full payloads) and `progressions`.
  It uses the native API; no dependency was added.
- **localStorage** holds only the ids of the active session and progression (about 36 bytes each),
  to restore them after a reload.
- **Audio is never stored.** After a reload, playback is off until the user re-attaches the file
  (this does not re-analyze).
- Completed analyses are saved automatically. Progressions are saved explicitly ("Save
  progression"). Unsaved edits are flagged in the header and builder, and the browser warns before
  a reload or tab close would discard them.
- If IndexedDB is unavailable (blocked storage, some private modes) the app falls back to memory
  and says so.

## Limits

- A progression from audio can hold up to 128 chords. The optimizer works on a selectable 12-chord
  segment (the `/api/progressions/optimize` layer limit).
- Sessions are local to one browser profile; there is no sync or export.
- A full 10-minute analysis is a few MB of JSON per session; there is no automatic eviction, but
  users can delete sessions from "Recent analyses".
- Saved data has `schemaVersion: 1`; a future format change needs a migration.
