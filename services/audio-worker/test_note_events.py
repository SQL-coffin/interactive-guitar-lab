"""Unit tests for the note-event detection layer.

These use deterministic synthetic WAV fixtures (pure or harmonic sine tones). They check the
contract and the baseline's behaviour on idealised input only; passing them is NOT evidence of
transcription accuracy on real guitar recordings. Real-recording evaluation is a separate,
manual process documented in README.md.
"""
from __future__ import annotations

import io
import math
import unittest
from dataclasses import replace
from unittest import mock

import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient

import note_events.heuristic as heuristic
from app import ChromaResponse, NoteEventResponse, app, extract_chroma_features, extract_note_event_features
from audio_io import AudioInputError, decode_audio
from note_events import (
    DecoderConfig,
    GuitarNoteAttributes,
    HeuristicNoteEventModel,
    ModelInfo,
    NoteActivations,
    NoteEvent,
    NoteEventError,
    NoteEventModel,
    decode_note_events,
    extract_note_events,
    sort_note_events,
    validate_note_events,
)

SAMPLE_RATE = 22_050
# Documented tolerance for synthetic, sharp-attack tones. Real recordings will be worse.
ONSET_TOLERANCE_SECONDS = 0.03
OFFSET_TOLERANCE_SECONDS = 0.05


def midi_hz(midi: int) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


def tone(
    midi: int,
    start: float,
    end: float,
    total: float,
    *,
    decay_seconds: float | None = None,
    harmonics: tuple[float, ...] = (1.0,),
    amplitude: float = 0.3,
) -> np.ndarray:
    """A sine (optionally with overtones) with a 5 ms attack and an abrupt end at `end`."""
    times = np.arange(int(total * SAMPLE_RATE)) / SAMPLE_RATE
    frequency = midi_hz(midi)
    wave = sum(weight * np.sin(2 * math.pi * frequency * (index + 1) * times) for index, weight in enumerate(harmonics))
    envelope = np.zeros_like(times)
    sounding = (times >= start) & (times < end)
    envelope[sounding] = np.minimum(1.0, (times[sounding] - start) / 0.005)
    if decay_seconds is not None:
        envelope[sounding] *= np.exp(-(times[sounding] - start) / decay_seconds)
    return (amplitude * wave * envelope).astype(np.float32)


def to_wav(samples: np.ndarray) -> bytes:
    stream = io.BytesIO()
    sf.write(stream, np.clip(samples, -1.0, 1.0), SAMPLE_RATE, format="WAV")
    return stream.getvalue()


def detect(samples: np.ndarray) -> list[dict[str, object]]:
    decoded, sample_rate, _ = decode_audio(to_wav(samples))
    return extract_note_events(decoded, sample_rate)["events"]


def event(**overrides: object) -> NoteEvent:
    values: dict[str, object] = {
        "pitch_midi": 60,
        "onset_seconds": 0.5,
        "offset_seconds": 1.0,
        "onset_confidence": 0.8,
        "offset_confidence": 0.6,
        "pitch_confidence": 0.9,
        "source": "heuristic",
    }
    values.update(overrides)
    return NoteEvent(**values)  # type: ignore[arg-type]


