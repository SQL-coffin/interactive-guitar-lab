"""Deterministic one-to-one matching of predicted notes to reference (ground-truth) notes.

Rules (all tolerances configurable through MatchConfig):

* Pitch: |pred.pitch - ref.pitch| <= pitch_tolerance_semitones (default 0, i.e. exact MIDI note).
* Onset: |pred.onset - ref.onset| <= onset_tolerance_seconds (default 0.05 s, inclusive).
* Offset (only when require_offset=True): |pred.offset - ref.offset| <= max(offset_min_tolerance_seconds,
  offset_ratio * reference duration), the convention used by mir_eval.transcription (0.05 s, 0.2).
  - A reference with an unknown offset (null) is judged on onset and pitch only.
  - A prediction with a null (open-ended) offset follows open_ended_prediction_policy:
    "fail" (default) never satisfies the offset criterion; "ignore-offset" skips it;
    "extend-to-audio-end" treats the note as lasting until the end of the audio.

Each prediction matches at most one reference and vice versa. Among all valid assignments the
matcher returns one with the maximum number of pairs (augmenting-path bipartite matching, as in
mir_eval), exploring candidates in a fixed order: references by (onset, pitch, offset) and, for each,
predictions by (|onset error|, onset, pitch, offset). Results do not depend on input order, apart
from exact duplicates, which are interchangeable.
"""
from __future__ import annotations

import math
from bisect import bisect_left, bisect_right
from collections import deque
from dataclasses import dataclass, field
from typing import Literal, Sequence

OpenEndedPolicy = Literal["fail", "ignore-offset", "extend-to-audio-end"]
OPEN_ENDED_POLICIES: tuple[str, ...] = ("fail", "ignore-offset", "extend-to-audio-end")
_EPSILON = 1e-9  # Keeps boundaries inclusive despite binary floating-point representation.


@dataclass(frozen=True)
class Note:
    pitch_midi: int
    onset_seconds: float
    offset_seconds: float | None = None
    technique: str | None = None
    annotation_confidence: float | None = None
    string_number: int | None = None
    fret: int | None = None


@dataclass(frozen=True)
class MatchConfig:
    onset_tolerance_seconds: float = 0.05
    pitch_tolerance_semitones: int = 0
    offset_ratio: float = 0.2
    offset_min_tolerance_seconds: float = 0.05
    open_ended_prediction_policy: OpenEndedPolicy = "fail"
    # Reference notes with annotationConfidence below this are "optional": matching them is not a
    # true positive, missing them is not a miss, and a prediction matched to one is not a false positive.
    min_reference_confidence: float = 0.5

    def __post_init__(self) -> None:
        for name in ("onset_tolerance_seconds", "offset_ratio", "offset_min_tolerance_seconds", "min_reference_confidence"):
            value = getattr(self, name)
            if not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
                raise ValueError(f"{name} must be a finite, non-negative number.")
        if not isinstance(self.pitch_tolerance_semitones, int) or self.pitch_tolerance_semitones < 0:
            raise ValueError("pitch_tolerance_semitones must be a non-negative integer.")
        if self.open_ended_prediction_policy not in OPEN_ENDED_POLICIES:
            raise ValueError(f"open_ended_prediction_policy must be one of {', '.join(OPEN_ENDED_POLICIES)}.")

    def to_dict(self) -> dict[str, object]:
        return {
            "onsetToleranceSeconds": self.onset_tolerance_seconds,
            "pitchToleranceSemitones": self.pitch_tolerance_semitones,
            "offsetRatio": self.offset_ratio,
            "offsetMinToleranceSeconds": self.offset_min_tolerance_seconds,
            "openEndedPredictionPolicy": self.open_ended_prediction_policy,
            "minReferenceConfidence": self.min_reference_confidence,
        }


@dataclass
class MatchResult:
    pairs: list[tuple[int, int]] = field(default_factory=list)  # (reference index, prediction index), sorted
    unmatched_references: list[int] = field(default_factory=list)
    unmatched_predictions: list[int] = field(default_factory=list)


def _sort_key(note: Note, index: int) -> tuple[float, int, float, int]:
    offset = math.inf if note.offset_seconds is None else note.offset_seconds
    return (note.onset_seconds, note.pitch_midi, offset, index)


