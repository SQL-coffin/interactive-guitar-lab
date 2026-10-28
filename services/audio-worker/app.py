from __future__ import annotations

import io
import math
from typing import Annotated, Any

import librosa
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field

SAMPLE_RATE = 22_050
HOP_LENGTH = 512
FFT_SIZE = 4_096
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_DURATION_SECONDS = 600.0
SUPPORTED_CHROMA_BINS = 12
MIN_BASS_HZ = 35.0
MAX_BASS_HZ = 250.0


class AudioInputError(ValueError):
    """Raised when an uploaded file cannot be decoded or exceeds supported limits."""


class ApiModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class ChromaFrame(ApiModel):
    start_seconds: float = Field(alias="startSeconds")
    end_seconds: float = Field(alias="endSeconds")
    # C, C#, D, D#, E, F, F#, G, G#, A, A#, B; normalized to [0, 1].
    chroma: list[float]
    bass_pitch_class: int | None = Field(alias="bassPitchClass")


class RhythmEstimate(ApiModel):
    tempo_bpm: float | None = Field(alias="tempoBpm")
    beat_times_seconds: list[float] = Field(alias="beatTimesSeconds")


class ChromaResponse(ApiModel):
    schema_version: str = Field(default="1.0", alias="schemaVersion")
    filename: str
    duration_seconds: float = Field(alias="durationSeconds")
    sample_rate: int = Field(alias="sampleRate")
    window_seconds: float = Field(alias="windowSeconds")
    rhythm: RhythmEstimate
    frames: list[ChromaFrame]


app = FastAPI(
    title="Interactive Guitar Lab Audio Worker",
    version="0.1.0",
    description="Extracts time-aligned chroma features; chord interpretation remains in TypeScript.",
)


def estimate_bass_pitch_class(
    samples: np.ndarray,
    sample_rate: int,
    start_seconds: float,
    end_seconds: float,
) -> int | None:
    """Estimate the strongest low-register pitch class within one analysis window."""
    start = max(0, int(start_seconds * sample_rate))
    end = min(samples.size, int(end_seconds * sample_rate))
    segment = samples[start:end]
    if segment.size < 512 or float(np.max(np.abs(segment))) <= 1e-8:
        return None

    spectrum = np.abs(librosa.stft(
        segment,
        n_fft=FFT_SIZE,
        hop_length=HOP_LENGTH,
        center=True,
    ))
    mean_magnitude = np.mean(spectrum, axis=1)
    frequencies = librosa.fft_frequencies(sr=sample_rate, n_fft=FFT_SIZE)
    band = np.flatnonzero((frequencies >= MIN_BASS_HZ) & (frequencies <= MAX_BASS_HZ))
    if band.size == 0:
        return None

    low_band_magnitudes = mean_magnitude[band]
    strongest_magnitude = float(np.max(low_band_magnitudes))
    overall_magnitude = float(np.max(mean_magnitude))
    if overall_magnitude <= 1e-8 or strongest_magnitude < overall_magnitude * 0.01:
        return None

    # Select the lowest meaningful spectral peak, not simply the loudest low-band peak.
    # A chord's third can be louder than its root, especially in bright guitar voicings.
    if low_band_magnitudes.size >= 3:
        local_maxima = np.flatnonzero(
            (low_band_magnitudes[1:-1] >= low_band_magnitudes[:-2])
            & (low_band_magnitudes[1:-1] >= low_band_magnitudes[2:])
        ) + 1
        meaningful_peaks = local_maxima[
            low_band_magnitudes[local_maxima] >= strongest_magnitude * 0.2
        ]
    else:
        meaningful_peaks = np.array([], dtype=int)
    selected_index = int(meaningful_peaks[0]) if meaningful_peaks.size else int(np.argmax(low_band_magnitudes))
    frequency = float(frequencies[band[selected_index]])
    if frequency <= 0:
        return None
    midi = int(round(69 + 12 * math.log2(frequency / 440.0)))
    return midi % 12


