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
- `POST /v1/features/chroma` using `multipart/form-data` with `file` and optional `windowSeconds` (0.1–2.0; default 0.5).

Supported decoders depend on the installed libsndfile/audioread backend; WAV is the baseline test format. A maximum upload size of 25 MiB and duration of 600 seconds are enforced.

## Feature response

`schemaVersion: "1.0"`; each frame has `startSeconds`, `endSeconds`, and 12 non-negative chroma values in pitch-class order C through B. Values are normalized per window to [0, 1]. The response also includes a best-effort `rhythm` estimate with `tempoBpm` (null when no stable estimate is available) and `beatTimesSeconds`. The TypeScript `@interactive-guitar-lab/audio-analysis` package turns chroma evidence into ranked chord candidates. Tempo/beat estimates are approximate and can be poor on rubato, syncopation, or sparse sustained sounds.

Chroma is useful evidence but cannot reliably distinguish all inversions, bass notes, melody notes, or complex full-mix voicings. The ranking is intentionally exposed as candidates rather than a definitive transcription.
