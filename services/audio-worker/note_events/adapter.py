"""Model adapter contract for note-event detection.

A note-event model turns decoded mono audio into ``NoteActivations`` (frame/onset/offset rolls).
The shared decoder converts activations into ``NoteEvent``s, and ``extract_note_events`` builds
the API payload. Replacing the heuristic baseline with a trained network (for example a guitar
CRNN following the ByteDance onset/offset regression design) means implementing ``predict`` -
the decoder, response schema and TypeScript client stay the same.

A model whose dependencies conflict with this worker (e.g. PyTorch) should run in its own
process/service; an adapter here would then call it and convert its rolls into NoteActivations.
"""
from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

import numpy as np

from .decoder import DecoderConfig, NoteActivations, decode_note_events
from .events import NOTE_EVENT_SCHEMA_VERSION, ModelInfo, NoteEventError, validate_note_events
from .heuristic import HeuristicNoteEventModel


@runtime_checkable
class NoteEventModel(Protocol):
    info: ModelInfo

    @property
    def pitch_range(self) -> tuple[int, int]: ...

    def predict(self, samples: np.ndarray, sample_rate: int) -> NoteActivations: ...


_DEFAULT_MODEL: NoteEventModel = HeuristicNoteEventModel()


def default_note_event_model() -> NoteEventModel:
    return _DEFAULT_MODEL


def extract_note_events(
    samples: np.ndarray,
    sample_rate: int,
    model: NoteEventModel | None = None,
    decoder_config: DecoderConfig | None = None,
) -> dict[str, Any]:
    """Run a note-event model on decoded audio and return the ``noteEvents`` payload."""
    model = model or _DEFAULT_MODEL
    duration = float(samples.size / sample_rate) if sample_rate > 0 else 0.0
    activations = model.predict(samples, sample_rate)
    if not isinstance(activations, NoteActivations):
        raise NoteEventError("Note-event model must return NoteActivations.")
    decoded = decode_note_events(activations, model.info.source, decoder_config)
    validate_note_events(decoded.events, duration)
    min_midi, max_midi = model.pitch_range
    return {
        "schemaVersion": NOTE_EVENT_SCHEMA_VERSION,
        "model": model.info.to_dict(),
        "frameRateHz": round(activations.frames_per_second, 4),
        "pitchRangeMidi": {"min": min_midi, "max": max_midi},
        "truncated": decoded.truncated,
        "events": [event.to_dict() for event in decoded.events],
    }
