"""Deterministic synthetic smoke-test dataset covering every benchmark scenario.

These recordings are additive-harmonic tones, NOT guitar recordings. They exist to exercise the
dataset format, validation, runner and report end to end, and to give repeatable numbers for
regression checks. They are labelled `source: synthetic` and the report says so; they must never be
presented as evidence of real-world accuracy.
"""
from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf

from .datasets import SCHEMA_VERSION, sha256_file

SAMPLE_RATE = 44_100
STANDARD_TUNING = [40, 45, 50, 55, 59, 64]
DATASET_ID = "synthetic-smoke"
DATASET_VERSION = "1.0.0"
HARMONICS = (1.0, 0.5, 0.3, 0.2, 0.1)


def _hz(midi: float) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


def _note(total: float, onset: float, offset: float | None, pitch_curve, *, decay: float = 1.5, level: float = 0.15) -> np.ndarray:
    """A plucked-string-like tone. pitch_curve(t) -> MIDI pitch (fractional allowed) for t >= onset."""
    times = np.arange(int(total * SAMPLE_RATE)) / SAMPLE_RATE
    out = np.zeros_like(times)
    start = int(onset * SAMPLE_RATE)
    end = len(times) if offset is None else min(len(times), int(offset * SAMPLE_RATE))
    local = times[start:end] - onset
    pitch = np.array([pitch_curve(t) for t in local]) if callable(pitch_curve) else np.full(local.size, float(pitch_curve))
    phase = 2 * math.pi * np.cumsum(_hz_array(pitch)) / SAMPLE_RATE
    wave = sum(weight * np.sin((index + 1) * phase) for index, weight in enumerate(HARMONICS))
    envelope = np.minimum(1.0, local / 0.004) * np.exp(-local / decay)
    if offset is not None:  # 10 ms release, as when a note is muted.
        envelope *= np.clip((offset - onset - local) / 0.01, 0.0, 1.0)
    out[start:end] = level * wave * envelope
    return out


def _hz_array(pitch: np.ndarray) -> np.ndarray:
    return 440.0 * 2 ** ((pitch - 69) / 12)


def _ref(pitch: int, onset: float, offset: float | None, **extra: Any) -> dict[str, Any]:
    return {"pitchMidi": pitch, "onsetSeconds": round(onset, 4), "offsetSeconds": None if offset is None else round(offset, 4), **extra}


def _recordings() -> list[dict[str, Any]]:
    recordings: list[dict[str, Any]] = []

    def add(rec_id, scenarios, total, parts, notes, *, noise="none", completeness="complete", regions=None, extra_audio=None):
        audio = sum(parts) if parts else np.zeros(int(total * SAMPLE_RATE))
        if extra_audio is not None:
            audio = audio + extra_audio
        recordings.append({"id": rec_id, "scenarios": scenarios, "total": total, "audio": audio, "notes": notes,
                           "noise": noise, "completeness": completeness, "regions": regions})

    t = 4.5
    singles = [(45, 0.3, 1.0, 2, 0), (52, 1.3, 2.0, 3, 2), (57, 2.3, 3.0, 4, 2), (64, 3.3, 4.0, 6, 0)]
    add("single-notes", ["single-notes"], t, [_note(t, on, off, p) for p, on, off, _s, _f in singles],
        [_ref(p, on, off, stringNumber=s, fret=f) for p, on, off, s, f in singles])

    t = 3.0
    chromatic = [(57 + i, 0.3 + 0.3 * i, 0.3 + 0.3 * i + 0.25) for i in range(8)]
    add("chromatic-scale", ["chromatic-scales"], t, [_note(t, on, off, p) for p, on, off in chromatic],
        [_ref(p, on, off) for p, on, off in chromatic])

    t = 2.5
    repeated = [(60, 0.3 + 0.3 * i, 0.3 + 0.3 * i + 0.25) for i in range(6)]
    add("repeated-notes", ["repeated-notes"], t, [_note(t, on, off, p) for p, on, off in repeated],
        [_ref(p, on, off) for p, on, off in repeated])

    t = 4.0
    add("sustained-notes", ["sustained-notes"], t,
        [_note(t, 0.2, 3.0, 55, decay=20.0), _note(t, 1.0, None, 62, decay=20.0)],
        [_ref(55, 0.2, 3.0), _ref(62, 1.0, None)])  # The second note rings past the end.

    t = 3.5
    add("natural-decay", ["natural-decay"], t, [_note(t, 0.3, None, 59, decay=0.35), _note(t, 1.8, None, 52, decay=0.35)],
        [_ref(59, 0.3, None), _ref(52, 1.8, None)])  # Decay end is not a well-defined event: offsets unannotated.

    t = 4.5
    e_minor = [40, 47, 52, 55, 59, 64]
    a_major = [45, 52, 57, 61, 64]
    add("chords", ["polyphonic-chords"], t,
        [_note(t, 0.3, 2.0, p, level=0.06) for p in e_minor] + [_note(t, 2.3, 4.0, p, level=0.06) for p in a_major],
        [_ref(p, 0.3, 2.0) for p in e_minor] + [_ref(p, 2.3, 4.0) for p in a_major])

    t = 3.5
    arpeggio = [48, 52, 55, 60, 64]
    add("arpeggio", ["arpeggios"], t, [_note(t, 0.3 + 0.3 * i, 3.0, p, level=0.08) for i, p in enumerate(arpeggio)],
        [_ref(p, 0.3 + 0.3 * i, 3.0) for i, p in enumerate(arpeggio)])

    t = 2.5
    slide = lambda x: 57.0 if x < 0.5 else (57.0 + 2.0 * (x - 0.5) / 0.1 if x < 0.6 else 59.0)  # noqa: E731
    add("slide", ["slides"], t, [_note(t, 0.3, 2.0, slide)],
        [_ref(57, 0.3, 0.8, stringNumber=4, fret=2), _ref(59, 0.9, 2.0, stringNumber=4, fret=4, technique="slide-in")])

    t = 2.5
    legato = lambda x: 60.0 if x < 0.5 else (62.0 if x < 1.0 else 60.0)  # noqa: E731
    add("hammer-on-pull-off", ["hammer-ons-pull-offs"], t, [_note(t, 0.3, 2.0, legato)],
        [_ref(60, 0.3, 0.8, stringNumber=3, fret=10), _ref(62, 0.8, 1.3, stringNumber=3, fret=12, technique="hammer-on"),
         _ref(60, 1.3, 2.0, stringNumber=3, fret=10, technique="pull-off")])

    t = 3.0
    strum = [40, 47, 52, 55, 59, 64]
    down = [(p, 0.3 + 0.012 * i) for i, p in enumerate(strum)]
    up = [(p, 1.6 + 0.012 * i) for i, p in enumerate(reversed(strum))]
    add("strumming", ["strumming", "polyphonic-chords"], t,
        [_note(t, on, 1.5, p, level=0.06) for p, on in down] + [_note(t, on, 2.8, p, level=0.06) for p, on in up],
        sorted([_ref(p, on, 1.5) for p, on in down] + [_ref(p, on, 2.8) for p, on in up], key=lambda n: (n["onsetSeconds"], n["pitchMidi"])))

    t = 4.0
    rng = np.random.default_rng(20261031)
    times = np.arange(int(t * SAMPLE_RATE)) / SAMPLE_RATE
    noise = 0.01 * rng.standard_normal(times.size) + 0.01 * np.sin(2 * math.pi * 60 * times)
    noisy = [(50, 0.3, 1.0), (57, 1.3, 2.0), (62, 2.3, 3.0)]
    # Partially annotated: only 0-3.2 s was checked; the note at 3.4 s is deliberately unannotated.
    # The middle note is marked uncertain (optional) to exercise annotationConfidence.
    add("noisy-room", ["background-noise", "single-notes"], t,
        [_note(t, on, off, p) for p, on, off in noisy] + [_note(t, 3.4, 3.9, 64)],
        [_ref(50, 0.3, 1.0), _ref(57, 1.3, 2.0, annotationConfidence=0.4), _ref(62, 2.3, 3.0)],
        noise="moderate", completeness="partial", regions=[[0.0, 3.2]], extra_audio=noise)
    return recordings


