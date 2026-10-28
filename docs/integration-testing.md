# Integration test record

Run on 2026-10-28 against PR #4 (`claude/exciting-rubin-3aeebp`, stacked on PR #3 `863262d`).
Stack: Next.js dev and production servers, the audio worker on `127.0.0.1:8010`
(librosa 1.0.0, Python 3.13), and Chromium via Playwright. See [`e2e/README.md`](../e2e/README.md)
to reproduce.

## Workflows exercised in a real browser

`e2e/browser-workflows.cjs` ran 47/47 checks on two consecutive runs. It compares the rendered
UI with the API response bodies captured from the network.

| Workflow | What was checked | Endpoints observed |
| --- | --- | --- |
| Chord explorer | Dm7, F♯7 and B♭sus4: tone table equals `/api/chords`; voicing #1 and the result count equal `/api/voicings/search`; the fretboard shows every sounding note; root markers equal notes with degree 1; muted strings in the breakdown equal `null` strings; voicing comparison overlay. Injected empty result → empty state; injected malformed body → "unexpected response" error → retry recovers. | `GET /api/chords/qualities`, `GET /api/fretboard`, `GET /api/chords`, `POST /api/voicings/search` |
| Progression builder | Add, edit (G → G7), reorder and remove give G7–Am–Dm7–F; one search per chord; the `POST /api/progressions/optimize` body carries those 4×8 candidate layers and `{ limit: 3 }`; path totals, step chords, shapes and transition costs equal the response; path switching; out-of-date flag after a settings change. Injected 500 → error and no paths shown → retry recovers. 12 chords at "20 per chord" → HTTP 200 (see bug 1). | `GET /api/chords`, `POST /api/voicings/search`, `POST /api/progressions/optimize` |
| Audio analysis | Upload and analyzing states; HTTP 200 from the worker pipeline; duration, tempo and beat count equal the response; one timeline segment per frame; each window's candidate list and the path's chord equal the response; cancel returns to idle with no results; undecodable file → HTTP 400 with the worker's message and no results; worker stopped after a success → HTTP 502, and the previous results are cleared. | `POST /api/audio-analysis` |

## Bugs found and fixed

1. **The progression builder could send requests the optimize route rejects.** With 12 chords
   and "20 candidates per chord" the UI sent 240 candidates; the route allows 192 in total
   (HTTP 400). The UI now sizes each chord's search to fit the documented limits
   (`candidatesPerChord`, 16 per chord for 12 chords) and tells the user.
   Regression test: `apps/web/src/services/apiRoutes.integration.test.ts` drives the real HTTP
   adapter through the real route handlers. It fails with `240 > 192` when the clamp is removed.

2. **Cancelling an analysis didn't cancel the worker request** (fixed in PR #3, `93a323d`). The
   route never forwarded `request.signal`, so each browser cancel left the Next→worker request
   open until the 120 s timeout. Measured against a worker stub that never answers: 3 cancels left
   3 upstream connections open; after the fix all were closed within 5 s, both through the UI and
   with `curl -m 3`. Regression tests: `worker-client.test.ts` ("aborts the worker request…") and
   `apiRoutes.test.ts` ("cancels the worker request when the client disconnects").
