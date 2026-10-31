"""API compatibility and contract-fixture drift tests.

* The default chroma response keeps exactly its pre-note-event structure.
* includeNoteEvents is opt-in and only adds the `noteEvents` key.
* /v1/features/note-events returns the documented schema.
* The committed fixtures in contracts/audio-worker match what the worker produces now, so the
  TypeScript contract test is validating real current output.
"""
from __future__ import annotations

import json
import math
import unittest
from typing import Any

from contract_fixtures import DEFAULT_OUTPUT, generate

CHROMA_KEYS = {
    "schemaVersion", "filename", "durationSeconds", "sampleRate", "windowSeconds",
    "rhythm", "windowingMode", "windowStrategy", "frames",
}
RHYTHM_KEYS = {
    "tempoBpm", "beatTimesSeconds", "timeSignatureNumerator", "timeSignatureDenominator",
    "meterConfidence", "barDurationSeconds", "downbeatTimesSeconds",
}
FRAME_KEYS = {"startSeconds", "endSeconds", "chroma", "bassPitchClass"}
NOTE_EVENT_RESPONSE_KEYS = {"schemaVersion", "filename", "durationSeconds", "sampleRate", "noteEvents"}
NOTE_EVENT_ANALYSIS_KEYS = {"schemaVersion", "model", "frameRateHz", "pitchRangeMidi", "truncated", "events"}
MODEL_KEYS = {"name", "version", "source", "calibrated"}
EVENT_KEYS = {
    "pitchMidi", "onsetSeconds", "offsetSeconds", "onsetConfidence", "offsetConfidence",
    "pitchConfidence", "source",
}
# Float tolerance for drift checks; values are rounded to 4-6 decimals by the worker.
FLOAT_TOLERANCE = 2e-3


def assert_close(test: unittest.TestCase, expected: Any, actual: Any, path: str = "$") -> None:
    if isinstance(expected, dict):
        test.assertIsInstance(actual, dict, path)
        test.assertEqual(set(expected), set(actual), f"keys differ at {path}")
        for key in expected:
            assert_close(test, expected[key], actual[key], f"{path}.{key}")
    elif isinstance(expected, list):
        test.assertIsInstance(actual, list, path)
        test.assertEqual(len(expected), len(actual), f"length differs at {path}")
        for index, (left, right) in enumerate(zip(expected, actual)):
            assert_close(test, left, right, f"{path}[{index}]")
    elif isinstance(expected, float) and not isinstance(expected, bool):
        test.assertIsInstance(actual, (int, float), path)
        test.assertTrue(math.isclose(expected, actual, abs_tol=FLOAT_TOLERANCE), f"{path}: {expected} != {actual}")
    else:
        test.assertEqual(expected, actual, path)


class ApiCompatibilityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.fixtures = generate()

    def test_default_chroma_response_structure_is_unchanged(self) -> None:
        for key, body in self.fixtures.items():
            if not key.startswith("chroma-default."):
                continue
            with self.subTest(key=key):
                self.assertEqual(set(body), CHROMA_KEYS)
                self.assertEqual(set(body["rhythm"]), RHYTHM_KEYS)
                self.assertEqual(body["schemaVersion"], "1.0")
                for frame in body["frames"]:
                    self.assertEqual(set(frame), FRAME_KEYS)

    def test_include_note_events_is_opt_in_and_purely_additive(self) -> None:
        for key, body in self.fixtures.items():
            if not key.startswith("chroma-with-note-events."):
                continue
            case = key.split(".", 1)[1]
            with self.subTest(case=case):
                combined = dict(body)
                note_events = combined.pop("noteEvents")
                self.assertEqual(combined, self.fixtures[f"chroma-default.{case}"])
                self.assertEqual(set(note_events), NOTE_EVENT_ANALYSIS_KEYS)
                self.assertEqual(note_events["events"], self.fixtures[f"note-events.{case}"]["noteEvents"]["events"])

    def test_note_events_endpoint_returns_documented_schema(self) -> None:
        for key, body in self.fixtures.items():
            if not key.startswith("note-events."):
                continue
            with self.subTest(key=key):
                self.assertEqual(set(body), NOTE_EVENT_RESPONSE_KEYS)
                analysis = body["noteEvents"]
                self.assertEqual(set(analysis), NOTE_EVENT_ANALYSIS_KEYS)
                self.assertEqual(analysis["schemaVersion"], "1.0")
                self.assertEqual(set(analysis["model"]), MODEL_KEYS)
                self.assertFalse(analysis["model"]["calibrated"])
                self.assertEqual(analysis["pitchRangeMidi"], {"min": 40, "max": 88})
                for event in analysis["events"]:
                    self.assertEqual(set(event), EVENT_KEYS)
        self.assertEqual(self.fixtures["note-events.silence"]["noteEvents"]["events"], [])
        open_ended = self.fixtures["note-events.overlapping-open-ended"]["noteEvents"]["events"]
        self.assertEqual([event["pitchMidi"] for event in open_ended], [57, 64])
        self.assertIsNone(open_ended[1]["offsetSeconds"])
        self.assertIsNone(open_ended[1]["offsetConfidence"])

    def test_committed_contract_fixtures_match_current_worker_output(self) -> None:
        committed = {path.stem: json.loads(path.read_text(encoding="utf-8")) for path in DEFAULT_OUTPUT.glob("*.json")}
        self.assertEqual(
            set(committed), set(self.fixtures),
            "Contract fixtures are missing or stale; run `python contract_fixtures.py`.",
        )
        for key, body in self.fixtures.items():
            with self.subTest(key=key):
                assert_close(self, committed[key], body)


if __name__ == "__main__":
    unittest.main()
