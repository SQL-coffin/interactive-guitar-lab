"""Note-event domain model shared by every note-event model (heuristic now, trained later).

Conventions
-----------
* Timestamps are absolute seconds from the start of the decoded audio.
* ``offset_seconds`` is ``None`` when there is not enough evidence to place the end of a note
  (for example the note is still sounding when the recording ends). ``offset_confidence`` is
  ``None`` exactly when ``offset_seconds`` is ``None``.
* Confidence values are heuristic scores in [0, 1]. They are *not* calibrated probabilities
  unless the producing model's ``ModelInfo.calibrated`` flag says so.
* There is deliberately no MIDI ``velocity`` field: spectral level is not a measurement of
  guitar picking intensity, and guessing one would mislead consumers.
* ``guitar`` is reserved for future guitar-specific annotations (string/fret, slide, bend,
  hammer-on, pull-off, strum grouping). The baseline never emits it.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Literal, Sequence

NoteEventSource = Literal["heuristic", "model"]
NOTE_EVENT_SOURCES: tuple[str, ...] = ("heuristic", "model")
GUITAR_TECHNIQUES: tuple[str, ...] = (
    "slide-in", "slide-out", "bend", "release", "hammer-on", "pull-off", "vibrato", "palm-mute", "harmonic",
)
NOTE_EVENT_SCHEMA_VERSION = "1.0"


class NoteEventError(ValueError):
    """Raised when a note event (or a list of them) violates the domain contract."""


def _finite(name: str, value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise NoteEventError(f"{name} must be a finite number.")
    return float(value)


def _confidence(name: str, value: object) -> float:
    number = _finite(name, value)
    if not 0.0 <= number <= 1.0:
        raise NoteEventError(f"{name} must be between 0 and 1.")
    return number


@dataclass(frozen=True)
class GuitarNoteAttributes:
    """Reserved for future guitar-specific models. All fields optional; none are inferred yet."""

    string_number: int | None = None  # 1 = lowest-pitched string, matching the TS engine.
    fret: int | None = None
    techniques: tuple[str, ...] = ()
    strum_group_id: int | None = None

    def __post_init__(self) -> None:
        if self.string_number is not None and (isinstance(self.string_number, bool) or not isinstance(self.string_number, int) or not 1 <= self.string_number <= 12):
            raise NoteEventError("guitar.stringNumber must be an integer from 1 to 12.")
        if self.fret is not None and (isinstance(self.fret, bool) or not isinstance(self.fret, int) or not 0 <= self.fret <= 36):
            raise NoteEventError("guitar.fret must be an integer from 0 to 36.")
        if any(technique not in GUITAR_TECHNIQUES for technique in self.techniques):
            raise NoteEventError("guitar.techniques contains an unsupported technique.")
        if self.strum_group_id is not None and (isinstance(self.strum_group_id, bool) or not isinstance(self.strum_group_id, int) or self.strum_group_id < 0):
            raise NoteEventError("guitar.strumGroupId must be a non-negative integer.")

    def to_dict(self) -> dict[str, object]:
        result: dict[str, object] = {}
        if self.string_number is not None:
            result["stringNumber"] = self.string_number
        if self.fret is not None:
            result["fret"] = self.fret
        if self.techniques:
            result["techniques"] = list(self.techniques)
        if self.strum_group_id is not None:
            result["strumGroupId"] = self.strum_group_id
        return result


@dataclass(frozen=True)
class NoteEvent:
    pitch_midi: int
    onset_seconds: float
    offset_seconds: float | None
    onset_confidence: float
    offset_confidence: float | None
    pitch_confidence: float
    source: NoteEventSource
    guitar: GuitarNoteAttributes | None = field(default=None)

    def __post_init__(self) -> None:
        if isinstance(self.pitch_midi, bool) or not isinstance(self.pitch_midi, int) or not 0 <= self.pitch_midi <= 127:
            raise NoteEventError("pitchMidi must be an integer MIDI note from 0 to 127.")
        onset = _finite("onsetSeconds", self.onset_seconds)
        if onset < 0:
            raise NoteEventError("onsetSeconds must be non-negative.")
        _confidence("onsetConfidence", self.onset_confidence)
        _confidence("pitchConfidence", self.pitch_confidence)
        if (self.offset_seconds is None) != (self.offset_confidence is None):
            raise NoteEventError("offsetSeconds and offsetConfidence must both be null or both be set.")
        if self.offset_seconds is not None:
            offset = _finite("offsetSeconds", self.offset_seconds)
            if offset <= onset:
                raise NoteEventError("offsetSeconds must be greater than onsetSeconds.")
            _confidence("offsetConfidence", self.offset_confidence)
        if self.source not in NOTE_EVENT_SOURCES:
            raise NoteEventError("source must be 'heuristic' or 'model'.")
        if self.guitar is not None and not isinstance(self.guitar, GuitarNoteAttributes):
            raise NoteEventError("guitar must be GuitarNoteAttributes or None.")

    def to_dict(self) -> dict[str, object]:
        result: dict[str, object] = {
            "pitchMidi": self.pitch_midi,
            "onsetSeconds": round(self.onset_seconds, 4),
            "offsetSeconds": None if self.offset_seconds is None else round(self.offset_seconds, 4),
            "onsetConfidence": round(self.onset_confidence, 4),
            "offsetConfidence": None if self.offset_confidence is None else round(self.offset_confidence, 4),
            "pitchConfidence": round(self.pitch_confidence, 4),
            "source": self.source,
        }
        if self.guitar is not None:
            result["guitar"] = self.guitar.to_dict()
        return result


def sort_note_events(events: Sequence[NoteEvent]) -> list[NoteEvent]:
    """Deterministic order: onset time, then pitch. Overlapping notes are kept."""
    return sorted(events, key=lambda event: (event.onset_seconds, event.pitch_midi))


def validate_note_events(events: Sequence[NoteEvent], duration_seconds: float | None = None) -> None:
    """Check ordering and the audio bounds of an already-constructed event list."""
    previous: tuple[float, int] | None = None
    for index, event in enumerate(events):
        if not isinstance(event, NoteEvent):
            raise NoteEventError(f"Event {index} is not a NoteEvent.")
        key = (event.onset_seconds, event.pitch_midi)
        if previous is not None and key < previous:
            raise NoteEventError("Note events must be sorted by onset time.")
        previous = key
        if duration_seconds is not None:
            tolerance = 1e-3
            if event.onset_seconds > duration_seconds + tolerance or (
                event.offset_seconds is not None and event.offset_seconds > duration_seconds + tolerance
            ):
                raise NoteEventError(f"Event {index} lies outside the audio duration.")


@dataclass(frozen=True)
class ModelInfo:
    """Identifies the producer of an event list so results stay traceable across model swaps."""

    name: str
    version: str
    source: NoteEventSource
    calibrated: bool = False
    description: str = ""

    def to_dict(self) -> dict[str, object]:
        return {
            "name": self.name,
            "version": self.version,
            "source": self.source,
            "calibrated": self.calibrated,
        }
