from __future__ import annotations

import io
import math
import unittest

import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient

from app import ChromaResponse, app, build_analysis_intervals, extract_chroma_features, infer_meter_from_beat_strengths


def make_wav(frequency_hz: float = 440.0, duration_seconds: float = 2.0) -> bytes:
    sample_rate = 22_050
    times = np.arange(int(sample_rate * duration_seconds), dtype=np.float32) / sample_rate
    samples = 0.5 * np.sin(2 * math.pi * frequency_hz * times)
    stream = io.BytesIO()
    sf.write(stream, samples, sample_rate, format="WAV")
    return stream.getvalue()


def make_click_track(bpm: int = 120, duration_seconds: float = 8.0) -> bytes:
    sample_rate = 22_050
    samples = np.zeros(int(sample_rate * duration_seconds), dtype=np.float32)
    pulse_length = 900
    pulse_time = np.arange(pulse_length, dtype=np.float32) / sample_rate
    pulse = 0.8 * np.sin(2 * math.pi * 1_800 * pulse_time) * np.exp(-pulse_time * 45)
    beat_period = 60.0 / bpm
    for beat_time in np.arange(0.25, duration_seconds, beat_period):
        start = int(beat_time * sample_rate)
        end = min(samples.size, start + pulse.size)
        samples[start:end] += pulse[:end - start]
    stream = io.BytesIO()
    sf.write(stream, np.clip(samples, -1.0, 1.0), sample_rate, format="WAV")
    return stream.getvalue()


def make_accented_click_track(
    beats_per_bar: int = 4,
    bpm: int = 120,
    duration_seconds: float = 12.0,
) -> bytes:
    """Generate labelled 3/4 or 4/4 click audio with a stronger downbeat."""
    sample_rate = 22_050
    samples = np.zeros(int(sample_rate * duration_seconds), dtype=np.float32)
    pulse_length = 1_100
    pulse_time = np.arange(pulse_length, dtype=np.float32) / sample_rate
    envelope = np.exp(-pulse_time * 42)
    beat_period = 60.0 / bpm
    for beat_index, beat_time in enumerate(np.arange(0.25, duration_seconds, beat_period)):
        amplitude = 0.95 if beat_index % beats_per_bar == 0 else 0.28
        pulse = amplitude * np.sin(2 * math.pi * 1_800 * pulse_time) * envelope
        start = int(beat_time * sample_rate)
        end = min(samples.size, start + pulse.size)
        samples[start:end] += pulse[:end - start]
    stream = io.BytesIO()
    sf.write(stream, np.clip(samples, -1.0, 1.0), sample_rate, format="WAV")
    return stream.getvalue()


def http_request(method: str, path: str, **kwargs: object):
    # TestClient manages the ASGI lifespan and worker-thread cleanup together.
    # Repeated asyncio.run() calls left AnyIO worker threads alive during Python 3.14 teardown.
    with TestClient(app) as client:
        request_method = getattr(client, method)
        return request_method(path, **kwargs)


