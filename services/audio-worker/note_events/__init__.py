"""Note-event detection layer: domain model, model adapter contract, decoder and baseline."""
from .adapter import NoteEventModel, default_note_event_model, extract_note_events
from .decoder import MAX_NOTE_EVENTS, DecodedNotes, DecoderConfig, NoteActivations, decode_note_events
from .events import (
    GUITAR_TECHNIQUES,
    NOTE_EVENT_SCHEMA_VERSION,
    GuitarNoteAttributes,
    ModelInfo,
    NoteEvent,
    NoteEventError,
    sort_note_events,
    validate_note_events,
)
from .heuristic import HeuristicNoteEventModel

__all__ = [
    "GUITAR_TECHNIQUES", "MAX_NOTE_EVENTS", "NOTE_EVENT_SCHEMA_VERSION", "DecodedNotes", "DecoderConfig",
    "GuitarNoteAttributes", "HeuristicNoteEventModel", "ModelInfo", "NoteActivations", "NoteEvent",
    "NoteEventError", "NoteEventModel", "decode_note_events", "default_note_event_model",
    "extract_note_events", "sort_note_events", "validate_note_events",
]
