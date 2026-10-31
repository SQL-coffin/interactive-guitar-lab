"""Shared audio decoding and request limits for every worker endpoint.

Chroma and note-event extraction must apply identical upload, decoding and duration rules,
so the logic lives here instead of being duplicated per endpoint.
"""
from __future__ import annotations

import io

import librosa
import numpy as np

SAMPLE_RATE = 22_050
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_DURATION_SECONDS = 600.0


class AudioInputError(ValueError):
    """Raised when an uploaded file cannot be decoded or exceeds supported limits."""


def decode_audio(payload: bytes) -> tuple[np.ndarray, int, float]:
    """Decode an upload to mono float samples at SAMPLE_RATE and enforce the duration limit.

    Returns (samples, sample_rate, duration_seconds).
    """
    if not payload:
        raise AudioInputError("The uploaded audio file is empty.")
    try:
        samples, sample_rate = librosa.load(
            io.BytesIO(payload),
            sr=SAMPLE_RATE,
            mono=True,
        )
    except Exception as exc:
        raise AudioInputError("Unable to decode audio. Try a WAV, FLAC, OGG, or MP3 file.") from exc

    if samples.size == 0:
        raise AudioInputError("No audio samples were found in the uploaded file.")

    duration_seconds = float(samples.shape[0] / sample_rate)
    if duration_seconds > MAX_DURATION_SECONDS:
        raise AudioInputError(f"Audio duration exceeds the {int(MAX_DURATION_SECONDS)}-second limit.")
    return samples, int(sample_rate), duration_seconds
