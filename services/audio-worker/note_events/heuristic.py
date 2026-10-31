"""Heuristic (non-learned) note-event baseline.

What it does
------------
1. High-resolution constant-Q spectrogram (3 bins per semitone, E2-E6, ~11.6 ms hop),
   max-pooled to one magnitude per semitone so small tuning offsets do not split a pitch.
2. Candidate pitches per frame: spectral peaks along the pitch axis, gated by level relative
   to the loudest moment, with a crude harmonic-overtone penalty and a six-voice polyphony cap
   (a standard guitar cannot sound more than six strings at once).
3. Per-pitch onset activation: rise in that pitch's magnitude across the analysis filter length,
   lightly weighted by librosa's global onset-strength envelope.
4. Per-pitch offset activation: abrupt magnitude drop across the same span.

The resulting frame/onset/offset rolls go through the same decoder a trained model would use.

What it is not
--------------
This is not a transcription model. Onset strength (spectral flux) is a frame-level feature that
says "something changed here"; it does not identify which notes started. Pitch candidates come
from spectral peaks, so octave/harmonic confusions, missed notes in dense chords, missed legato
notes without a new attack (slides, hammer-ons, pull-offs, bends), and smeared timing for low
notes are all expected. Confidence values are heuristic scores, not probabilities.
"""
from __future__ import annotations


import math

import librosa
import numpy as np
from scipy.ndimage import maximum_filter1d

from .decoder import NoteActivations
from .events import ModelInfo

HOP_LENGTH = 256
BINS_PER_SEMITONE = 3
MIN_MIDI = 40  # E2, open low E in standard tuning.
MAX_MIDI = 88  # E6, 24th fret on the high E string.
MAX_POLYPHONY = 6
LEVEL_FLOOR_DB = -45.0  # Relative to the loudest semitone magnitude in the file.
LEVEL_FULL_DB = -10.0
NEIGHBOR_PROMINENCE_DB = 12.0
# Interval (semitones) from a fundamental to its 2nd..6th harmonics.
HARMONIC_INTERVALS = (12, 19, 24, 28, 31)
HARMONIC_PENALTY = 0.2
MIN_PEAK_AMPLITUDE = 1e-4  # -80 dBFS; quieter uploads are treated as silence.
MAX_HALF_SPAN_FRAMES = 24
# Long uploads are analysed in overlapping blocks so peak memory stays bounded (~tens of MB of
# spectrogram per block instead of the whole 600-second file at once). The margin exceeds the
# longest constant-Q filter (~0.63 s at E2) so block seams do not change the result.
BLOCK_SECONDS = 30.0
BLOCK_MARGIN_SECONDS = 1.5
# An abrupt release must drop this far (dB) across the filter span to count as an offset;
# ordinary exponential string decay drops far less over the same span.
OFFSET_SHARP_DROP_DB = 24.0


class HeuristicNoteEventModel:
    info = ModelInfo(
        name="heuristic-cqt-onset-baseline",
        version="0.1.0",
        source="heuristic",
        calibrated=False,
        description="Constant-Q pitch salience + onset-strength baseline. Not a trained transcription model.",
    )

    @property
    def pitch_range(self) -> tuple[int, int]:
        return MIN_MIDI, MAX_MIDI

    def predict(self, samples: np.ndarray, sample_rate: int) -> NoteActivations:
        pitch_count = MAX_MIDI - MIN_MIDI + 1
        frame_count = 1 + samples.size // HOP_LENGTH
        fps = sample_rate / HOP_LENGTH
        duration = float(samples.size / sample_rate)
        empty = np.zeros((frame_count, pitch_count), dtype=np.float32)
        if samples.size == 0 or float(np.max(np.abs(samples))) < MIN_PEAK_AMPLITUDE:
            return NoteActivations(empty, empty.copy(), empty.copy(), fps, MIN_MIDI, duration)

        semitones = _blockwise(samples, sample_rate, frame_count, semitone_magnitudes)  # (pitches, frames)
        peak = float(np.max(semitones))
        if peak <= 1e-12:
            empty = np.zeros((frame_count, pitch_count), dtype=np.float32)
            return NoteActivations(empty, empty.copy(), empty.copy(), fps, MIN_MIDI, duration)

        frame_roll = _frame_activation(semitones, peak)
        onset_roll, offset_roll = _onset_offset_activation(samples, sample_rate, semitones, peak, frame_roll)
        return NoteActivations(
            frame=frame_roll.T.astype(np.float32),
            onset=onset_roll.T.astype(np.float32),
            offset=offset_roll.T.astype(np.float32),
            frames_per_second=fps,
            min_midi=MIN_MIDI,
            duration_seconds=duration,
        )


