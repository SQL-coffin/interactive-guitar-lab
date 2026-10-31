"""Model-agnostic decoding of frame/onset/offset activations into note events.

This mirrors the post-processing stage of onset/offset transcription systems such as
ByteDance's high-resolution piano transcription (Kong et al., 2021): separate frame, onset and
offset activation rolls are produced by a model, onsets are picked as local maxima of the onset
roll with sub-frame (parabolic) refinement, and each note is followed forward until an offset
peak, a drop in frame activation, or a new onset of the same pitch.

Both the heuristic baseline and any future trained network (e.g. a guitar CRNN) emit the same
``NoteActivations`` so that this decoder - and therefore the API contract - does not change when
the model does.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .events import NoteEvent, NoteEventError, NoteEventSource, sort_note_events

# Hard ceilings independent of model configuration. They bound response size and work.
MAX_NOTE_EVENTS = 10_000
MAX_NOTE_DURATION_SECONDS = 30.0


@dataclass(frozen=True)
class NoteActivations:
    """Per-frame activations in [0, 1], shaped (frames, pitches).

    ``frame``  - pitch is sounding.
    ``onset``  - a note of this pitch starts at this frame.
    ``offset`` - a note of this pitch ends at this frame; ``None`` when the model has no
                 offset head (offsets then come only from frame-activation drops).
    Frame ``t`` is centred on ``t / frames_per_second`` seconds.
    """

    frame: np.ndarray
    onset: np.ndarray
    offset: np.ndarray | None
    frames_per_second: float
    min_midi: int
    duration_seconds: float

    def __post_init__(self) -> None:
        if self.frame.ndim != 2 or self.onset.shape != self.frame.shape:
            raise NoteEventError("frame and onset activations must share a (frames, pitches) shape.")
        if self.offset is not None and self.offset.shape != self.frame.shape:
            raise NoteEventError("offset activations must match the frame activation shape.")
        if not math.isfinite(self.frames_per_second) or self.frames_per_second <= 0:
            raise NoteEventError("frames_per_second must be positive.")
        if not 0 <= self.min_midi <= 127 or self.min_midi + self.frame.shape[1] - 1 > 127:
            raise NoteEventError("Activation pitch range must stay within MIDI 0-127.")
        if not math.isfinite(self.duration_seconds) or self.duration_seconds < 0:
            raise NoteEventError("duration_seconds must be finite and non-negative.")
        for roll in (self.frame, self.onset, self.offset):
            if roll is not None and roll.size and (not np.all(np.isfinite(roll)) or roll.min() < 0 or roll.max() > 1):
                raise NoteEventError("Activations must be finite values in [0, 1].")


@dataclass(frozen=True)
class DecoderConfig:
    onset_threshold: float = 0.3
    frame_threshold: float = 0.25
    offset_threshold: float = 0.5
    # Frames after an onset peak in which frame activation must appear; otherwise the onset is
    # treated as a transient (pick noise, a different pitch's attack) and discarded.
    onset_lookahead_frames: int = 6
    # Onset peaks of one pitch closer than this are collapsed onto the strongest one.
    min_onset_separation_frames: int = 4
    min_note_seconds: float = 0.05
    # Same-pitch fragments separated by a tiny gap are merged unless the second has a clear onset.
    merge_gap_seconds: float = 0.03
    merge_max_onset_confidence: float = 0.5
    # A note ending only because frame activation fell (no offset peak) gets at most this
    # offset confidence: the time is where evidence ran out, not a detected release.
    decay_offset_confidence_cap: float = 0.35
    max_events: int = MAX_NOTE_EVENTS


@dataclass
class DecodedNotes:
    events: list[NoteEvent]
    truncated: bool


def _parabolic_shift(left: float, center: float, right: float) -> float:
    denominator = left - 2.0 * center + right
    if abs(denominator) < 1e-12:
        return 0.0
    return float(np.clip(0.5 * (left - right) / denominator, -0.5, 0.5))


def _onset_peaks(curve: np.ndarray, threshold: float, min_separation: int) -> list[int]:
    if curve.size == 0:
        return []
    padded = np.concatenate(([-1.0], curve, [-1.0]))
    is_peak = (curve >= threshold) & (curve >= padded[:-2]) & (curve > padded[2:])
    candidates = np.flatnonzero(is_peak)
    if candidates.size == 0:
        return []
    # Non-maximum suppression, strongest first, deterministic tie-break by frame.
    order = sorted(candidates.tolist(), key=lambda frame: (-float(curve[frame]), frame))
    kept: list[int] = []
    for frame in order:
        if all(abs(frame - other) >= min_separation for other in kept):
            kept.append(frame)
    return sorted(kept)


def decode_note_events(
    activations: NoteActivations,
    source: NoteEventSource,
    config: DecoderConfig | None = None,
) -> DecodedNotes:
    config = config or DecoderConfig()
    frame_roll = activations.frame
    onset_roll = activations.onset
    offset_roll = activations.offset
    frame_count, pitch_count = frame_roll.shape
    fps = activations.frames_per_second
    duration = activations.duration_seconds
    max_note_frames = int(MAX_NOTE_DURATION_SECONDS * fps)

    events: list[NoteEvent] = []
    for pitch_index in range(pitch_count):
        frames = frame_roll[:, pitch_index]
        onsets = onset_roll[:, pitch_index]
        offsets = None if offset_roll is None else offset_roll[:, pitch_index]
        peaks = _onset_peaks(onsets, config.onset_threshold, config.min_onset_separation_frames)
        pitch_events: list[NoteEvent] = []
        for peak_number, start in enumerate(peaks):
            lookahead_end = min(frame_count, start + config.onset_lookahead_frames + 1)
            if float(np.max(frames[start:lookahead_end])) < config.frame_threshold:
                continue
            next_onset = peaks[peak_number + 1] if peak_number + 1 < len(peaks) else frame_count
            limit = min(next_onset, frame_count, start + max_note_frames)
            # Frame activation may still be rising right after the onset; only a drop *after* it
            # has been reached counts as the note ending.
            reached = False
            end: int | None = None
            end_confidence: float | None = None
            end_shift = 0.0
            for frame in range(start + 1, limit):
                active = frames[frame] >= config.frame_threshold
                reached = reached or active
                if offsets is not None and frame - start >= 2 and offsets[frame] >= config.offset_threshold:
                    left = offsets[frame - 1]
                    right = offsets[frame + 1] if frame + 1 < frame_count else -1.0
                    if offsets[frame] >= left and offsets[frame] > right:
                        end = frame
                        end_confidence = float(offsets[frame])
                        end_shift = _parabolic_shift(float(left), float(offsets[frame]), float(right)) if right >= 0 else 0.0
                        break
                if reached and not active:
                    end = frame
                    nearby = 0.0 if offsets is None else float(np.max(offsets[max(start + 1, frame - 2):frame + 3]))
                    end_confidence = min(config.decay_offset_confidence_cap, nearby)
                    break
            if end is None:
                if limit == next_onset and next_onset < frame_count:
                    # Re-articulation of the same pitch: the previous note cannot outlast it.
                    end = next_onset
                    nearby = 0.0 if offsets is None else float(np.max(offsets[max(start + 1, end - 2):end + 1]))
                    end_confidence = min(config.decay_offset_confidence_cap, nearby)
                else:
                    # Still sounding at the end of the audio or at the duration cap:
                    # insufficient evidence for an offset.
                    end_confidence = None

            onset_shift = _parabolic_shift(
                float(onsets[start - 1]) if start > 0 else float(onsets[start]),
                float(onsets[start]),
                float(onsets[start + 1]) if start + 1 < frame_count else float(onsets[start]),
            )
            onset_seconds = float(np.clip((start + onset_shift) / fps, 0.0, duration))
            offset_seconds: float | None = None
            if end is not None and end_confidence is not None:
                offset_seconds = float(np.clip((end + end_shift) / fps, 0.0, duration))
                if offset_seconds - onset_seconds < config.min_note_seconds:
                    continue
            note_end_frame = end if end is not None else limit
            sustain = frames[start:max(start + 1, note_end_frame)]
            active_sustain = sustain[sustain >= config.frame_threshold]
            pitch_confidence = float(np.mean(active_sustain)) if active_sustain.size else float(np.max(sustain))
            pitch_events.append(NoteEvent(
                pitch_midi=activations.min_midi + pitch_index,
                onset_seconds=onset_seconds,
                offset_seconds=offset_seconds,
                onset_confidence=float(np.clip(onsets[start], 0.0, 1.0)),
                offset_confidence=None if offset_seconds is None else float(np.clip(end_confidence or 0.0, 0.0, 1.0)),
                pitch_confidence=float(np.clip(pitch_confidence, 0.0, 1.0)),
                source=source,
            ))
        events.extend(_merge_fragments(pitch_events, config))

    ordered = sort_note_events(events)
    truncated = len(ordered) > config.max_events
    return DecodedNotes(events=ordered[:config.max_events], truncated=truncated)


def _merge_fragments(events: list[NoteEvent], config: DecoderConfig) -> list[NoteEvent]:
    """Join same-pitch fragments split by a brief activation dip without a convincing re-onset."""
    merged: list[NoteEvent] = []
    for event in events:
        previous = merged[-1] if merged else None
        if (previous is not None
                and previous.offset_seconds is not None
                and event.onset_seconds - previous.offset_seconds <= config.merge_gap_seconds
                and event.onset_confidence < config.merge_max_onset_confidence):
            merged[-1] = NoteEvent(
                pitch_midi=previous.pitch_midi,
                onset_seconds=previous.onset_seconds,
                offset_seconds=event.offset_seconds,
                onset_confidence=previous.onset_confidence,
                offset_confidence=event.offset_confidence,
                pitch_confidence=min(previous.pitch_confidence, event.pitch_confidence),
                source=previous.source,
            )
            continue
        merged.append(event)
    return merged