class SyntheticBaselineTests(unittest.TestCase):
    def test_silence_produces_no_events(self) -> None:
        self.assertEqual(detect(np.zeros(SAMPLE_RATE * 2, dtype=np.float32)), [])

    def test_inaudibly_quiet_noise_produces_no_events(self) -> None:
        noise = 1e-5 * np.random.default_rng(1).standard_normal(SAMPLE_RATE * 2).astype(np.float32)
        self.assertEqual(detect(noise), [])

    def test_one_sustained_tone_produces_one_event_with_accurate_onset_and_offset(self) -> None:
        events = detect(tone(69, 0.5, 2.0, 3.0))
        self.assertEqual(len(events), 1)
        only = events[0]
        self.assertEqual(only["pitchMidi"], 69)
        self.assertEqual(only["source"], "heuristic")
        self.assertLessEqual(abs(only["onsetSeconds"] - 0.5), ONSET_TOLERANCE_SECONDS)
        self.assertIsNotNone(only["offsetSeconds"])
        self.assertLessEqual(abs(only["offsetSeconds"] - 2.0), OFFSET_TOLERANCE_SECONDS)
        self.assertGreater(only["offsetConfidence"], 0.5)
        for key in ("onsetConfidence", "pitchConfidence", "offsetConfidence"):
            self.assertTrue(0.0 <= only[key] <= 1.0)

    def test_two_sequential_tones_produce_two_separated_events(self) -> None:
        events = detect(tone(57, 0.3, 1.2, 3.0) + tone(64, 1.5, 2.5, 3.0))
        self.assertEqual([item["pitchMidi"] for item in events], [57, 64])
        first, second = events
        self.assertLessEqual(abs(first["onsetSeconds"] - 0.3), ONSET_TOLERANCE_SECONDS)
        self.assertLessEqual(abs(second["onsetSeconds"] - 1.5), ONSET_TOLERANCE_SECONDS)
        self.assertLessEqual(first["offsetSeconds"], second["onsetSeconds"])

    def test_two_overlapping_tones_are_kept_as_overlapping_events(self) -> None:
        events = detect(tone(57, 0.2, 1.8, 3.0) + tone(64, 0.9, 2.6, 3.0))
        self.assertEqual([item["pitchMidi"] for item in events], [57, 64])
        lower, upper = events
        self.assertLessEqual(abs(lower["onsetSeconds"] - 0.2), ONSET_TOLERANCE_SECONDS)
        self.assertLessEqual(abs(upper["onsetSeconds"] - 0.9), ONSET_TOLERANCE_SECONDS)
        # The first note is still sounding when the second begins.
        self.assertGreater(lower["offsetSeconds"], upper["onsetSeconds"])
        self.assertLessEqual(abs(lower["offsetSeconds"] - 1.8), OFFSET_TOLERANCE_SECONDS)

    def test_note_still_sounding_at_the_end_has_no_offset(self) -> None:
        events = detect(tone(60, 0.5, 10.0, 3.0))
        self.assertEqual(len(events), 1)
        self.assertIsNone(events[0]["offsetSeconds"])
        self.assertIsNone(events[0]["offsetConfidence"])

    def test_gradual_decay_gets_a_low_confidence_offset_unlike_an_abrupt_stop(self) -> None:
        abrupt = detect(tone(60, 0.4, 1.4, 3.0))
        decaying = detect(tone(60, 0.4, 3.0, 3.0, decay_seconds=0.25))
        self.assertEqual(len(abrupt), 1)
        self.assertEqual(len(decaying), 1)
        self.assertGreater(abrupt[0]["offsetConfidence"], 0.5)
        self.assertIsNotNone(decaying[0]["offsetSeconds"])
        self.assertLessEqual(decaying[0]["offsetConfidence"], DecoderConfig().decay_offset_confidence_cap)
        self.assertLess(decaying[0]["offsetConfidence"], abrupt[0]["offsetConfidence"])

    def test_overtones_of_a_single_harmonic_tone_are_not_reported_as_notes(self) -> None:
        events = detect(tone(52, 0.4, 2.0, 3.0, harmonics=(1.0, 0.5, 0.3, 0.2)))
        self.assertEqual([item["pitchMidi"] for item in events], [52])

    def test_events_are_sorted_for_a_busy_synthetic_passage(self) -> None:
        samples = sum(
            tone(midi, start, start + 0.6, 4.0)
            for midi, start in ((64, 1.5), (55, 0.2), (60, 0.2), (67, 2.4), (52, 1.0))
        )
        events = detect(samples)
        keys = [(item["onsetSeconds"], item["pitchMidi"]) for item in events]
        self.assertEqual(keys, sorted(keys))
        self.assertEqual(len(events), 5)

    def test_blockwise_processing_matches_single_pass(self) -> None:
        samples = sum(tone(midi, start, start + 0.7, 6.0) for midi, start in ((57, 0.4), (64, 2.9), (60, 4.6)))
        whole = extract_note_events(samples, SAMPLE_RATE)["events"]
        with mock.patch.object(heuristic, "BLOCK_SECONDS", 2.0), mock.patch.object(heuristic, "BLOCK_MARGIN_SECONDS", 1.0):
            blocked = extract_note_events(samples, SAMPLE_RATE)["events"]
        self.assertEqual([item["pitchMidi"] for item in blocked], [item["pitchMidi"] for item in whole])
        for left, right in zip(whole, blocked):
            self.assertAlmostEqual(left["onsetSeconds"], right["onsetSeconds"], delta=0.01)


