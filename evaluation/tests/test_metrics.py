"""Metric calculations on hand-written events; independent of audio inference."""
from __future__ import annotations

import json
import unittest

from guitar_eval.matching import MatchConfig, Note
from guitar_eval.metrics import aggregate, evaluate_recording


def n(pitch: int, onset: float, offset: float | None = None, **extra: object) -> Note:
    return Note(pitch_midi=pitch, onset_seconds=onset, offset_seconds=offset, **extra)  # type: ignore[arg-type]


def evaluate(refs, preds, **kwargs):
    kwargs.setdefault("duration_seconds", 10.0)
    return evaluate_recording("rec", refs, preds, MatchConfig(), **kwargs)


class RecordingMetricTests(unittest.TestCase):
    def test_exact_matches_score_perfectly(self) -> None:
        notes = [n(60, 1.0, 2.0), n(64, 2.0, 3.0)]
        result = evaluate(notes, notes)
        self.assertEqual(result["onset"], {"truePositives": 2, "falsePositives": 0, "falseNegatives": 0, "precision": 1.0, "recall": 1.0, "f1": 1.0})
        self.assertEqual(result["onsetOffset"]["f1"], 1.0)
        self.assertEqual(result["pitch"]["accuracy"], 1.0)
        self.assertEqual(result["onsetErrorMs"]["meanAbsolute"], 0.0)
        self.assertEqual(result["falsePositiveRate"], 0.0)
        self.assertEqual(result["missedNoteRate"], 0.0)

    def test_counts_false_positives_and_missed_notes(self) -> None:
        refs = [n(60, 1.0, 2.0), n(62, 2.0, 3.0), n(64, 3.0, 4.0), n(65, 4.0, 5.0)]
        preds = [n(60, 1.01, 2.0), n(62, 2.02, 3.0), n(70, 6.0, 7.0)]
        result = evaluate(refs, preds)
        self.assertEqual((result["onset"]["truePositives"], result["onset"]["falsePositives"], result["onset"]["falseNegatives"]), (2, 1, 2))
        self.assertAlmostEqual(result["onset"]["precision"], 2 / 3)
        self.assertAlmostEqual(result["onset"]["recall"], 0.5)
        self.assertAlmostEqual(result["onset"]["f1"], 2 * (2 / 3) * 0.5 / (2 / 3 + 0.5))
        self.assertAlmostEqual(result["falsePositiveRate"], 1 / 3)
        self.assertAlmostEqual(result["missedNoteRate"], 0.5)
        self.assertAlmostEqual(result["falsePositivesPerMinute"], 6.0)
        self.assertEqual([item["pitchMidi"] for item in result["unmatchedReferences"]], [64, 65])
        self.assertEqual([item["pitchMidi"] for item in result["unmatchedPredictions"]], [70])
        self.assertEqual(result["onsetErrorMs"]["count"], 2)
        self.assertAlmostEqual(result["onsetErrorMs"]["meanAbsolute"], 15.0)
        self.assertAlmostEqual(result["onsetErrorMs"]["meanSigned"], 15.0)

    def test_pitch_accuracy_and_octave_errors_use_pitch_agnostic_onset_matches(self) -> None:
        refs = [n(52, 1.0), n(57, 2.0), n(60, 3.0)]
        preds = [n(64, 1.0), n(57, 2.0), n(61, 3.0)]
        result = evaluate(refs, preds)
        self.assertEqual(result["pitch"]["onsetMatchedPairs"], 3)
        self.assertEqual(result["pitch"]["correct"], 1)
        self.assertAlmostEqual(result["pitch"]["accuracy"], 1 / 3)
        self.assertEqual(result["pitch"]["octaveErrors"], 1)
        self.assertEqual(result["onset"]["truePositives"], 1)

    def test_pitch_accuracy_is_not_confused_by_simultaneous_chord_notes(self) -> None:
        chord = [n(40, 1.0), n(47, 1.0), n(52, 1.0), n(55, 1.0)]
        predicted = [n(40, 1.001), n(47, 1.003), n(52, 1.002), n(56, 1.0)]
        result = evaluate(chord, predicted)
        self.assertEqual(result["onset"]["truePositives"], 3)
        self.assertEqual(result["pitch"]["onsetMatchedPairs"], 4)
        self.assertEqual(result["pitch"]["correct"], 3)
        self.assertAlmostEqual(result["pitch"]["accuracy"], 0.75)
        self.assertEqual(result["pitch"]["octaveErrors"], 0)

    def test_offset_errors_and_open_ended_predictions(self) -> None:
        refs = [n(60, 1.0, 2.0), n(64, 1.0, 3.0)]
        preds = [n(60, 1.0, 2.1), n(64, 1.0, None)]
        result = evaluate(refs, preds)
        self.assertEqual(result["onset"]["truePositives"], 2)
        self.assertEqual(result["onsetOffset"]["truePositives"], 1)  # open-ended fails under the default policy
        self.assertEqual(result["openEndedPredictions"], 1)
        self.assertEqual(result["offsetErrorMs"]["count"], 1)
        self.assertAlmostEqual(result["offsetErrorMs"]["meanSigned"], 100.0)

    def test_empty_recording_reports_undefined_ratios_as_null(self) -> None:
        result = evaluate([], [])
        self.assertIsNone(result["onset"]["precision"])
        self.assertIsNone(result["onset"]["recall"])
        self.assertIsNone(result["onset"]["f1"])
        self.assertIsNone(result["pitch"]["accuracy"])
        self.assertIsNone(result["onsetErrorMs"]["meanAbsolute"])
        only_false_positives = evaluate([], [n(60, 1.0)])
        self.assertEqual(only_false_positives["onset"]["precision"], 0.0)
        self.assertIsNone(only_false_positives["onset"]["recall"])
        self.assertEqual(only_false_positives["falsePositiveRate"], 1.0)

    def test_low_confidence_references_are_optional(self) -> None:
        refs = [n(60, 1.0), n(62, 2.0, annotation_confidence=0.3), n(64, 3.0, annotation_confidence=0.3)]
        preds = [n(60, 1.0), n(62, 2.0)]
        result = evaluate(refs, preds)
        self.assertEqual((result["onset"]["truePositives"], result["onset"]["falsePositives"], result["onset"]["falseNegatives"]), (1, 0, 0))
        self.assertEqual(result["counts"]["optionalReferences"], 2)
        self.assertEqual(result["counts"]["predictionsMatchedToOptional"], 1)

    def test_required_references_take_priority_over_optional_ones(self) -> None:
        refs = [n(60, 1.00, annotation_confidence=0.2), n(60, 1.03)]
        result = evaluate(refs, [n(60, 1.01)])
        self.assertEqual(result["onset"]["truePositives"], 1)
        self.assertEqual(result["onset"]["falseNegatives"], 0)

    def test_partial_annotation_regions_ignore_predictions_outside_them(self) -> None:
        refs = [n(60, 1.0)]
        preds = [n(60, 1.0), n(62, 5.0)]
        result = evaluate(refs, preds, annotated_regions=[(0.0, 2.0)])
        self.assertEqual(result["onset"]["falsePositives"], 0)
        self.assertEqual(result["counts"]["ignoredPredictions"], 1)

    def test_per_technique_recall_identifies_technique_specific_misses(self) -> None:
        refs = [n(60, 1.0), n(62, 1.5, technique="hammer-on"), n(64, 2.0, technique="slide-in")]
        result = evaluate(refs, [n(60, 1.0), n(64, 2.0)], unsupported_techniques={"hammer-on", "slide-in"})
        self.assertEqual(result["byTechnique"]["none"], {"references": 1, "matched": 1, "recall": 1.0, "supportedByDetector": True})
        self.assertEqual(result["byTechnique"]["hammer-on"], {"references": 1, "matched": 0, "recall": 0.0, "supportedByDetector": False})
        self.assertEqual(result["unmatchedReferences"][0]["technique"], "hammer-on")
        self.assertTrue(result["unmatchedReferences"][0]["unsupportedTechnique"])

    def test_results_are_deterministic_and_json_serialisable(self) -> None:
        refs = [n(60, 1.0, 2.0), n(60, 1.04, 2.0), n(67, 1.0, 1.5)]
        preds = [n(67, 1.01, None), n(60, 1.02, 2.2), n(60, 1.06, 1.9)]
        first = json.dumps(evaluate(refs, preds), sort_keys=True)
        second = json.dumps(evaluate(list(reversed(refs)), list(reversed(preds))), sort_keys=True)
        self.assertEqual(json.loads(first)["onset"], json.loads(second)["onset"])
        self.assertEqual(first, json.dumps(evaluate(refs, preds), sort_keys=True))


