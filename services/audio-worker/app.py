from __future__ import annotations

import io
import math
from typing import Annotated, Any, Literal

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
    time_signature_numerator: int | None = Field(default=None, alias="timeSignatureNumerator")
    time_signature_denominator: int | None = Field(default=None, alias="timeSignatureDenominator")
    meter_confidence: float | None = Field(default=None, alias="meterConfidence")
    bar_duration_seconds: float | None = Field(default=None, alias="barDurationSeconds")
    downbeat_times_seconds: list[float] = Field(default_factory=list, alias="downbeatTimesSeconds")


class ChromaResponse(ApiModel):
    schema_version: str = Field(default="1.0", alias="schemaVersion")
    filename: str
    duration_seconds: float = Field(alias="durationSeconds")
    sample_rate: int = Field(alias="sampleRate")
    window_seconds: float = Field(alias="windowSeconds")
    rhythm: RhythmEstimate
    windowing_mode: Literal["adaptive-beat-aligned", "beat-aligned", "fixed-window"] = Field(default="fixed-window", alias="windowingMode")
    window_strategy: Literal["manual", "auto"] = Field(default="manual", alias="windowStrategy")
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


def infer_meter_from_beat_strengths(
    beat_strengths: list[float],
) -> tuple[int | None, float | None, int | None]:
    """Conservatively infer simple-meter grouping (3/4 or 4/4) from beat accents.

    Returns (numerator, confidence, downbeat_phase). Uniform or short pulse trains are
    intentionally left unknown: tempo alone cannot determine a time signature.
    """
    values = np.asarray(beat_strengths, dtype=np.float64)
    if values.size < 12 or not np.all(np.isfinite(values)):
        return None, None, None

    spread = float(np.std(values))
    if spread < 1e-6:
        return None, None, None

    scored: list[tuple[float, int, int]] = []
    for beats_per_bar in (3, 4):
        paired = values[:-beats_per_bar]
        shifted = values[beats_per_bar:]
        if paired.size < 6 or float(np.std(paired)) < 1e-6 or float(np.std(shifted)) < 1e-6:
            periodicity = 0.0
        else:
            periodicity = float(np.corrcoef(paired, shifted)[0, 1])
            if not math.isfinite(periodicity):
                periodicity = 0.0
        periodicity = max(0.0, min(1.0, periodicity))

        best_phase_score = -1.0
        best_phase = 0
        for phase in range(beats_per_bar):
            downbeats = values[phase::beats_per_bar]
            mask = np.ones(values.size, dtype=bool)
            mask[phase::beats_per_bar] = False
            other_beats = values[mask]
            if downbeats.size < 3 or other_beats.size < 6:
                continue
            # Robustly scale accent prominence; no prominence means the phase is not reliable.
            prominence = float((np.mean(downbeats) - np.mean(other_beats)) / (spread + 1e-9))
            prominence = max(0.0, min(1.0, prominence / 1.5))
            phase_score = 0.65 * periodicity + 0.35 * prominence
            if phase_score > best_phase_score:
                best_phase_score = phase_score
                best_phase = phase
        if best_phase_score >= 0:
            scored.append((best_phase_score, beats_per_bar, best_phase))

    if not scored:
        return None, None, None
    scored.sort(reverse=True)
    best_score, best_meter, best_phase = scored[0]
    runner_up = scored[1][0] if len(scored) > 1 else 0.0
    margin = best_score - runner_up
    # Require both a useful score and separation from the competing meter. This is
    # deliberately conservative until the estimator is evaluated on labelled recordings.
    if best_score < 0.3 or margin < 0.12:
        return None, None, None
    confidence = min(0.85, max(0.0, 0.55 * best_score + 1.5 * margin))
    return best_meter, round(confidence, 3), best_phase


