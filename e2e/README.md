# End-to-end integration harness

Exercises the real stack: Next.js UI and `/api` routes → shared `music-theory` and
`audio-analysis` packages → Python audio worker. Results are recorded in
[`docs/integration-testing.md`](../docs/integration-testing.md).

## 1. Start the stack

```bash
# Audio worker (once): create its virtualenv, then run it on 127.0.0.1:8010
cd services/audio-worker
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app:app --host 127.0.0.1 --port 8010
```

```bash
# Web app + API routes (from the repo root); AUDIO_WORKER_URL defaults to http://127.0.0.1:8010
npm install
npm run dev
```

The UI uses the HTTP adapter against same-origin `/api` by default.
`NEXT_PUBLIC_GUITAR_LAB_API_URL=local` switches to the in-process adapter for offline work
(audio analysis is unavailable in that mode).

## 2. Generate the reference audio

```bash
services/audio-worker/.venv/bin/python e2e/synth_progressions.py e2e/fixtures/out
```

Writes five deterministic progressions plus `manifest.json` with the expected chord per
2-second segment. These are synthesized additive-sine tones, **not guitar recordings**;
they test the pipeline and give repeatable accuracy numbers, not real-world accuracy.
Generated files are git-ignored.

## 3. Run the checks

```bash
# Chord accuracy through POST /api/audio-analysis (expected vs observed, per window)
node e2e/audio-accuracy.mjs e2e/fixtures/out http://localhost:3000
```

```bash
# Browser workflows (needs Playwright installed globally; not a project dependency)
node e2e/browser-workflows.cjs e2e/fixtures/out/pop-I-V-vi-IV-C.wav http://localhost:3000
```

```bash
# Analysis sessions and the analysis → progression workflow (real IndexedDB, real reloads)
node e2e/session-workflows.cjs e2e/fixtures/out/pop-I-V-vi-IV-C.wav http://localhost:3000
```

```bash
# Jianpu score view: meter, bars from downbeats (or the time-based fallback), melody edit → save → reload
node e2e/score-workflows.cjs e2e/fixtures/out/pop-I-V-vi-IV-C.wav http://localhost:3000
```

`audio-accuracy.mjs` reports accuracy misses without failing, and exits non-zero only if the
service fails. Set `CHORD_CONFIDENCE_WEIGHT` to compare optimizer weights through the existing API option.

`browser-workflows.cjs` exits non-zero if any check fails. It compares what the UI renders with
the response bodies captured from the network. A few steps stub a single response
(`page.route`) to reach empty and error states; they are labelled "injected" in its output.

A worker outage is checked by hand: stop the worker, then upload a file on `/audio`. Expect
HTTP 502 and an "audio analysis worker is unavailable" error, with no results shown.
