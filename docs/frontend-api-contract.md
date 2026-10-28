# Frontend ⇄ Backend API Contract

The chord, voicing, fretboard, progression-optimization, and audio-analysis routes are implemented under `apps/web/src/app/api`. Payload types are re-exported from the shared TypeScript engine packages in `apps/web/src/services/contract.ts`.

## How the frontend consumes it

- UI components call the `GuitarLabService` interface; transport details stay in the service layer.
- The HTTP adapter uses the same-origin `/api` routes by default.
- Set `NEXT_PUBLIC_GUITAR_LAB_API_URL=local` to use the offline adapter in tests. The offline adapter calls the shared engine in-process and cannot run audio analysis.

All payload types are the engine's exported types (`BuiltChord`, `VoicingSearchOptions`, `VoicingSearchResult`, `FretboardPosition`, `ProgressionOptimizationResult`, etc.), so frontend and backend share one definition.

## Conventions

- JSON in and out, except audio upload which uses `multipart/form-data`.
- String numbers follow the engine: **1 = lowest-pitched string**. The UI converts to guitar convention for display only.
- Every non-2xx response uses this body:

  ```json
  { "error": { "code": "invalid_request", "message": "Invalid note spelling: H" } }
  ```

  `code` is one of `invalid_request` (400: bad spelling, unsupported quality, or out-of-range options), `not_found` (404), or `internal_error` (500). The client adds `network_error` if a request never completes.
- Engine `TypeError` / `RangeError` messages are mapped to `invalid_request` and can be shown by the UI.

## Endpoints

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| GET | `/api/chords/qualities` | — | `{ qualities: ChordQuality[] }` |
| GET | `/api/chords?root=C%23&quality=minor` | Query: `root`, `quality` | `BuiltChord` |
| POST | `/api/voicings/search` | `{ root, quality, options? }` | `VoicingSearchResult` |
| GET | `/api/fretboard?maxFret=15&tuning=40,45,50,55,59,64` | Query: `maxFret`, optional `tuning` (comma-separated MIDI) | `{ tuning, maxFret, positions }` |
| POST | `/api/progressions/optimize` | `{ layers: ProgressionCandidateInput[][], options? }` | `ProgressionOptimizationResult` |
| POST | `/api/audio-analysis` | `multipart/form-data`: required `file`; optional `windowSeconds` (0.1–2.0); optional `options` JSON | `{ audio, chordAnalysis, chordSheet }` |

### Progression optimization

The client first obtains candidate voicings from `POST /api/voicings/search`, then submits one array of candidates per chord slot:

```ts
const candidateLayers = [firstChordSearch.results, secondChordSearch.results];
const response = await fetch("/api/progressions/optimize", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ layers: candidateLayers, options: { limit: 3 } }),
});
const ranked = await response.json();
```

Each candidate must be a complete `Voicing` returned by the search API or a wrapped candidate `{ voicing, chordConfidence?, candidateScore? }`. The endpoint returns ranked paths with transition costs and cumulative costs. It accepts 1–12 layers, up to 32 candidates per layer and 192 candidates total. The result count `options.limit` is capped at 20 on this route to keep request cost bounded. Unknown top-level or option fields are rejected with a 400.

For known progressions, send raw `Voicing` values. For audio-derived hypotheses, wrapped candidates may include a 0–1 `chordConfidence` and `candidateScore` (ranking signals, not calibrated probabilities).

### Audio analysis

The audio-analysis `options` form field accepts `chordCandidateLimit`, `voicingsPerChord`, `chordQualities`, `bassRootBonus`, `voicingSearchOptions`, and `progressionOptions`. Example:

```json
{
  "chordCandidateLimit": 3,
  "voicingsPerChord": 5,
  "voicingSearchOptions": { "maxFret": 15, "maxFretSpan": 4 },
  "progressionOptions": { "limit": 5 }
}
```

#### Request size and work limits

