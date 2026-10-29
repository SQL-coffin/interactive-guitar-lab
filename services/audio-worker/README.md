# Audio Worker

Local Python service for extracting chroma features from a clean instrument recording or a complete song mix. It does **not** decide chord names; chord inference and voicing optimization live in the TypeScript packages, avoiding duplicated theory rules.

## Setup (WSL/Linux)

Use Python 3.12+ (the current librosa release also lists Python 3.14 support), create a project-specific virtual environment, then install dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m unittest -v
uvicorn app:app --host 127.0.0.1 --port 8010
```

## Endpoints

- `GET /health`
- POST /v1/features/chroma uses multipart/form-data with file, optional windowSeconds (0.1–2.0; default 0.5), and optional windowStrategy (manual or auto; default manual).

Supported decoders depend on the installed libsndfile/audioread backend; WAV is the baseline test format. A maximum upload size of 25 MiB and duration of 600 seconds are enforced.

## Feature response

schemaVersion 1.0; each frame has startSeconds, endSeconds, and 12 normalized chroma values. In manual mode, windowSeconds is the target duration. In auto mode, the worker starts from a coarse target of up to two seconds (known meter) or at most two beats (unknown meter) and subdivides beat-aligned regions at sufficiently strong chroma-novelty boundaries; where beat tracking is unavailable, it falls back to one-second fixed windows. The response echoes windowStrategy; windowingMode is adaptive-beat-aligned, beat-aligned, or fixed-window. windowSeconds reports the nominal coarse target actually used (two seconds for adaptive beat-aligned analysis, one second for the no-beat fallback). Consumers should position frames using startSeconds/endSeconds, not by multiplying the frame index by windowSeconds. The response includes a best-effort rhythm estimate with tempo, beat times, inferred meter, confidence, bar duration, and downbeats. The meter heuristic only distinguishes 3/4 from 4/4 and remains unknown when evidence is ambiguous; it does not detect 6/8, pickup bars, tempo changes, or subdivision-level chord changes.

Chroma is useful evidence but cannot reliably distinguish all inversions, bass notes, melody notes, or complex full-mix voicings. The ranking is intentionally exposed as candidates rather than a definitive transcription.