def semitone_magnitudes(samples: np.ndarray, sample_rate: int) -> np.ndarray:
    """Constant-Q magnitudes, max-pooled to one row per semitone from MIN_MIDI to MAX_MIDI."""
    pitch_count = MAX_MIDI - MIN_MIDI + 1
    bins_per_octave = 12 * BINS_PER_SEMITONE
    # Start one bin below the lowest semitone centre so each triplet is centred on its note.
    fmin = float(librosa.midi_to_hz(MIN_MIDI)) * 2 ** (-1 / bins_per_octave)
    cqt = np.abs(librosa.cqt(
        samples,
        sr=sample_rate,
        hop_length=HOP_LENGTH,
        fmin=fmin,
        n_bins=pitch_count * BINS_PER_SEMITONE,
        bins_per_octave=bins_per_octave,
    )).astype(np.float32)
    return cqt.reshape(pitch_count, BINS_PER_SEMITONE, -1).max(axis=1)


def _onset_strength(samples: np.ndarray, sample_rate: int) -> np.ndarray:
    return librosa.onset.onset_strength(y=samples, sr=sample_rate, hop_length=HOP_LENGTH)[None, :]


def _blockwise(samples, sample_rate, frame_count, feature):
    """Apply a centred, hop-aligned feature (rows, frames) over overlapping blocks and stitch it."""
    block = int(BLOCK_SECONDS * sample_rate) // HOP_LENGTH * HOP_LENGTH
    margin = int(math.ceil(BLOCK_MARGIN_SECONDS * sample_rate / HOP_LENGTH)) * HOP_LENGTH
    if samples.size <= block + 2 * margin:
        result = feature(samples, sample_rate)
        return _fit_frames(result, frame_count)
    pieces = []
    for start in range(0, samples.size, block):
        left = max(0, start - margin)
        right = min(samples.size, start + block + margin)
        values = feature(samples[left:right], sample_rate)
        skip = (start - left) // HOP_LENGTH
        wanted = min(block, samples.size - start) // HOP_LENGTH
        pieces.append(values[:, skip:skip + wanted])
    return _fit_frames(np.concatenate(pieces, axis=1), frame_count)


def _fit_frames(values: np.ndarray, frame_count: int) -> np.ndarray:
    if values.shape[1] >= frame_count:
        return values[:, :frame_count]
    return np.pad(values, ((0, 0), (0, frame_count - values.shape[1])), mode="edge")


def _half_spans(sample_rate: int) -> np.ndarray:
    """Half the constant-Q filter length per semitone, in frames (bounded)."""
    q = 1.0 / (2 ** (1 / (12 * BINS_PER_SEMITONE)) - 1)
    frequencies = librosa.midi_to_hz(np.arange(MIN_MIDI, MAX_MIDI + 1))
    spans = np.round(q * sample_rate / frequencies / 2 / HOP_LENGTH)
    return np.clip(spans, 1, MAX_HALF_SPAN_FRAMES).astype(int)