3. **Server failures were not logged** (fixed in PR #3, `93a323d`). Worker outages (502) and
   unexpected 500s produced no server log line. They are now logged with the error message only,
   for example `[audio-analysis] worker failure (status none): Audio worker request failed: fetch failed`.
   The worker URL and environment values are never logged, and client cancels are not logged as
   outages. Regression test: `apiRoutes.test.ts` ("logs worker outages…").

## Round 2 checks (real HTTP and browser, production build at `56afd1d`)

| Check | Result |
| --- | --- |
| Independent theory check of `/api/chords` + `/api/voicings/search` (17 root spellings × 6 qualities): intervals, letter spelling, MIDI = tuning + fret, pitch class, degree, span, required tones | 102 chords, 1,020 voicings, 0 problems |
| Invalid chord, search and fretboard inputs | 8/8 return 400 with a specific message |
| `POST /api/progressions/optimize` boundaries: missing, empty or non-array layers, an empty candidate layer, 13 layers, 33 per layer, 193 total (192 accepted), malformed or mixed-length candidates, confidence above 1, unknown fields or options, limit 21, negative weight, non-JSON | 22/22 as expected, never a 500 |
| Browser: the real route's 400 (request rewritten to an empty layer) shown in the UI; aborted request → network error and **no paths** (proves there is no in-process fallback); recovery | Pass |
| Audio over HTTP: 26 MiB → 413; empty file, `.txt` file, bad `windowSeconds`, bad `options` → 400; dead worker → 502 in 0.04 s; hung worker → 502 after 120.0 s | Pass |
| Browser audio: malformed 200 → error with no results; 26 MiB blocked before upload (0 requests); `.txt` → worker 400; dead worker → 502 message; hung worker → analyzing + Cancel → 502 at 120.2 s | 13/13 |
| Logs: 11 secret-like environment values searched for in all server and worker logs | 0 occurrences |

## F♯m7 vs A: where the problem comes from

Fixture `A-F♯m7-D-E` (expected F♯m7 in windows 3–4, bass F♯):

- **Transport:** fine. The worker's raw frames match the API's windows, and an independent
  Python recomputation of the template scores gives the same ranking as the API in 8/8 windows.
- **Candidate generation:** fine. F♯m7 is present, ranked #2.
- **Scoring:** F♯m beats F♯m7 by 0.006–0.018. The seventh (E) has only 0.29–0.32 chroma energy
  against 1.00 for C♯, and equal-weight cosine templates favour the triad when the seventh is quiet.
- **Ambiguity:** partly genuine. F♯m7 contains F♯m entirely.
- **"A over F♯m7":** not reproduced. A fits these windows at only 0.59–0.64 and is outside the
  top 6, so the optimizer cannot choose it. The reported case needs audio where A is in the top 3.
  It needs that recording with ground-truth labels before any weight change is justified.

## Audio chord accuracy (synthesized reference set)

`e2e/audio-accuracy.mjs` sent five progressions through `POST /api/audio-analysis`. Each has
4 chords × 2 one-second windows, 40 windows in total. "Top" is the highest-scoring hypothesis
for a window on its own; "path" is the chord that the optimizer's best fingering path uses.

| Progression | Top correct | Path correct |
| --- | --- | --- |
| C – G – Am – F | 8/8 | 2/8 (CMaj7, GMaj7, **A** for Am, Am7) |
| A – F♯m7 – D – E | 5/8 (F♯m ×2, EMaj7) | 2/8 |
| Dm7 – G7 – CMaj7 – Am7 | 8/8 | 6/8 (Dm for Dm7) |
| Em – C – G – D | 7/8 (GMaj7) | 6/8 (GMaj7) |
| Dsus4 – D – Asus4 – A | 8/8 | 8/8 |
| **Total** | **36/40** | **24/40** |

Two separate, non-blocking limitations:

- **Inference near-ties (top hypothesis).** F♯m7 loses to F♯m (the triad is a subset of the
  seventh chord; the bass matches both). G and E lose to their major-seventh chords once each,
  because upper partials add energy at the seventh. All misses are within 0.02 of the expected
  chord, which ranks second. This is a chroma-template limitation, not an API or rendering bug.
- **The optimizer overrides correct hypotheses.** The path differs from a correct top hypothesis
  in 12 of 40 windows, including one quality flip (Am → A). This is how the earlier report
  "A chosen over a bass-supported F♯m7" arises. The chord-fit penalty is
  `(1 − candidateScore) × chordConfidenceWeight`, with a default weight of 20, so a 0.02 score
  gap costs 0.4, less than most shape changes.

Measured with the existing `progressionOptions.chordConfidenceWeight` option and no code change:

| `chordConfidenceWeight` | Path correct | Path = top | Quality flips |
| --- | --- | --- | --- |
| 20 (default) | 24/40 | 28/40 | 1 |
| 50 | 32/40 | 36/40 | 0 |
| 100 | 32/40 | 36/40 | 0 |
| 200 | 34/40 | 38/40 | 0 |

**The default has not been changed.** The evidence is consistent across five progressions, but
every sample is synthesized. Recommendation for the backend: confirm on a few real guitar
recordings, then consider raising the audio-analysis default to about 50. The UI already labels
scores as ranking scores (not probabilities) and says so whenever the path's chord differs
from the top hypothesis.

## Other observations

- Tempo is 30.05 BPM on every reference file. That equals the 2-second chord onsets, so it is
  consistent with the input and not an error.
- The worker does not distinguish "stopped" from "analysis failed"; both return the same 502
  (already listed in `docs/frontend-api-contract.md`).