| Limit | Value | Enforced | Error |
| --- | --- | --- | --- |
| Request body | 26 MiB (25 MiB file + 1 MiB for multipart framing and fields) | A declared `Content-Length` over the limit is rejected before the body is read; otherwise the body is streamed through a byte counter and abandoned when it crosses the limit (covers chunked uploads and understated lengths) | 413 |
| Uploaded file | 25 MiB | After the bounded parse | 413 |
| Candidates per frame (`chordCandidateLimit × voicingsPerChord`) | ≤ 30 (default 3 × 5 = 15) | Before calling the worker | 400 |
| `progressionOptions.limit` for audio | 1–10 (default 5; the UI sends 3). The standalone `/api/progressions/optimize` keeps 1–20 | Before calling the worker | 400 |
| Analysis windows (frames) | ≤ 1,200 (for example 600 s at 0.5 s windows, or 120 s at 0.1 s) | After feature extraction, before voicing search | 413 |
| Optimizer work `frames² × candidatesPerFrame² × limit / 2` | ≤ 5 × 10⁸ | After feature extraction, before voicing search | 413 |

Rationale: the progression optimizer copies each partial path on every extension, so its cost grows
with frames² × candidates² × limit. Measured: 600 frames × 15 candidates × limit 3 ≈ 1.4 s;
1,200 × 15 × 3 ≈ 3.4 s; 1,200 × 30 × 10 ≈ 62 s. The budget keeps the worst accepted request at roughly
4–5 s, and keeps the UI defaults (3 × 5 candidates, 3 paths) valid at every UI window size for the
worker's full 600-second maximum. A backpointer-based optimizer would remove the frames² factor and
allow a larger budget; it is a follow-up rather than part of this fix. The limits are exported as
`AUDIO_ANALYSIS_LIMITS` from `@interactive-guitar-lab/audio-analysis`.

Deployment: the route bounds what it buffers itself, but a reverse proxy should also cap request
bodies (for example nginx `client_max_body_size 27m`) so that oversized uploads are refused before
they reach Node at all.

The endpoint calls the Python feature worker at `AUDIO_WORKER_URL` (defaults to `http://127.0.0.1:8010`). Start it from `services/audio-worker` after installing `requirements.txt`. The worker returns fixed-window chroma plus best-effort tempo/beat timestamps; chord and fingering candidates are generated by the shared TypeScript engine. Confidence values rank hypotheses; they are not calibrated probabilities.

The response includes `chordSheet` schema version `1.1`, a conservative timeline derived from `chordAnalysis.frameResults`. Consecutive windows are merged only when their top-ranked chord symbols match and their timestamps are contiguous. Each event contains `chordSymbol`, `root`, `quality`, start/end times, mean confidence/score, `sourceFrameIndexes`, and best-effort beat/bar positions when beat timestamps are available. Silent windows are listed in `skippedWindowIndexes` and break continuity. `refinementSuggestions` is a non-destructive review aid: it can flag a very short event between two matching neighboring chords, but does not change or remove that event. Confidence is not used as a calibrated probability or as an automatic edit decision. Beat/bar positions are provisional because the pipeline does not yet infer time signature, pickup bars, tempo changes, or full beat-grid quantization. Raw frame hypotheses remain unchanged.

## Frontend integration status

| Workspace | Endpoint(s) | Status |
| --- | --- | --- |
| Chord explorer | `GET /api/chords/qualities`, `GET /api/chords`, `POST /api/voicings/search`, `GET /api/fretboard` | Live |
| Progression builder | `GET /api/chords`, `POST /api/voicings/search`, `POST /api/progressions/optimize` | Live |
| Audio analysis | `POST /api/audio-analysis` (XHR for upload progress) | Live |

## Known limitations

1. **Chord identification remains heuristic.** A candidate with a bass-root match can still be bypassed by the progression optimizer when its estimated voicing-transition cost is higher. Treat results as ranked hypotheses, not guaranteed transcription. Weight changes should be supported by a multi-example regression set rather than one WAV.
2. **No harmonic-function or key-analysis endpoint yet.** The progression optimizer ranks playable voicing paths but does not label Roman numerals or infer a key.
3. **Finger/barre assignment is not included.** `Voicing` carries note/fret information, but no left-hand finger or barre assignment.
4. **Worker error detail is coarse.** `POST /api/audio-analysis` maps worker failures other than invalid input or too-large uploads to 502 `internal_error`, so the UI cannot distinguish a stopped worker from a failed analysis.
5. **Sparse voicing ranking still depends on constraints.** Restrict `minNotes`, fret span, and muted/open strings to match the player's intent; ranking scores are heuristic rather than a guarantee of playability.
6. **Structured validation errors are not yet exposed.** Responses have a code and message but no field path for form highlighting.
