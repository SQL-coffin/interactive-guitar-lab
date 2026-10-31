# Note-event evaluation and benchmarks

This directory benchmarks the note-event detection layer (`services/audio-worker/note_events`). It measures a detector against annotated guitar recordings, so the current heuristic baseline and future trained models (e.g. a guitar CRNN) are compared the same way.

> **Status:** the framework is in place, but **no real guitar recordings have been evaluated yet**. The only bundled dataset is `synthetic-smoke`: generated harmonic tones used to test the pipeline itself. Its numbers say nothing about real-world accuracy, and every report produced from it says so.

The code here is separate from production inference:

| Module | Purpose | Imports the worker? |
| --- | --- | --- |
| `guitar_eval/matching.py` | Deterministic one-to-one note matching | no |
| `guitar_eval/metrics.py` | Per-recording and aggregate metrics | no |
| `guitar_eval/datasets.py` | Manifest/annotation loading and validation, checksums | no |
| `guitar_eval/scenarios.py` | Benchmark scenarios and baseline vs. experimental capability | no |
| `guitar_eval/report.py` | Markdown report rendered from the JSON results | no |
| `guitar_eval/detectors.py` | Runs detectors through the worker's own `decode_audio` and `NoteEventModel` adapter | **yes** (only this module) |
| `guitar_eval/runner.py` | Dataset → detector → matching → metrics → JSON | via `detectors.py` |
| `guitar_eval/synthetic.py` | Deterministic synthetic smoke-test dataset | no |

There are no new dependencies. The framework uses the worker's existing requirements: numpy, soundfile, and librosa through the worker.

## Commands

Run these from `evaluation/`, after installing the worker requirements: `pip install -r ../services/audio-worker/requirements.txt -c ../services/audio-worker/constraints.txt`.

```bash
python -m pytest -v
```

```bash
python -m guitar_eval make-synthetic /tmp/synthetic-smoke
```

```bash
python -m guitar_eval validate /tmp/synthetic-smoke
```

```bash
python -m guitar_eval run /tmp/synthetic-smoke --output /tmp/benchmark
```

The last command writes `/tmp/benchmark/results.json` (machine-readable) and `/tmp/benchmark/report.md`.

The `run` command takes these options:

- `--split NAME` evaluates one split.
- `--detector heuristic` is the default; `--detector package.module:Attribute` uses any `NoteEventModel`.
- `--predictions DIR --detector-name NAME --detector-version V` evaluates precomputed outputs.
- `--onset-tolerance 0.05`, `--pitch-tolerance 0`, `--offset-ratio 0.2`, `--offset-min-tolerance 0.05`, `--open-ended-policy fail|ignore-offset|extend-to-audio-end` and `--min-reference-confidence 0.5` set the matching tolerances.

Exit codes: `0` success, `2` invalid dataset (each problem is listed). The benchmark has no pass/fail accuracy threshold.

CI (`.github/workflows/ci.yml`, Python job) runs the tests and a synthetic smoke benchmark. The smoke run checks only that the pipeline executes. Its report is attached to the run summary and uploaded as the `synthetic-benchmark-report` artifact.

## Dataset layout

```
<dataset>/
  dataset.json              # manifest: id, semantic version, licence, splits, recordings + metadata + checksums
  audio/<recording>.wav     # any format soundfile/librosa can decode; <= 600 s (the worker's limit)
  annotations/<recording>.json
```

- **Schemas:** `schemas/dataset-manifest.schema.json` and `schemas/annotation.schema.json`. Filled-in examples are in `datasets/examples/`. `guitar_eval/datasets.py` is the authoritative validator; tests keep the schema enums in sync with it.
- **Versioning:** every audio and annotation file has a SHA-256 in the manifest, and validation fails if a file changed without the manifest being updated. Bump `version` (semver) whenever audio, annotations or splits change. Every result records the dataset id, version and manifest SHA-256, so results are tied to exact data.
- **Splits:** a recording may belong to at most one split. Tune thresholds on a `dev` split, never on `test`.
- **Recording metadata:**
  - `source`: `real` or `synthetic`. Only `real` recordings count as real-world evidence.
  - `sampleRateHz` and `durationSeconds`: checked against the audio file.
  - `instrument`.
  - `tuning`: open-string MIDI notes, lowest string first.
  - `recordingMethod`: `di`, `processed`, `microphone`, `mixed` or `synthetic`.
  - `conditions`: noise level, environment, effects, notes.
  - `annotationSource`: method (`manual`, `semi-automatic`, `hexaphonic-pickup`, `midi-aligned` or `synthetic`), annotator, tool, notes.