def build_analysis_intervals(
    duration_seconds: float,
    target_window_seconds: float,
    beat_times_seconds: list[float],
    time_signature_numerator: int | None,
    downbeat_times_seconds: list[float],
    *,
    allow_unknown_meter_grouping: bool = False,
) -> tuple[list[tuple[float, float]], str]:
    """Build a bounded feature grid aligned to detected beats when reliable.

    The requested window duration is a target, not a claim that musical events occur
    every N seconds. Grouping sizes divide a known simple bar where possible.
    """
    if len(beat_times_seconds) < 2:
        count = max(1, math.ceil(duration_seconds / target_window_seconds))
        return [
            (index * target_window_seconds, min(duration_seconds, (index + 1) * target_window_seconds))
            for index in range(count)
            if index * target_window_seconds < duration_seconds
        ], "fixed-window"

    beat_times = sorted(set(
        float(value) for value in beat_times_seconds
        if math.isfinite(value) and 0 <= value <= duration_seconds
    ))
    if len(beat_times) < 2:
        count = max(1, math.ceil(duration_seconds / target_window_seconds))
        return [
            (index * target_window_seconds, min(duration_seconds, (index + 1) * target_window_seconds))
            for index in range(count)
            if index * target_window_seconds < duration_seconds
        ], "fixed-window"

    beat_period = float(np.median(np.diff(beat_times)))
    if not math.isfinite(beat_period) or beat_period <= 0:
        count = max(1, math.ceil(duration_seconds / target_window_seconds))
        return [
            (index * target_window_seconds, min(duration_seconds, (index + 1) * target_window_seconds))
            for index in range(count)
            if index * target_window_seconds < duration_seconds
        ], "fixed-window"

    if time_signature_numerator == 3:
        grouping_options = [1, 3]
    elif time_signature_numerator == 4:
        grouping_options = [1, 2, 4]
    else:
        # Manual mode stays on single beats when meter is unknown. Auto mode may combine
        # at most two beats in stable regions; this is a tradeoff, not a guessed meter.
        grouping_options = [1, 2] if allow_unknown_meter_grouping else [1]

    viable: list[int] = []
    for group_beats in grouping_options:
        group_duration = beat_period * group_beats
        estimated_count = math.ceil(duration_seconds / group_duration) + 2
        if group_duration <= 2.0 and estimated_count <= 1200:
            viable.append(group_beats)

    if not viable:
        count = max(1, math.ceil(duration_seconds / target_window_seconds))
        return [
            (index * target_window_seconds, min(duration_seconds, (index + 1) * target_window_seconds))
            for index in range(count)
            if index * target_window_seconds < duration_seconds
        ], "fixed-window"

    # Tie-break toward shorter analysis spans so a window is less likely to straddle a chord change.
    group_beats = min(viable, key=lambda group: (abs(beat_period * group - target_window_seconds), group))
    anchor_index = 0
    if downbeat_times_seconds:
        first_downbeat = downbeat_times_seconds[0]
        anchor_index = min(range(len(beat_times)), key=lambda index: abs(beat_times[index] - first_downbeat))

    boundary_values = {0.0, duration_seconds}
    for index, beat_time in enumerate(beat_times):
        if (index - anchor_index) % group_beats == 0 and 0 < beat_time < duration_seconds:
            boundary_values.add(round(beat_time, 4))
    boundaries = sorted(boundary_values)
    intervals = [
        (start, end)
        for start, end in zip(boundaries, boundaries[1:])
        if end - start > 1e-4
    ]
    if not intervals or len(intervals) > 1200:
        count = max(1, math.ceil(duration_seconds / target_window_seconds))
        return [
            (index * target_window_seconds, min(duration_seconds, (index + 1) * target_window_seconds))
            for index in range(count)
            if index * target_window_seconds < duration_seconds
        ], "fixed-window"
    return intervals, "beat-aligned"