def extract_chroma_features(
    payload: bytes,
    filename: str = "audio-upload",
    window_seconds: float = 0.5,
) -> dict[str, Any]:
    """Decode audio and return bounded, fixed-window chroma feature vectors."""
    if not payload:
        raise AudioInputError("The uploaded audio file is empty.")
    if not 0.1 <= window_seconds <= 2.0 or not math.isfinite(window_seconds):
        raise AudioInputError("windowSeconds must be between 0.1 and 2.0.")

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

    is_silent = float(np.max(np.abs(samples))) <= 1e-8
    if is_silent:
        frame_count = max(1, math.ceil(samples.size / HOP_LENGTH))
        chroma = np.zeros((SUPPORTED_CHROMA_BINS, frame_count), dtype=np.float32)
        tempo_bpm: float | None = None
        beat_times_seconds: list[float] = []
    else:
        chroma = librosa.feature.chroma_stft(
            y=samples,
            sr=sample_rate,
            n_fft=FFT_SIZE,
            hop_length=HOP_LENGTH,
            tuning=None,
            n_chroma=SUPPORTED_CHROMA_BINS,
        )
        onset_envelope = librosa.onset.onset_strength(
            y=samples,
            sr=sample_rate,
            hop_length=HOP_LENGTH,
        )
        if onset_envelope.size == 0 or float(np.max(onset_envelope)) <= 1e-6:
            tempo_bpm = None
            beat_times_seconds = []
        else:
            tempo, beat_frames = librosa.beat.beat_track(
                onset_envelope=onset_envelope,
                sr=sample_rate,
                hop_length=HOP_LENGTH,
            )
            tempo_values = np.asarray(tempo).reshape(-1)
            estimate = float(tempo_values[0]) if tempo_values.size else 0.0
            beat_times_seconds = [
                round(float(value), 4)
                for value in librosa.frames_to_time(
                    beat_frames,
                    sr=sample_rate,
                    hop_length=HOP_LENGTH,
                )
                if 0 <= float(value) <= duration_seconds
            ]
            tempo_bpm = round(estimate, 2) if math.isfinite(estimate) and estimate > 0 and beat_times_seconds else None
    frame_times = librosa.frames_to_time(
        np.arange(chroma.shape[1]),
        sr=sample_rate,
        hop_length=HOP_LENGTH,
    )

    # Never return per-hop data directly: fixed windows keep API responses manageable
    # and align with the TypeScript ChromaFrame contract.
    window_count = max(1, math.ceil(duration_seconds / window_seconds))
    frames: list[dict[str, Any]] = []
    safe_filename = filename.replace("\\", "/").rsplit("/", maxsplit=1)[-1] or "audio-upload"

    for window_index in range(window_count):
        start_seconds = window_index * window_seconds
        end_seconds = min(duration_seconds, (window_index + 1) * window_seconds)
        selected = np.flatnonzero((frame_times >= start_seconds) & (frame_times < end_seconds))
        if selected.size == 0:
            center_seconds = (start_seconds + end_seconds) / 2
            selected = np.array([
                min(chroma.shape[1] - 1, max(0, int(round(center_seconds * sample_rate / HOP_LENGTH))))
            ])

        values = np.mean(chroma[:, selected], axis=1)
        peak = float(np.max(values)) if values.size else 0.0
        if peak > 0:
            values = values / peak

        frames.append({
            "startSeconds": round(start_seconds, 4),
            "endSeconds": round(end_seconds, 4),
            "chroma": [round(float(value), 6) for value in values],
            "bassPitchClass": estimate_bass_pitch_class(
                samples,
                sample_rate,
                start_seconds,
                end_seconds,
            ),
        })

    return {
        "schemaVersion": "1.0",
        "filename": safe_filename,
        "durationSeconds": round(duration_seconds, 4),
        "sampleRate": int(sample_rate),
        "windowSeconds": window_seconds,
        "rhythm": {
            "tempoBpm": tempo_bpm,
            "beatTimesSeconds": beat_times_seconds,
        },
        "frames": frames,
    }


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "audio-worker", "schemaVersion": "1.0"}


@app.post("/v1/features/chroma", response_model=ChromaResponse)
async def create_chroma_features(
    file: Annotated[UploadFile, File()],
    window_seconds: Annotated[float, Form(alias="windowSeconds", ge=0.1, le=2.0)] = 0.5,
) -> dict[str, Any]:
    payload = await file.read(MAX_UPLOAD_BYTES + 1)
    await file.close()
    if len(payload) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Uploaded file exceeds the 25 MiB limit.")

    try:
        return await run_in_threadpool(
            extract_chroma_features,
            payload,
            file.filename or "audio-upload",
            window_seconds,
        )
    except AudioInputError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