- **Private recordings:** keep them under `evaluation/datasets/local/` (git-ignored). Commit only data you have the right to redistribute.

### Annotations

Each annotation file has `schemaVersion`, `recordingId`, `completeness` (`complete` or `partial`), optional `annotatedRegions`, and `notes`. Each note has these fields:

| Field | Required | Notes |
| --- | --- | --- |
| `pitchMidi` | yes | Integer 0–127 |
| `onsetSeconds` | yes | Absolute seconds from the start of the file |
| `offsetSeconds` | yes (may be `null`) | `null` when the end is unknown or not meaningful, such as natural decay or a note ringing past the end |
| `stringNumber` | no | 1 = lowest-pitched string. With `fret`, it must agree with `pitchMidi` under the recording's tuning |
| `fret` | no | 0–36 |
| `technique` | no | `slide-in`, `slide-out`, `bend`, `release`, `hammer-on`, `pull-off`, `vibrato`, `palm-mute`, `harmonic` (same vocabulary as the worker) |
| `annotationConfidence` | no | 0–1; notes below the run's threshold are optional |

**Imperfect annotations** are handled explicitly rather than assumed away:

- `completeness: "partial"` plus `annotatedRegions`: only those time ranges were annotated. Predictions with an onset outside every region (widened by the onset tolerance) are ignored and reported as `ignoredPredictions`, not counted as false positives.
- `annotationConfidence` below `--min-reference-confidence` (default 0.5; must be a finite value from 0.0 to 1.0 inclusive) marks a note as **optional**. Notes without `annotationConfidence` are always required:
  - Matching it is not a true positive, and missing it is not a miss.
  - A prediction it absorbs is not a false positive.
  - Required notes are matched first, so optional notes never steal their matches.
- `offsetSeconds: null` on a reference means its offset is not judged; it is matched on pitch and onset only.

## Scenarios

| Scenario | Capability | Main known limitation of the heuristic baseline |
| --- | --- | --- |
| `single-notes` | baseline | Pitches outside E2–E6 are never reported |
| `chromatic-scales` | baseline | Fast legato runs lose notes without a new attack |
| `repeated-notes` | baseline | Re-attacks under ~50 ms, or on low strings, can merge |
| `sustained-notes` | baseline | Notes ringing past the end get a null offset by design |
| `natural-decay` | baseline | Decay offsets are low-confidence; offset metrics expected to be weak |
| `polyphonic-chords` | baseline | ≤ 6 voices; octave doublings, semitone clusters and quiet tones missed |
| `arpeggios` | baseline | Ringing notes overlapping later attacks can split or merge |
| `slides` | experimental | Not modelled: arrival notes without an attack are usually missed |
| `hammer-ons-pull-offs` | experimental | Legato notes frequently missed |
| `strumming` | experimental | No strum grouping; staggered onsets and muted-string noise not modelled |
| `background-noise` | experimental | Noise produces spurious candidates |

### How scenario results are computed

Scenarios are **recording tags** (`scenarios` in the manifest), and annotations are not labelled per scenario. A recording with several tags, such as background noise plus single notes, therefore cannot be split into per-scenario parts. To keep scenario numbers honest:

| Result key | Contents | Read it as |
| --- | --- | --- |
| `summary.overall` | Every recording once, regardless of tags | The headline result |
| `summary.byScenario[s]` | Only recordings tagged with `s` **and nothing else** | Isolated accuracy for that scenario |
| `summary.mixedScenarioRecordings` | Every recording with more than one tag, with its tags | Never attributed to a single scenario |
| `summary.byScenarioTag[s]` | Every recording carrying tag `s`, mixed or not; includes `mixedRecordingIds` and `overlapsOtherScenarios` | Coverage only. Cohorts overlap, so this is **not** isolated accuracy |
| `summary.byCapability` | Partition into `baseline` (all tags baseline), `experimental` (all tags experimental) and `mixed` (spans both) | Rows sum exactly to `overall` |

The Markdown report shows isolated scenario rows. A scenario with no isolated recordings is shown as "no isolated recordings" rather than with borrowed numbers, and mixed recordings get their own table. Nothing is filtered out of the overall numbers. To get an isolated result for a scenario, record and tag dedicated takes for it.

Separately, each detector declares which annotated **techniques** it supports. The heuristic baseline supports none. The report gives recall per technique, and misses on unsupported techniques are labelled "unsupported" in the error lists. This identifies a known limitation rather than presenting it as an ordinary pitch-detection failure. Those misses still count in every total.

## Matching and metrics

**Matching** (`guitar_eval/matching.py`) is one-to-one: a prediction matches at most one reference and vice versa.