def _offset_ok(reference: Note, prediction: Note, config: MatchConfig, audio_duration: float | None) -> bool:
    if reference.offset_seconds is None:
        return True
    predicted_offset = prediction.offset_seconds
    if predicted_offset is None:
        if config.open_ended_prediction_policy == "ignore-offset":
            return True
        if config.open_ended_prediction_policy == "fail":
            return False
        predicted_offset = audio_duration  # validated by match_notes
    tolerance = max(config.offset_min_tolerance_seconds, config.offset_ratio * (reference.offset_seconds - reference.onset_seconds))
    return abs(predicted_offset - reference.offset_seconds) <= tolerance + _EPSILON  # type: ignore[operator]


def match_notes(
    references: Sequence[Note],
    predictions: Sequence[Note],
    config: MatchConfig,
    *,
    require_offset: bool = False,
    ignore_pitch: bool = False,
    audio_duration_seconds: float | None = None,
    reference_subset: Sequence[int] | None = None,
    prediction_subset: Sequence[int] | None = None,
) -> MatchResult:
    """Match predictions to references. Optional subsets restrict which indices take part."""
    if (require_offset and config.open_ended_prediction_policy == "extend-to-audio-end"
            and audio_duration_seconds is None
            and any(note.offset_seconds is None for note in predictions)):
        raise ValueError("audio_duration_seconds is required for the extend-to-audio-end policy.")

    reference_ids = sorted(range(len(references)) if reference_subset is None else reference_subset,
                           key=lambda index: _sort_key(references[index], index))
    prediction_ids = sorted(range(len(predictions)) if prediction_subset is None else prediction_subset,
                            key=lambda index: _sort_key(predictions[index], index))
    prediction_onsets = [predictions[index].onset_seconds for index in prediction_ids]
    tolerance = config.onset_tolerance_seconds + _EPSILON

    candidates: dict[int, list[int]] = {}
    for reference_index in reference_ids:
        reference = references[reference_index]
        low = bisect_left(prediction_onsets, reference.onset_seconds - tolerance)
        high = bisect_right(prediction_onsets, reference.onset_seconds + tolerance)
        options = []
        for prediction_index in prediction_ids[low:high]:
            prediction = predictions[prediction_index]
            if not ignore_pitch and abs(prediction.pitch_midi - reference.pitch_midi) > config.pitch_tolerance_semitones:
                continue
            if require_offset and not _offset_ok(reference, prediction, config, audio_duration_seconds):
                continue
            options.append(prediction_index)
        options.sort(key=lambda index: (abs(predictions[index].onset_seconds - reference.onset_seconds), *_sort_key(predictions[index], index)))
        candidates[reference_index] = options

    matched_prediction: dict[int, int] = {}  # prediction -> reference
    matched_reference: dict[int, int] = {}   # reference -> prediction
    for start in reference_ids:
        if not candidates[start]:
            continue
        # Breadth-first search for an augmenting path; candidate order makes it deterministic.
        parent: dict[int, tuple[int, int | None]] = {}  # prediction -> (reference reached from, previous prediction)
        queue: deque[tuple[int, int | None]] = deque([(start, None)])
        seen_references = {start}
        free_prediction: int | None = None
        while queue and free_prediction is None:
            reference_index, via_prediction = queue.popleft()
            for prediction_index in candidates[reference_index]:
                if prediction_index in parent:
                    continue
                parent[prediction_index] = (reference_index, via_prediction)
                owner = matched_prediction.get(prediction_index)
                if owner is None:
                    free_prediction = prediction_index
                    break
                if owner not in seen_references:
                    seen_references.add(owner)
                    queue.append((owner, prediction_index))
        if free_prediction is None:
            continue
        prediction_index: int | None = free_prediction
        while prediction_index is not None:
            reference_index, previous = parent[prediction_index]
            matched_prediction[prediction_index] = reference_index
            matched_reference[reference_index] = prediction_index
            prediction_index = previous

    pairs = sorted((reference_index, prediction_index) for reference_index, prediction_index in matched_reference.items())
    return MatchResult(
        pairs=pairs,
        unmatched_references=sorted(index for index in reference_ids if index not in matched_reference),
        unmatched_predictions=sorted(index for index in prediction_ids if index not in matched_prediction),
    )