def build_adaptive_analysis_intervals(
    duration_seconds: float,
    beat_times_seconds: list[float],
    time_signature_numerator: int | None,
    downbeat_times_seconds: list[float],
    chroma: np.ndarray,
    frame_times_seconds: np.ndarray,
) -> tuple[list[tuple[float, float]], str]:
    """Use longer beat-aligned spans in stable passages and split at likely chord changes.

    A conservative chroma-novelty detector subdivides a coarse beat-aligned grid at
    likely chord changes. Known meter constrains grouping to supported bar subdivisions;
    unknown meter allows at most two beats per coarse span. Manual mode is untouched.
    """
    if len(beat_times_seconds) < 2:
        # No trustworthy pulse grid: avoid claiming musical alignment. A one-second
        # fallback is a predictable compromise for automatic mode.
        intervals, _ = build_analysis_intervals(
            duration_seconds, 1.0, [], time_signature_numerator, downbeat_times_seconds
        )
        return intervals, "fixed-window"

    beat_times = sorted(set(
        float(value) for value in beat_times_seconds
        if math.isfinite(value) and 0 <= value <= duration_seconds
    ))
    if len(beat_times) < 2:
        intervals, _ = build_analysis_intervals(
            duration_seconds, 1.0, [], time_signature_numerator, downbeat_times_seconds
        )
        return intervals, "fixed-window"

    # Start with the coarsest usable grid. Novelty can only subdivide it.
    base_intervals, base_mode = build_analysis_intervals(
        duration_seconds,
        2.0,
        beat_times,
        time_signature_numerator,
        downbeat_times_seconds,
        allow_unknown_meter_grouping=True,
    )
    if base_mode != "beat-aligned" or chroma.ndim != 2 or chroma.shape[1] != frame_times_seconds.size:
        return base_intervals, base_mode

    beat_vectors: list[np.ndarray] = []
    for start, end in zip(beat_times, beat_times[1:]):
        selected = (frame_times_seconds >= start) & (frame_times_seconds < end)
        if not np.any(selected):
            beat_vectors.append(np.zeros(chroma.shape[0], dtype=np.float64))
            continue
        vector = np.mean(chroma[:, selected], axis=1).astype(np.float64)
        norm = float(np.linalg.norm(vector))
        beat_vectors.append(vector / norm if norm > 1e-9 else vector)

    novelty: list[float] = []
    for left, right in zip(beat_vectors, beat_vectors[1:]):
        left_norm = float(np.linalg.norm(left))
        right_norm = float(np.linalg.norm(right))
        if left_norm <= 1e-9 or right_norm <= 1e-9:
            novelty.append(0.0)
        else:
            similarity = float(np.dot(left, right) / (left_norm * right_norm))
            novelty.append(max(0.0, min(1.0, 1.0 - similarity)))

    positive = np.asarray([value for value in novelty if value > 1e-6], dtype=np.float64)
    if positive.size == 0:
        return base_intervals, "adaptive-beat-aligned"

    median = float(np.median(positive))
    mad = float(np.median(np.abs(positive - median)))
    threshold = max(0.16, median + 2.0 * mad)
    change_times: set[float] = set()
    for index, value in enumerate(novelty, start=1):
        # Ignore a transition if it is only a small fluctuation. The fixed floor
        # prevents uniform noise from creating many tiny frames.
        if value >= threshold:
            change_times.add(round(beat_times[index], 4))

    if not change_times:
        return base_intervals, "adaptive-beat-aligned"

    boundaries = {0.0, duration_seconds}
    for start, end in base_intervals:
        boundaries.add(round(start, 4))
        boundaries.add(round(end, 4))
        boundaries.update(
            value for value in change_times if start + 1e-4 < value < end - 1e-4
        )
    ordered = sorted(value for value in boundaries if 0 <= value <= duration_seconds)
    intervals = [
        (start, end)
        for start, end in zip(ordered, ordered[1:])
        if end - start > 1e-4
    ]
    if not intervals or len(intervals) > 1200:
        return base_intervals, "adaptive-beat-aligned"
    return intervals, "adaptive-beat-aligned"