- **Pitch:** exact MIDI note by default (`--pitch-tolerance`).
- **Onset:** within ±50 ms (`--onset-tolerance`), inclusive.
- **Offset**, for onset+offset metrics: within `max(0.05 s, 0.2 × reference duration)`. This follows `mir_eval.transcription` conventions.
- **Open-ended predictions** (`offsetSeconds: null`): `fail` (default) never satisfies the offset criterion; `ignore-offset` skips the offset check; `extend-to-audio-end` treats the note as lasting to the end of the file.
- **Assignment:** a maximum-cardinality bipartite matching. Candidates are explored in a fixed order: references by (onset, pitch, offset), and predictions by (|onset error|, onset, pitch, offset). Results are deterministic and independent of input order.

**Metrics** (`guitar_eval/metrics.py`), reported per recording and, micro-averaged, overall, per isolated scenario, per scenario tag and per capability group (a macro F1 is also given):

- **Note precision, recall and F1**, in two modes: onset (pitch + onset) and onset+offset.
- **Pitch accuracy:** among notes whose onset was found, the share with the right pitch. Correct = pitch+onset matches. Wrong = leftover references and predictions matched on onset alone. Matching pitch first stops simultaneous chord notes from being paired arbitrarily. Octave errors are counted separately.
- **Onset and offset timing error** (ms, prediction − reference), from onset matches: count, mean absolute, median absolute, P95 absolute (nearest rank), max absolute, mean signed (bias). Offset errors use only pairs where both offsets are known.
- **False positive rate** (`falsePositiveRate`) = FP / all evaluated predictions. The denominator includes predictions absorbed by optional references, so this is *not* 1 − precision when optional references exist.
- **False discovery rate** (`falseDiscoveryRate`) = FP / (TP + FP) = 1 − precision, whenever precision is defined.
- **False positives per minute** (`falsePositivesPerMinute`) = FP / audio minutes.
- **Missed note rate** = FN / required references.
- **Unmatched references and predictions** are listed in full in `results.json`, and the first 20 per recording in `report.md`.
- **Undefined ratios** (0/0) are `null` / "n/a", never silently 0 or 1.

Results are deterministic: floats are rounded to 6 decimals, there are no timestamps, and keys are sorted. Two runs on the same data, detector and settings produce identical `results.json`.

## Evaluating real recordings

1. **Record.** Note the instrument, tuning, DI/processed/mic, effects and noise.
2. **Annotate.**
   - Use a tool such as Sonic Visualiser and check onsets at a zoom of 10 ms or finer.
   - Use `null` offsets for natural decay you can't place reliably.
   - Use `annotationConfidence` for notes you are unsure of.
   - Use `partial` with `annotatedRegions` when only part of the file is annotated.
   - Hexaphonic-pickup or MIDI-aligned annotations should say so in `annotationSource`.
3. **Write the manifest.** Compute checksums with `sha256sum`, choose scenarios and assign splits.
4. **Validate and run.** Use `python -m guitar_eval validate <dir>`, then `python -m guitar_eval run <dir> --split test --output results/<name>`.
5. **Report honestly.** State the dataset version, its size, how it was recorded and annotated, and that results only generalise as far as the data represents the playing in question.

Public datasets that could be converted, subject to their licences, include GuitarSet (hexaphonic annotations) and IDMT-SMT-Guitar. No converter is included yet.

## Comparing a future CRNN against the baseline

- **In-process model:** implement the worker's `NoteEventModel` protocol and run `--detector your_package.module:YourModel`. Add `supported_techniques` to the model to declare techniques it handles.
- **Out-of-process model** (e.g. a PyTorch service): export one worker-format response per recording to `<dir>/<recordingId>.json`, then run `--predictions <dir> --detector-name crnn --detector-version X`. Predictions are validated with the worker's `NoteEvent` contract.
- **Comparison:** run both detectors on the same dataset version, split and tolerances, then compare the `results.json` files. Use the same `dev` split for tuning and report on `test`.

## Known limitations of this framework

- **No real data yet.** No real annotated recordings are bundled or have been evaluated.
- **Tolerances shape the numbers.** Results are only comparable between runs with identical tolerances and dataset versions.
- **Confidences are unused.** Detector confidences play no part in matching, so there are no precision/recall curves yet.
- **Technique metrics are recall only.** Techniques are evaluated through per-technique recall; the detector's own technique predictions (the reserved `guitar` attributes) are not scored yet.
- **Synthetic data is idealised.** It has no string noise, pick attack variety, sympathetic resonance or amplifier character.