class AudioWorkerTests(unittest.TestCase):
    def test_extracts_fixed_windows_and_twelve_chroma_bins(self) -> None:
        result = extract_chroma_features(make_wav(), "folder/demo.wav", window_seconds=0.5)
        self.assertEqual(result["filename"], "demo.wav")
        self.assertAlmostEqual(result["durationSeconds"], 2.0, places=2)
        self.assertEqual(len(result["frames"]), 4)
        for frame in result["frames"]:
            self.assertEqual(len(frame["chroma"]), 12)
            self.assertTrue(all(0.0 <= value <= 1.0 for value in frame["chroma"]))
        self.assertEqual(max(range(12), key=lambda pc: result["frames"][1]["chroma"][pc]), 9)

    def test_silence_returns_zero_chroma_and_no_tempo(self) -> None:
        result = extract_chroma_features(make_wav(frequency_hz=0.0), "silence.wav", window_seconds=1.0)
        self.assertTrue(all(value == 0.0 for value in result["frames"][0]["chroma"]))
        self.assertIsNone(result["rhythm"]["tempoBpm"])
        self.assertEqual(result["rhythm"]["beatTimesSeconds"], [])

    def test_estimates_tempo_for_a_synthetic_click_track(self) -> None:
        result = extract_chroma_features(make_click_track(), "click.wav", window_seconds=0.5)
        tempo = result["rhythm"]["tempoBpm"]
        self.assertIsNotNone(tempo)
        self.assertGreaterEqual(tempo, 40)
        self.assertLessEqual(tempo, 240)
        self.assertGreaterEqual(len(result["rhythm"]["beatTimesSeconds"]), 4)

    def test_infers_four_four_from_an_accented_wav_click_track(self) -> None:
        result = extract_chroma_features(make_accented_click_track(beats_per_bar=4), "four-four.wav", window_seconds=1.0)
        self.assertEqual(result["rhythm"]["timeSignatureNumerator"], 4, result["rhythm"])
        self.assertEqual(result["rhythm"]["timeSignatureDenominator"], 4)
        self.assertGreater(result["rhythm"]["meterConfidence"], 0.2)
        self.assertAlmostEqual(result["rhythm"]["barDurationSeconds"], 2.0, delta=0.15)
        self.assertGreaterEqual(len(result["rhythm"]["downbeatTimesSeconds"]), 2)
        self.assertAlmostEqual(result["rhythm"]["downbeatTimesSeconds"][0], 0.25, delta=0.12)
        self.assertEqual(result["windowingMode"], "beat-aligned")
        self.assertAlmostEqual(result["frames"][1]["endSeconds"] - result["frames"][1]["startSeconds"], 1.0, delta=0.12)
        for frame in result["frames"][1:]:
            self.assertTrue(any(abs(frame["startSeconds"] - beat) <= 0.02 for beat in result["rhythm"]["beatTimesSeconds"]))

    def test_infers_three_four_from_an_accented_wav_click_track(self) -> None:
        result = extract_chroma_features(make_accented_click_track(beats_per_bar=3), "three-four.wav", window_seconds=1.0)
        self.assertEqual(result["rhythm"]["timeSignatureNumerator"], 3, result["rhythm"])
        self.assertEqual(result["rhythm"]["timeSignatureDenominator"], 4)
        self.assertGreater(result["rhythm"]["meterConfidence"], 0.2)
        self.assertAlmostEqual(result["rhythm"]["barDurationSeconds"], 1.5, delta=0.15)
        self.assertGreaterEqual(len(result["rhythm"]["downbeatTimesSeconds"]), 2)
        self.assertAlmostEqual(result["rhythm"]["downbeatTimesSeconds"][0], 0.25, delta=0.12)
        self.assertEqual(result["windowingMode"], "beat-aligned")
        self.assertTrue(
            all(abs((frame["endSeconds"] - frame["startSeconds"]) - 0.5) < 0.06
                for frame in result["frames"][1:-1]),
            [(frame["startSeconds"], frame["endSeconds"]) for frame in result["frames"]],
        )

    def test_response_model_serializes_meter_and_actual_frame_boundaries(self) -> None:
        result = extract_chroma_features(
            make_accented_click_track(beats_per_bar=3),
            "three-four.wav",
            window_seconds=1.0,
        )
        payload = ChromaResponse.model_validate(result).model_dump(by_alias=True)
        self.assertEqual(payload["windowingMode"], "beat-aligned")
        self.assertEqual(payload["rhythm"]["timeSignatureNumerator"], 3)
        self.assertEqual(payload["rhythm"]["timeSignatureDenominator"], 4)
        self.assertAlmostEqual(payload["rhythm"]["barDurationSeconds"], 1.5, delta=0.15)
        self.assertGreaterEqual(len(payload["rhythm"]["downbeatTimesSeconds"]), 2)
        self.assertTrue(all(frame["endSeconds"] > frame["startSeconds"] for frame in payload["frames"]))

    def test_infers_four_four_from_repeating_four_beat_accent_pattern(self) -> None:
        strengths = [value for _ in range(6) for value in (1.0, 0.2, 0.55, 0.2)]
        numerator, confidence, phase = infer_meter_from_beat_strengths(strengths)
        self.assertEqual(numerator, 4)
        self.assertIsNotNone(confidence)
        self.assertGreater(confidence, 0.2)
        self.assertEqual(phase, 0)

    def test_infers_three_four_from_repeating_three_beat_accent_pattern(self) -> None:
        strengths = [value for _ in range(7) for value in (1.0, 0.25, 0.25)]
        numerator, confidence, phase = infer_meter_from_beat_strengths(strengths)
        self.assertEqual(numerator, 3)
        self.assertIsNotNone(confidence)
        self.assertGreater(confidence, 0.2)
        self.assertEqual(phase, 0)

    def test_leaves_meter_unknown_when_beats_have_no_accent_pattern(self) -> None:
        self.assertEqual(infer_meter_from_beat_strengths([1.0] * 20), (None, None, None))
        self.assertEqual(infer_meter_from_beat_strengths([1.0, 0.2, 0.5]), (None, None, None))

    def test_aligns_analysis_windows_to_beats_and_keeps_chord_windows_inside_bar_groups(self) -> None:
        beats = [i * 0.5 for i in range(9)]
        intervals, mode = build_analysis_intervals(4.0, 1.0, beats, 4, [0.0, 2.0])
        self.assertEqual(mode, "beat-aligned")
        self.assertEqual(intervals, [(0.0, 1.0), (1.0, 2.0), (2.0, 3.0), (3.0, 4.0)])

    def test_prefers_single_beats_when_two_or_three_beat_grouping_would_cross_three_four_bars(self) -> None:
        beats = [i * 0.5 for i in range(9)]
        intervals, mode = build_analysis_intervals(4.0, 1.0, beats, 3, [0.0, 1.5, 3.0])
        self.assertEqual(mode, "beat-aligned")
        self.assertEqual(intervals[:4], [(0.0, 0.5), (0.5, 1.0), (1.0, 1.5), (1.5, 2.0)])

    def test_keeps_unknown_meter_aligned_to_individual_beats(self) -> None:
        beats = [i * 0.5 for i in range(9)]
        intervals, mode = build_analysis_intervals(4.0, 1.0, beats, None, [])
        self.assertEqual(mode, "beat-aligned")
        self.assertTrue(all(abs((end - start) - 0.5) < 0.001 for start, end in intervals))

    def test_falls_back_to_fixed_windows_when_beats_are_unavailable(self) -> None:
        intervals, mode = build_analysis_intervals(2.0, 0.5, [], None, [])
        self.assertEqual(mode, "fixed-window")
        self.assertEqual(intervals, [(0.0, 0.5), (0.5, 1.0), (1.0, 1.5), (1.5, 2.0)])

    def test_extracts_low_register_bass_pitch_class(self) -> None:
        result = extract_chroma_features(make_wav(frequency_hz=92.5), "fsharp-bass.wav", window_seconds=0.5)
        self.assertTrue(all(frame["bassPitchClass"] == 6 for frame in result["frames"]), result["rhythm"] | {"mode": result["windowingMode"], "frames": [(frame["startSeconds"], frame["endSeconds"], frame["bassPitchClass"]) for frame in result["frames"]]})
        self.assertIsNone(result["rhythm"]["tempoBpm"])
        self.assertIsNone(result["rhythm"]["barDurationSeconds"])
        self.assertEqual(result["windowingMode"], "fixed-window")
        self.assertIn("timeSignatureNumerator", result["rhythm"])
        self.assertIn("downbeatTimesSeconds", result["rhythm"])

    def test_rejects_empty_payload_and_invalid_window(self) -> None:
        with self.assertRaises(ValueError):
            extract_chroma_features(b"")
        with self.assertRaises(ValueError):
            extract_chroma_features(make_wav(), window_seconds=0.05)

    def test_http_endpoint_accepts_audio_upload(self) -> None:
        response = http_request(
            "post",
            "/v1/features/chroma",
            files={"file": ("demo.wav", make_wav(), "audio/wav")},
            data={"windowSeconds": "0.5"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["schemaVersion"], "1.0")
        self.assertIn(payload["windowingMode"], ("beat-aligned", "fixed-window"))
        self.assertIn("timeSignatureNumerator", payload["rhythm"])
        self.assertIn("timeSignatureDenominator", payload["rhythm"])
        self.assertIn("meterConfidence", payload["rhythm"])
        self.assertIn("barDurationSeconds", payload["rhythm"])
        self.assertIn("downbeatTimesSeconds", payload["rhythm"])
        self.assertTrue(all(frame["endSeconds"] > frame["startSeconds"] for frame in payload["frames"]))
        self.assertEqual(len(payload["frames"]), 4)
        self.assertEqual(len(payload["frames"][0]["chroma"]), 12)

    def test_health_endpoint(self) -> None:
        response = http_request("get", "/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")


if __name__ == "__main__":
    unittest.main()