def _frame_activation(semitones: np.ndarray, peak: float) -> np.ndarray:
    pitch_count, frame_count = semitones.shape
    db = 20.0 * np.log10(semitones / peak + 1e-10)
    level = np.clip((db - LEVEL_FLOOR_DB) / (LEVEL_FULL_DB - LEVEL_FLOOR_DB), 0.0, 1.0)

    lower = np.vstack([np.zeros((1, frame_count), dtype=semitones.dtype), semitones[:-1]])
    upper = np.vstack([semitones[1:], np.zeros((1, frame_count), dtype=semitones.dtype)])
    is_peak = (semitones >= lower) & (semitones >= upper)
    neighbor_db = 20.0 * np.log10(np.maximum(lower, upper) / peak + 1e-10)
    prominence = np.clip((db - neighbor_db) / NEIGHBOR_PROMINENCE_DB, 0.0, 1.0)

    activation = level * prominence * is_peak

    # Penalise a candidate that sits on a harmonic of a stronger, active lower candidate. This is
    # a coarse guard against overtones being reported as notes; it will also weaken genuine
    # octave doublings, which are common in guitar chords.
    harmonic_factor = np.ones_like(activation)
    for interval in HARMONIC_INTERVALS:
        if interval >= pitch_count:
            continue
        fundamental_active = activation[:-interval] > 0
        weaker = semitones[interval:] < semitones[:-interval]
        harmonic_factor[interval:] = np.where(
            fundamental_active & weaker,
            np.minimum(harmonic_factor[interval:], HARMONIC_PENALTY),
            harmonic_factor[interval:],
        )
    activation *= harmonic_factor

    if pitch_count > MAX_POLYPHONY:
        cutoff = np.partition(activation, pitch_count - MAX_POLYPHONY, axis=0)[pitch_count - MAX_POLYPHONY]
        activation = np.where(activation >= cutoff[None, :], activation, 0.0)
    return np.clip(activation, 0.0, 1.0)


def _onset_offset_activation(
    samples: np.ndarray,
    sample_rate: int,
    semitones: np.ndarray,
    peak: float,
    frame_roll: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """Return (onset, offset) rolls; also holds ``frame_roll`` steady in the end-padding region."""
    pitch_count, frame_count = semitones.shape
    floor = peak * 10 ** (LEVEL_FLOOR_DB / 20)
    spans = _half_spans(sample_rate)

    # Global spectral-flux onset strength: says *when* something changed, not *which* note.
    envelope = _blockwise(samples, sample_rate, frame_count, _onset_strength)[0]
    reference = float(np.percentile(envelope, 99)) if envelope.size else 0.0
    global_onset = np.clip(envelope / reference, 0.0, 1.0) if reference > 1e-9 else np.zeros(frame_count)
    global_onset = maximum_filter1d(global_onset, size=5, mode="nearest")
    onset_weight = 0.6 + 0.4 * global_onset

    onset_roll = np.zeros_like(semitones)
    offset_roll = np.zeros_like(semitones)
    for pitch_index in range(pitch_count):
        h = int(spans[pitch_index])
        magnitude = semitones[pitch_index]
        padded = np.pad(magnitude, (h, h), mode="constant")
        after = padded[2 * h:]
        before = padded[:frame_count]
        # Normalise by the strongest level around the transition so the activation peaks at the
        # centre of the constant-Q filter's symmetric smear, i.e. near the true onset/offset time.
        local_max = maximum_filter1d(padded, size=4 * h + 1, mode="constant")[h:h + frame_count]
        local_max = np.maximum(local_max, floor)
        rise = np.clip((after - before) / local_max, 0.0, 1.0)
        fall = np.clip((before - after) / local_max, 0.0, 1.0)
        rise[after < floor] = 0.0
        drop_db = 20.0 * np.log10(np.maximum(before, floor) / np.maximum(after, floor))
        fall *= np.clip(drop_db / OFFSET_SHARP_DROP_DB, 0.0, 1.0)
        fall[before < floor] = 0.0
        # Constant-Q filters are zero-padded past the end of the audio. Do not read that padding as
        # a release: hold the last fully-supported frame activation and suppress offsets, so a
        # note still sounding at the end is reported with an unknown offset.
        if frame_count > h + 1:
            fall[frame_count - h - 1:] = 0.0
            frame_roll[pitch_index, frame_count - h:] = frame_roll[pitch_index, frame_count - h - 1]
        onset_roll[pitch_index] = rise * onset_weight
        offset_roll[pitch_index] = fall
    return np.clip(onset_roll, 0.0, 1.0), np.clip(offset_roll, 0.0, 1.0)