class NoteEventContractTests(unittest.TestCase):
    def test_rejects_non_finite_and_out_of_range_values(self) -> None:
        invalid = [
            {"onset_seconds": math.nan},
            {"onset_seconds": math.inf},
            {"onset_seconds": -0.1},
            {"offset_seconds": 0.4},
            {"offset_seconds": 0.5},
            {"offset_seconds": math.inf},
            {"onset_confidence": 1.2},
            {"pitch_confidence": -0.01},
            {"offset_confidence": math.nan},
            {"offset_confidence": None},
            {"offset_seconds": None},
            {"pitch_midi": 128},
            {"pitch_midi": 60.5},
            {"pitch_midi": True},
            {"source": "velocity"},
        ]
        for overrides in invalid:
            with self.subTest(overrides=overrides), self.assertRaises(NoteEventError):
                event(**overrides)

    def test_unknown_offset_is_allowed_when_both_offset_fields_are_null(self) -> None:
        unknown = event(offset_seconds=None, offset_confidence=None)
        self.assertIsNone(unknown.to_dict()["offsetSeconds"])

    def test_payload_has_no_velocity_field(self) -> None:
        self.assertNotIn("velocity", event().to_dict())

    def test_sorting_keeps_overlapping_events_and_validation_rejects_unsorted_lists(self) -> None:
        later = event(pitch_midi=64, onset_seconds=0.7, offset_seconds=1.5)
        earlier = event(pitch_midi=57, onset_seconds=0.2, offset_seconds=1.2)
        ordered = sort_note_events([later, earlier])
        self.assertEqual(ordered, [earlier, later])
        validate_note_events(ordered, duration_seconds=2.0)
        with self.assertRaises(NoteEventError):
            validate_note_events([later, earlier])
        with self.assertRaises(NoteEventError):
            validate_note_events(ordered, duration_seconds=1.0)

    def test_guitar_attributes_are_reserved_and_validated(self) -> None:
        annotated = event(guitar=GuitarNoteAttributes(string_number=1, fret=3, techniques=("hammer-on",)))
        self.assertEqual(annotated.to_dict()["guitar"], {"stringNumber": 1, "fret": 3, "techniques": ["hammer-on"]})
        with self.assertRaises(NoteEventError):
            GuitarNoteAttributes(techniques=("tapping-with-elbow",))
        with self.assertRaises(NoteEventError):
            GuitarNoteAttributes(fret=-1)


class FakeModel:
    """A stand-in for a future trained model: emits hand-written activation rolls."""

    info = ModelInfo(name="fake-crnn", version="test", source="model")
    pitch_range = (60, 61)

    def predict(self, samples: np.ndarray, sample_rate: int) -> NoteActivations:
        frames = np.zeros((100, 2), dtype=np.float32)
        onsets = np.zeros_like(frames)
        offsets = np.zeros_like(frames)
        frames[10:50, 0] = 0.9
        onsets[9:12, 0] = [0.4, 1.0, 0.4]
        offsets[49:52, 0] = [0.3, 0.9, 0.3]
        frames[30:100, 1] = 0.8
        onsets[30, 1] = 0.7
        return NoteActivations(frames, onsets, offsets, frames_per_second=100.0, min_midi=60, duration_seconds=1.0)


class ModelAdapterTests(unittest.TestCase):
    def test_a_replacement_model_plugs_into_the_same_decoder_and_payload(self) -> None:
        model = FakeModel()
        self.assertIsInstance(model, NoteEventModel)
        self.assertIsInstance(HeuristicNoteEventModel(), NoteEventModel)
        payload = extract_note_events(np.zeros(SAMPLE_RATE, dtype=np.float32), SAMPLE_RATE, model=model)
        self.assertEqual(payload["model"], {"name": "fake-crnn", "version": "test", "source": "model", "calibrated": False})
        first, second = payload["events"]
        self.assertEqual((first["pitchMidi"], first["onsetSeconds"], first["offsetSeconds"]), (60, 0.1, 0.5))
        self.assertEqual(first["source"], "model")
        self.assertEqual(second["pitchMidi"], 61)
        self.assertIsNone(second["offsetSeconds"])

    def test_decoder_rejects_invalid_activations(self) -> None:
        good = np.zeros((10, 2), dtype=np.float32)
        with self.assertRaises(NoteEventError):
            NoteActivations(good, np.full((10, 2), np.nan, dtype=np.float32), None, 100.0, 60, 0.1)
        with self.assertRaises(NoteEventError):
            NoteActivations(good, np.zeros((9, 2), dtype=np.float32), None, 100.0, 60, 0.1)
        with self.assertRaises(NoteEventError):
            NoteActivations(good, good, None, 100.0, 127, 0.1)

    def test_event_count_is_capped_and_reported_as_truncated(self) -> None:
        frames = np.zeros((400, 1), dtype=np.float32)
        onsets = np.zeros_like(frames)
        for start in range(0, 400, 20):
            frames[start:start + 10, 0] = 1.0
            onsets[start, 0] = 1.0
        activations = NoteActivations(frames, onsets, None, 100.0, 60, 4.0)
        decoded = decode_note_events(activations, "model", replace(DecoderConfig(), max_events=5))
        self.assertTrue(decoded.truncated)
        self.assertEqual(len(decoded.events), 5)
        self.assertEqual([round(item.onset_seconds, 2) for item in decoded.events], [0.0, 0.2, 0.4, 0.6, 0.8])