def extract_chroma_features(
    payload: bytes,
    filename: str = "audio-upload",
    window_seconds: float = 0.5,
    window_strategy: Literal["manual", "auto"] = "manual",
) -> dict[str, Any]:
    """Decode audio into chroma frames using either manual or adaptive windowing."""
    if not payload:
        raise AudioInputError("The uploaded audio file is empty.")
    if not 0.1 <= window_seconds <= 2.0 or not math.isfinite(window_seconds):
        raise AudioInputError("windowSeconds must be between 0.1 and 2.0.")
    if window_strategy not in ("manual", "auto"):
        raise AudioInputError("windowStrategy must be manual or auto.")

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

    time_signature_numerator: int | None = None
    time_signature_denominator: int | None = None
    meter_confidence: float | None = None
    bar_duration_seconds: float | None = None
    downbeat_times_seconds: list[float] = []
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
        onset_peak = float(np.max(onset_envelope)) if onset_envelope.size else 0.0
        onset_mean = float(np.mean(onset_envelope)) if onset_envelope.size else 0.0
        # librosa can return a plausible tempo for a perfectly sustained sine because of
        # spectral/phase fluctuations. Require distinct onset contrast before using beat
        # timestamps to change chroma frame boundaries.
        onset_peak_to_mean = onset_peak / max(onset_mean, 1e-9)
        has_reliable_onsets = (
            onset_envelope.size > 0
            and onset_peak > 1e-6
            and onset_peak_to_mean >= 6.0
        )
        if not has_reliable_onsets:
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

            beat_strengths: list[float] = []
            for frame in beat_frames:
                center = int(frame)
                left = max(0, center - 1)
                right = min(onset_envelope.size, center + 2)
                beat_strengths.append(float(np.max(onset_envelope[left:right])) if right > left else 0.0)
            numerator, confidence, downbeat_phase = infer_meter_from_beat_strengths(beat_strengths)
            if numerator is not None and downbeat_phase is not None:
                time_signature_numerator = numerator
                time_signature_denominator = 4
                meter_confidence = confidence
                measured_beat_period = float(np.median(np.diff(beat_times_seconds)))
                if math.isfinite(measured_beat_period) and measured_beat_period > 0:
                    bar_duration_seconds = round(measured_beat_period * numerator, 4)
                downbeat_times_seconds = beat_times_seconds[downbeat_phase::numerator]

                # Beat trackers can omit the very first one or two pulses, shifting the
                # first reported downbeat by part of a bar. Backfill earlier bar starts
                # from the first detected downbeat so the initial frames aren't oversized.
                if len(beat_times_seconds) >= 2 and downbeat_times_seconds:
                    beat_period = float(np.median(np.diff(beat_times_seconds)))
                    bar_duration = beat_period * numerator
                    if math.isfinite(beat_period) and beat_period > 0:
                        previous_downbeats: list[float] = []
                        candidate_downbeat = downbeat_times_seconds[0] - bar_duration
                        while candidate_downbeat >= 0:
                            previous_downbeats.insert(0, round(candidate_downbeat, 4))
                            candidate_downbeat -= bar_duration
                        if previous_downbeats:
                            downbeat_times_seconds = previous_downbeats + downbeat_times_seconds
                            original_beats = list(beat_times_seconds)
                            estimated_beats: list[float] = []
                            candidate_beat = previous_downbeats[0]
                            while candidate_beat < original_beats[0]:
                                nearest_distance = min(abs(candidate_beat - beat) for beat in original_beats)
                                if nearest_distance > max(0.08, beat_period * 0.2):
                                    estimated_beats.append(round(candidate_beat, 4))
                                candidate_beat += beat_period
                            beat_times_seconds = sorted(set(estimated_beats + original_beats))
    frame_times = librosa.frames_to_time(
        np.arange(chroma.shape[1]),
        sr=sample_rate,
        hop_length=HOP_LENGTH,
    )
    effective_window_seconds = window_seconds
    if window_strategy == "auto":
        # Auto ignores the manual target: it starts coarse, then uses chroma novelty
        # to split around likely chord changes while preserving beat alignment.
        analysis_intervals, windowing_mode = build_adaptive_analysis_intervals(
            duration_seconds,
            beat_times_seconds,
            time_signature_numerator,
            downbeat_times_seconds,
            chroma,
            frame_times,
        )
        effective_window_seconds = 2.0 if windowing_mode == "adaptive-beat-aligned" else 1.0
    else:
        analysis_intervals, windowing_mode = build_analysis_intervals(
            duration_seconds,
            window_seconds,
            beat_times_seconds,
            time_signature_numerator,
            downbeat_times_seconds,
        )

    # Raw STFT hops are aggregated into either beat-aligned windows or fixed fallback windows.
    # This bounds the response while avoiding arbitrary one-second cuts when beat tracking succeeds.
    frames: list[dict[str, Any]] = []
    safe_filename = filename.replace("\\", "/").rsplit("/", maxsplit=1)[-1] or "audio-upload"

    for start_seconds, end_seconds in analysis_intervals:
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
        "windowSeconds": effective_window_seconds,
        "windowingMode": windowing_mode,
        "windowStrategy": window_strategy,
        "rhythm": {
            "tempoBpm": tempo_bpm,
            "beatTimesSeconds": beat_times_seconds,
            "timeSignatureNumerator": time_signature_numerator,
            "timeSignatureDenominator": time_signature_denominator,
            "meterConfidence": meter_confidence,
            "barDurationSeconds": bar_duration_seconds,
            "downbeatTimesSeconds": downbeat_times_seconds,
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
    window_strategy: Annotated[Literal["manual", "auto"], Form(alias="windowStrategy")] = "manual",
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
            window_strategy,
        )
    except AudioInputError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
