"""Bridge from the benchmark to the production note-event code (the only worker import).

Detectors reuse the worker's own audio decoding (audio_io.decode_audio) and model adapter
(note_events.extract_note_events), so the benchmark measures exactly what the API would return.

* "heuristic": the current HeuristicNoteEventModel.
* "module:attribute": any object implementing the worker's NoteEventModel protocol (or a zero-arg
  factory returning one), e.g. a future CRNN adapter. It must be importable on sys.path.
* predictions directory: precomputed results, one `<recordingId>.json` per recording, in the
  worker's response format. Use this for models that run in a separate process or service.
"""
from __future__ import annotations

import importlib
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from .matching import Note

WORKER_DIR = Path(__file__).resolve().parents[2] / "services" / "audio-worker"


def _ensure_worker_importable() -> None:
    if str(WORKER_DIR) not in sys.path:
        sys.path.insert(0, str(WORKER_DIR))


@dataclass
class Detector:
    name: str
    version: str
    source: str
    calibrated: bool
    # Techniques the detector does not model; misses on notes tagged with them are labelled.
    unsupported_techniques: frozenset[str]
    predict: Callable[[str, Path], list[Note]] = field(repr=False)  # (recording id, audio path) -> predictions

    def describe(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "version": self.version,
            "source": self.source,
            "calibrated": self.calibrated,
            "unsupportedTechniques": sorted(self.unsupported_techniques),
        }


def _to_notes(events: list[dict[str, Any]]) -> list[Note]:
    _ensure_worker_importable()
    from note_events import NoteEvent  # Reuse the production validation for every prediction.

    notes = []
    for event in events:
        NoteEvent(
            pitch_midi=event["pitchMidi"], onset_seconds=event["onsetSeconds"], offset_seconds=event["offsetSeconds"],
            onset_confidence=event["onsetConfidence"], offset_confidence=event["offsetConfidence"],
            pitch_confidence=event["pitchConfidence"], source=event["source"],
        )
        notes.append(Note(pitch_midi=event["pitchMidi"], onset_seconds=event["onsetSeconds"], offset_seconds=event["offsetSeconds"]))
    return notes


def model_detector(model: Any) -> Detector:
    _ensure_worker_importable()
    from audio_io import decode_audio
    from note_events import GUITAR_TECHNIQUES, NoteEventModel, extract_note_events

    if not isinstance(model, NoteEventModel):
        raise TypeError("Detector model must implement the worker's NoteEventModel protocol.")
    supported = frozenset(getattr(model, "supported_techniques", ()))

    def predict(_recording_id: str, audio_path: Path) -> list[Note]:
        samples, sample_rate, _duration = decode_audio(audio_path.read_bytes())
        return _to_notes(extract_note_events(samples, sample_rate, model)["events"])

    return Detector(model.info.name, model.info.version, model.info.source, model.info.calibrated,
                    frozenset(GUITAR_TECHNIQUES) - supported, predict)


def predictions_detector(directory: Path, name: str = "precomputed", version: str = "unknown") -> Detector:
    """Read `<recordingId>.json` files (worker response or bare noteEvents object). All techniques are
    treated as unsupported unless the producing model is known; pass its name/version for the report."""
    _ensure_worker_importable()
    from note_events import GUITAR_TECHNIQUES

    directory = Path(directory)

    def predict(recording_id: str, _audio_path: Path) -> list[Note]:
        body = json.loads((directory / f"{recording_id}.json").read_text(encoding="utf-8"))
        analysis = body.get("noteEvents", body)
        return _to_notes(analysis["events"])

    return Detector(name, version, "model", False, frozenset(GUITAR_TECHNIQUES), predict)


def load_detector(spec: str) -> Detector:
    _ensure_worker_importable()
    if spec == "heuristic":
        from note_events import HeuristicNoteEventModel
        return model_detector(HeuristicNoteEventModel())
    if ":" in spec:
        module_name, attribute = spec.split(":", 1)
        target = getattr(importlib.import_module(module_name), attribute)
        # A class or zero-argument factory is called; an already-built model instance is used as is.
        model = target() if isinstance(target, type) or (callable(target) and not hasattr(target, "predict")) else target
        return model_detector(model)
    raise ValueError(f"Unknown detector {spec!r}; use 'heuristic' or 'module:attribute'.")
