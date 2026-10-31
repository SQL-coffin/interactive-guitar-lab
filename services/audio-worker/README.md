# Audio Worker

Local Python service for extracting chroma features from a clean instrument recording or a complete song mix, plus an opt-in, heuristic **note-event** layer (candidate notes with onsets and offsets). It does **not** decide chord names; chord inference and voicing optimization live in the TypeScript packages, avoiding duplicated theory rules.

## Setup (WSL/Linux)

Use Python 3.12+ (the current librosa release also lists Python 3.14 support), create a project-specific virtual environment, then install dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m unittest -v   # runs test_app.py (chroma) and test_note_events.py (note events)
uvicorn app:app --host 127.0.0.1 --port 8010
```

## CI and contract fixtures

`.github/workflows/ci.yml` runs on pull requests to `main`:

- **`audio-worker`**: installs `requirements.txt` pinned by `constraints.txt` on Python 3.13, then runs `python -m pytest`, which covers `test_app.py`, `test_note_events.py` and `test_contract_fixtures.py`. It also writes fresh contract fixtures with `python contract_fixtures.py <dir>`.
- **`contract`**: feeds those freshly generated worker responses through the TypeScript runtime validators (`packages/audio-analysis/src/worker-contract.test.ts`).
- **`typescript`**: `npm ci`, `npm test`, `npm run typecheck`, `npm run build:web`.

`contracts/audio-worker/*.json` are committed copies of real worker responses for deterministic synthetic WAVs. `test_contract_fixtures.py` fails if they drift from current output. After an intentional contract change, regenerate them with `python contract_fixtures.py`. After changing `requirements.txt`, regenerate `constraints.txt` from a verified install with `pip freeze`. CI uses no network services, model downloads or secrets.

## Endpoints

- `GET /health`
- POST /v1/features/chroma uses multipart/form-data with file, optional windowSeconds (0.1–2.0; default 0.5), optional windowStrategy (manual or auto; default manual), and optional includeNoteEvents (default false). With includeNoteEvents=true the response gains a `noteEvents` object computed from the same decoded audio; without it the response is byte-for-byte what it was before this field existed.
- POST /v1/features/note-events uses multipart/form-data with file only. Returns `{ schemaVersion, filename, durationSeconds, sampleRate, noteEvents }`.

Supported decoders depend on the installed libsndfile/audioread backend; WAV is the baseline test format. A maximum upload size of 25 MiB and duration of 600 seconds are enforced.

## Feature response

schemaVersion 1.0; each frame has startSeconds, endSeconds, and 12 normalized chroma values. In manual mode, windowSeconds is the target duration. In auto mode, the worker starts from a coarse target of up to two seconds (known meter) or at most two beats (unknown meter) and subdivides beat-aligned regions at sufficiently strong chroma-novelty boundaries; where beat tracking is unavailable, it falls back to one-second fixed windows. The response echoes windowStrategy; windowingMode is adaptive-beat-aligned, beat-aligned, or fixed-window. windowSeconds reports the nominal coarse target actually used (two seconds for adaptive beat-aligned analysis, one second for the no-beat fallback). Consumers should position frames using startSeconds/endSeconds, not by multiplying the frame index by windowSeconds. The response includes a best-effort rhythm estimate with tempo, beat times, inferred meter, confidence, bar duration, and downbeats. The meter heuristic only distinguishes 3/4 from 4/4 and remains unknown when evidence is ambiguous; it does not detect 6/8, pickup bars, tempo changes, or subdivision-level chord changes.

Chroma is useful evidence but cannot reliably distinguish all inversions, bass notes, melody notes, or complex full-mix voicings. The ranking is intentionally exposed as candidates rather than a definitive transcription.

## Note-event detection (heuristic baseline)

Code layout (`note_events/`), kept separate from the chroma functions in `app.py`:

| Module | Role |
| --- | --- |
| `events.py` | `NoteEvent` domain model and validation (finite values, offset after onset, confidences in [0, 1], `offsetSeconds`/`offsetConfidence` both null or both set), sorting, reserved `GuitarNoteAttributes`. |
| `decoder.py` | Model-agnostic decoder: frame/onset/offset activation rolls -> note events. |
| `heuristic.py` | The current baseline model. Produces activation rolls from audio. |
| `adapter.py` | `NoteEventModel` protocol and `extract_note_events()`, which builds the `noteEvents` payload. |
| `../audio_io.py` | Decoding and limits shared with the chroma endpoint (25 MiB, 600 s, mono 22.05 kHz). |

`noteEvents` payload: `schemaVersion` "1.0", `model` (`name`, `version`, `source`, `calibrated`), `frameRateHz`, `pitchRangeMidi`, `truncated`, and `events`. Each event has `pitchMidi`, `onsetSeconds`, `offsetSeconds` (nullable), `onsetConfidence`, `offsetConfidence` (nullable), `pitchConfidence` and `source`. Events are sorted by onset then pitch; overlapping notes are kept. Timestamps are absolute seconds from the start of the audio. There is no velocity field: the spectral level of a guitar note is not a measurement of picking intensity.

### What the baseline does

1. **High-resolution spectrogram.** A constant-Q transform with 3 bins per semitone from E2 (MIDI 40) to E6 (MIDI 88), hop 256 samples (~11.6 ms), max-pooled to one value per semitone so small tuning offsets don't split a pitch.
2. **Candidate pitches.** Per frame, a semitone is a candidate if it is a spectral peak along the pitch axis, loud enough relative to the loudest point in the file (-45 dB floor), and prominent over its neighbours. A candidate sitting on the 2nd-6th harmonic of a stronger active lower candidate is penalised. At most six candidates per frame are kept (a guitar has six strings).
3. **Onset activation.** For each pitch, the rise in magnitude across that pitch's constant-Q filter length. Because the filter smears a step change symmetrically, the steepest rise is centred on the true attack. The rise is lightly weighted by librosa's global onset-strength envelope.
4. **Offset activation.** An abrupt drop (>= 24 dB across the filter span) for that pitch. Normal string decay drops much more slowly and does not count as a release.
5. **Decoding, merging and de-duplication** (`decoder.py`). Onsets are local maxima of the onset roll above a threshold, with non-maximum suppression and sub-frame parabolic refinement. Each note runs until an offset peak, a fall in frame activation, or the next onset of the same pitch. Same-pitch fragments split by a brief dip without a clear new attack are merged, and notes shorter than 50 ms are dropped.
6. **Explicit uncertainty.**
   - A note still sounding when the audio ends, or longer than 30 s, gets `offsetSeconds: null` and `offsetConfidence: null`. Constant-Q zero-padding at the end of the file is not mistaken for a release.
   - A note that ends only by fading below the detection floor gets an offset at the point where the evidence ran out, with confidence capped at 0.35.
   - A same-pitch re-attack ends the previous note at the new onset, with low confidence.
7. **Bounded work.** Audio is analysed in 30 s blocks with 1.5 s overlap, so the spectrogram is never held for the whole file at once. Results are capped at 10,000 events (`truncated: true` if the cap is hit). A synthetic 600 s worst case measured about 7 s and ~380 MB peak RSS in the development container, of which ~210 MB was library imports. Treat these numbers as indicative only.

### What it cannot reliably detect

This is **not** a guitar transcription model, and no accuracy claim is made for real recordings. Known failure modes:

- Notes without a new attack: slides, hammer-ons, pull-offs, bends, vibrato.
- Octave and overtone confusions. The harmonic penalty also suppresses genuine octave doublings, which are common in guitar chords.
- Two notes a semitone apart, and quiet chord tones next to loud ones (pitch-axis peak picking keeps only one).
- Timing for low notes. The constant-Q filter at E2 is ~0.6 s long, which blurs closely spaced attacks, and the offsets of fading low notes can land late by up to ~0.3 s.
- Strummed chords. Strings attacked a few ms apart may be reported as one onset or as staggered onsets; no strum grouping is inferred.
- Pitches outside E2-E6 (drop tunings, 7-string, bass).
- Dense full mixes. Drums, vocals and bass all create pitch and onset candidates.

**Onset strength vs. note onset.** `librosa.onset.onset_strength` measures frame-to-frame spectral increase (spectral flux) summed over all frequencies. A peak means "something changed here": a pick attack, a drum hit, a chord change or noise. It does not say which pitch started, or whether any note started at all. A *note onset* is a claim that a specific pitch began at a specific time. The baseline makes that claim only when a pitch-specific rise coincides with sustained pitch evidence, and uses onset strength only to weight its confidence. Monophonic pitch trackers such as pYIN are not used: they assume one pitch at a time and cannot represent chords.

**Testing.** `test_note_events.py` uses deterministic synthetic sine and harmonic tones. It covers silence, single, sequential and overlapping tones, onset tolerance (±30 ms) and offset tolerance (±50 ms) on sharp synthetic attacks, unknown offsets at end-of-audio, low-confidence offsets for decays, sorting, validation of invalid values, block-seam consistency, the model adapter, and the chroma-unchanged guarantee. These are unit tests of the contract and of idealised behaviour, **not** evidence of real-world accuracy. Real-recording evaluation is separate. The benchmark framework for it lives in `evaluation/` (see `evaluation/README.md`), but no real recordings have been evaluated yet. It should use labelled guitar recordings (for example GuitarSet or IDMT-SMT-Guitar, subject to their licences) and standard note-level metrics (`mir_eval.transcription`: onset-only F1 at 50 ms, and onset+offset F1), reported per playing style (single notes, arpeggios, strums, legato).

### Piano vs. guitar transcription, and the future CRNN

Concepts studied from ByteDance's *High-resolution Piano Transcription with Pedals by Regressing Onset and Offset Times* (Kong et al., [bytedance/piano_transcription](https://github.com/bytedance/piano_transcription)). No code or weights were copied, and its legacy requirements were not installed in this worker. Check the reference repository's licence before reusing any of its code.

- **Input.** Log-mel spectrogram: 16 kHz audio, 2048-sample window, 100 frames/s, 229 mel bins (`pytorch/models.py`, `Regress_onset_offset_frame_velocity_CRNN`).
- **Convolutional encoder.** Four conv blocks with 48, 64, 96 and 128 channels (each two 3x3 conv + BN + ReLU, pooling over frequency), then a 768-unit linear layer (`AcousticModelCRnn8Dropout`).
- **Temporal model.** A 2-layer bidirectional GRU with 256 hidden units per direction models context across frames.
- **Separate heads.** Four separate acoustic sub-models predict **frame** activity, **onset regression**, **offset regression** and velocity for 88 keys. The onset output is refined by a further BiGRU conditioned on velocity. The frame output is refined by a BiGRU conditioned on the onset and offset outputs.
- **Regression targets.** Instead of binary onset labels, the target is a triangle that decays with distance (in frames) from the exact onset/offset time.
- **Post-processing.** `RegressionPostProcessor` in `utils/utilities.py` peak-picks the onset/offset regression outputs above a threshold. It recovers a sub-frame shift from the peak and its neighbours, assuming an isosceles triangle, then follows the frame output to pair each onset with an offset.

This repository mirrors that *interface*. `NoteActivations` carries frame, onset and offset rolls, and `decoder.py` is the post-processing step. The heuristic baseline is just one producer of those rolls. The decoder uses parabolic peak refinement because the heuristic rolls are not triangle-shaped. When a model trained on triangle targets exists, the decoder's refinement step can switch to the triangle formula.

Why the piano checkpoint is not used for guitar:

- **Pitch and attack.** A piano note has a fixed pitch and a hammer attack. A guitar note can change pitch (bends, slides, vibrato) and can start without an attack (hammer-on, pull-off, slide).
- **Note identity.** A guitar pitch can be played on several strings. String and fret are part of what a guitarist needs, and maximum polyphony is six.
- **Strums and offsets.** Strums create staggered onsets. Guitar offsets come from fret-hand release or palm muting rather than damper/pedal behaviour.
- **Timbre.** Pickups, amplification and distortion produce harmonic spectra very different from a piano.
- **Training data and velocity.** The model was trained on MAESTRO piano, so loading its checkpoint would produce piano-biased output with no basis for trusting it on guitar. Its velocity head models piano key velocity and has no guitar analogue.

**Deferred integration plan.** Out of scope for this phase:

1. Train or fine-tune a guitar CRNN, such as a conv encoder + BiGRU with frame, onset-regression and offset-regression heads over MIDI 40-88, plus optional string/technique heads. Use licensed guitar datasets and keep a held-out real-recording test set.
2. Keep PyTorch out of this librosa worker if dependencies conflict. Either export to ONNX and run it with a CPU runtime, or run a separate model service that returns activation rolls.
3. Implement `NoteEventModel.predict()` for the CRNN, returning `NoteActivations` at the model's frame rate. Run chunked inference with overlap to keep memory bounded. Report `source: "model"`, and set `calibrated: true` only after confidence calibration on held-out data.
4. Select the model by configuration with the heuristic as fallback. The HTTP response, TypeScript validation and API contract do not change. Guitar-specific outputs go into the reserved `guitar` attributes (string, fret, techniques, strum group).
5. Gate any switch of the default model on the real-recording evaluation above.