def write_synthetic_dataset(output: str | Path) -> Path:
    output = Path(output)
    (output / "audio").mkdir(parents=True, exist_ok=True)
    (output / "annotations").mkdir(parents=True, exist_ok=True)
    manifest_recordings = []
    for spec in _recordings():
        audio_path = output / "audio" / f"{spec['id']}.wav"
        sf.write(audio_path, np.clip(spec["audio"], -1.0, 1.0).astype(np.float32), SAMPLE_RATE, subtype="PCM_16")
        annotation: dict[str, Any] = {"schemaVersion": SCHEMA_VERSION, "recordingId": spec["id"],
                                      "completeness": spec["completeness"], "notes": spec["notes"]}
        if spec["regions"] is not None:
            annotation["annotatedRegions"] = spec["regions"]
        annotation_path = output / "annotations" / f"{spec['id']}.json"
        annotation_path.write_text(json.dumps(annotation, indent=2) + "\n", encoding="utf-8")
        manifest_recordings.append({
            "id": spec["id"],
            "audio": {"path": f"audio/{spec['id']}.wav", "sha256": sha256_file(audio_path)},
            "annotation": {"path": f"annotations/{spec['id']}.json", "sha256": sha256_file(annotation_path)},
            "scenarios": spec["scenarios"],
            "metadata": {
                "source": "synthetic",
                "sampleRateHz": SAMPLE_RATE,
                "durationSeconds": round(len(spec["audio"]) / SAMPLE_RATE, 4),
                "instrument": "synthetic",
                "tuning": {"name": "standard", "stringsMidi": STANDARD_TUNING},
                "recordingMethod": "synthetic",
                "conditions": {"environment": "generated", "noise": spec["noise"], "effects": [],
                               "notes": "Additive harmonic tones with exponential decay; not a guitar."},
                "annotationSource": {"method": "synthetic", "annotator": "guitar_eval.synthetic",
                                     "notes": "Exact generator parameters."},
            },
        })
    ids = [item["id"] for item in manifest_recordings]
    manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "datasetId": DATASET_ID,
        "version": DATASET_VERSION,
        "description": "Synthetic smoke-test dataset covering every benchmark scenario. Not guitar recordings.",
        "license": "CC0-1.0 (generated by guitar_eval.synthetic)",
        "splits": {"dev": ["single-notes"], "test": [i for i in ids if i != "single-notes"]},
        "recordings": manifest_recordings,
    }
    (output / "dataset.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return output