class AggregateTests(unittest.TestCase):
    def test_micro_averages_counts_and_breaks_down_by_scenario(self) -> None:
        good = evaluate_recording("a", [n(60, 1.0)], [n(60, 1.0)], MatchConfig(), duration_seconds=2.0)
        bad = evaluate_recording("b", [n(60, 1.0), n(62, 2.0)], [], MatchConfig(), duration_seconds=3.0)
        summary = aggregate([good, bad], scenarios_by_recording={"a": ["single-notes"], "b": ["single-notes", "slides"]})
        self.assertEqual(summary["overall"]["onset"]["truePositives"], 1)
        self.assertEqual(summary["overall"]["onset"]["falseNegatives"], 2)
        self.assertAlmostEqual(summary["overall"]["onset"]["recall"], 1 / 3)
        self.assertAlmostEqual(summary["overall"]["macroOnsetF1"], 1.0)  # b has undefined precision -> F1 undefined
        self.assertEqual(summary["overall"]["recordings"], 2)
        self.assertAlmostEqual(summary["overall"]["durationSeconds"], 5.0)
        self.assertEqual(summary["byScenario"]["slides"]["onset"]["falseNegatives"], 2)
        self.assertEqual(summary["byScenario"]["single-notes"]["recordings"], 2)

    def test_empty_aggregate(self) -> None:
        summary = aggregate([], scenarios_by_recording={})
        self.assertEqual(summary["overall"]["recordings"], 0)
        self.assertIsNone(summary["overall"]["onset"]["f1"])


if __name__ == "__main__":
    unittest.main()