def http_post(path: str, **kwargs: object):
    with TestClient(app) as client:
        return client.post(path, **kwargs)


class NoteEventHttpTests(unittest.TestCase):
    def test_note_event_endpoint_returns_validated_events(self) -> None:
        response = http_post(
            "/v1/features/note-events",
            files={"file": ("dir/tone.wav", to_wav(tone(69, 0.5, 2.0, 3.0)), "audio/wav")},
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        NoteEventResponse.model_validate(payload)
        self.assertEqual(payload["filename"], "tone.wav")
        self.assertEqual(payload["noteEvents"]["model"]["source"], "heuristic")
        self.assertFalse(payload["noteEvents"]["model"]["calibrated"])
        self.assertEqual(payload["noteEvents"]["pitchRangeMidi"], {"min": 40, "max": 88})
        self.assertEqual([item["pitchMidi"] for item in payload["noteEvents"]["events"]], [69])
        self.assertEqual(set(payload["noteEvents"]["events"][0]), {
            "pitchMidi", "onsetSeconds", "offsetSeconds", "onsetConfidence", "offsetConfidence",
            "pitchConfidence", "source",
        })

    def test_note_event_endpoint_reuses_upload_and_decode_limits(self) -> None:
        empty = http_post("/v1/features/note-events", files={"file": ("a.wav", b"", "audio/wav")})
        self.assertEqual(empty.status_code, 400)
        garbage = http_post("/v1/features/note-events", files={"file": ("a.wav", b"not audio", "audio/wav")})
        self.assertEqual(garbage.status_code, 400)
        with mock.patch("app.MAX_UPLOAD_BYTES", 16):
            too_large = http_post("/v1/features/note-events", files={"file": ("a.wav", b"x" * 17, "audio/wav")})
        self.assertEqual(too_large.status_code, 413)
        with mock.patch("audio_io.MAX_DURATION_SECONDS", 1.0), self.assertRaises(AudioInputError):
            extract_note_event_features(to_wav(tone(69, 0.1, 1.5, 2.0)))

    def test_chroma_response_is_unchanged_unless_note_events_are_requested(self) -> None:
        wav = to_wav(tone(69, 0.2, 1.8, 2.0))
        default = http_post("/v1/features/chroma", files={"file": ("a.wav", wav, "audio/wav")})
        self.assertEqual(default.status_code, 200)
        payload = default.json()
        self.assertEqual(set(payload), {
            "schemaVersion", "filename", "durationSeconds", "sampleRate", "windowSeconds",
            "rhythm", "windowingMode", "windowStrategy", "frames",
        })
        self.assertEqual(payload, extract_chroma_features(wav, "a.wav"))

        combined = http_post(
            "/v1/features/chroma",
            files={"file": ("a.wav", wav, "audio/wav")},
            data={"includeNoteEvents": "true"},
        )
        self.assertEqual(combined.status_code, 200)
        combined_payload = combined.json()
        ChromaResponse.model_validate(combined_payload)
        note_events = combined_payload.pop("noteEvents")
        self.assertEqual(combined_payload, payload)
        self.assertEqual([item["pitchMidi"] for item in note_events["events"]], [69])
        self.assertNotIn("guitar", note_events["events"][0])


if __name__ == "__main__":
    unittest.main()
