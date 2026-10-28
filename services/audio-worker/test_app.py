from __future__ import annotations

import io
import math
import unittest

import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient

from app import app, extract_chroma_features


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

    def test_extracts_low_register_bass_pitch_class(self) -> None:
        result = extract_chroma_features(make_wav(frequency_hz=92.5), "fsharp-bass.wav", window_seconds=0.5)
        self.assertTrue(all(frame["bassPitchClass"] == 6 for frame in result["frames"]))

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
        self.assertEqual(len(payload["frames"]), 4)
        self.assertEqual(len(payload["frames"][0]["chroma"]), 12)

    def test_health_endpoint(self) -> None:
        response = http_request("get", "/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")


if __name__ == "__main__":
    unittest.main()
