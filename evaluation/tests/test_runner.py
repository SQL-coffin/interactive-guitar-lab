"""End-to-end benchmark runner, detector adapters, report and CLI on the synthetic dataset."""
from __future__ import annotations

import io
import json
import shutil
import sys
import tempfile
import types
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

import numpy as np

from guitar_eval.__main__ import main
from guitar_eval.datasets import load_dataset
from guitar_eval.detectors import WORKER_DIR, load_detector, predictions_detector
from guitar_eval.matching import MatchConfig
from guitar_eval.report import render_markdown
from guitar_eval.runner import run_benchmark
from guitar_eval.synthetic import write_synthetic_dataset

sys.path.insert(0, str(WORKER_DIR))
from note_events import ModelInfo, NoteActivations  # noqa: E402


class PerfectOracle:
    """A stand-in 'future model' that implements the worker's NoteEventModel protocol."""

    info = ModelInfo(name="oracle-test-model", version="0.0.1", source="model")
    pitch_range = (40, 88)
    supported_techniques = ("hammer-on",)

    def predict(self, samples: np.ndarray, sample_rate: int) -> NoteActivations:
        frames = np.zeros((int(samples.size / sample_rate * 100) + 1, 49), dtype=np.float32)
        frames[10:60, 20] = 1.0
        onsets = np.zeros_like(frames)
        onsets[10, 20] = 1.0
        return NoteActivations(frames, onsets, None, 100.0, 40, samples.size / sample_rate)


class RunnerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = Path(tempfile.mkdtemp())
        cls.dataset_dir = write_synthetic_dataset(cls.tmp / "synthetic")
        cls.dataset = load_dataset(cls.dataset_dir)
        cls.heuristic = load_detector("heuristic")
        cls.results = run_benchmark(cls.dataset, cls.heuristic, MatchConfig())

    @classmethod
    def tearDownClass(cls) -> None:
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_results_identify_dataset_detector_and_settings(self) -> None:
        results = self.results
        self.assertEqual(results["dataset"]["id"], "synthetic-smoke")
        self.assertEqual(results["dataset"]["version"], "1.0.0")
        self.assertEqual(results["dataset"]["realRecordings"], 0)
        self.assertFalse(results["realWorldEvidence"])
        self.assertEqual(results["detector"]["name"], "heuristic-cqt-onset-baseline")
        self.assertFalse(results["detector"]["calibrated"])
        self.assertIn("hammer-on", results["detector"]["unsupportedTechniques"])
        self.assertEqual(results["matchConfig"]["onsetToleranceSeconds"], 0.05)
        self.assertEqual(len(results["recordings"]), 11)
        self.assertEqual(set(results["summary"]["byCapability"]), {"baseline", "experimental", "mixed"})

    def test_aggregate_counts_equal_the_sum_of_recordings(self) -> None:
        overall = self.results["summary"]["overall"]["onset"]
        for key in ("truePositives", "falsePositives", "falseNegatives"):
            self.assertEqual(overall[key], sum(r["onset"][key] for r in self.results["recordings"]))

    def test_mixed_scenario_recordings_are_separated_from_isolated_scenario_results(self) -> None:
        summary = self.results["summary"]
        mixed = {item["recordingId"]: item["scenarios"] for item in summary["mixedScenarioRecordings"]}
        self.assertEqual(mixed, {"noisy-room": ["background-noise", "single-notes"],
                                 "strumming": ["polyphonic-chords", "strumming"]})
        self.assertEqual(summary["byScenario"]["single-notes"]["recordingIds"], ["single-notes"])
        self.assertEqual(summary["byScenario"]["polyphonic-chords"]["recordingIds"], ["chords"])
        self.assertEqual(summary["byScenario"]["background-noise"]["recordings"], 0)
        self.assertEqual(summary["byScenario"]["strumming"]["recordings"], 0)
        self.assertTrue(summary["byScenarioTag"]["strumming"]["overlapsOtherScenarios"])
        self.assertEqual(summary["byCapability"]["mixed"]["recordingIds"], ["noisy-room", "strumming"])
        overall = summary["overall"]["onset"]
        for key in ("truePositives", "falsePositives", "falseNegatives"):
            self.assertEqual(sum(group["onset"][key] for group in summary["byCapability"].values()), overall[key])

    def test_report_does_not_present_mixed_recordings_as_isolated_scenario_accuracy(self) -> None:
        report = render_markdown(self.results)
        self.assertIn("## By scenario (isolated recordings only)", report)
        self.assertIn("## Mixed-scenario recordings", report)
        self.assertIn("| Background noise (experimental) | 0 | no isolated recordings", report)
        self.assertIn("| noisy-room | background-noise, single-notes |", report)
        self.assertIn("Mixed (spans baseline and experimental)", report)
        self.assertIn("False discovery rate", report)

    def test_partial_annotation_and_optional_reference_are_applied(self) -> None:
        noisy = next(r for r in self.results["recordings"] if r["recordingId"] == "noisy-room")
        self.assertEqual(noisy["annotationCompleteness"], "partial")
        self.assertEqual(noisy["counts"]["optionalReferences"], 1)
        self.assertGreaterEqual(noisy["counts"]["ignoredPredictions"], 1)

    def test_runs_are_deterministic(self) -> None:
        again = run_benchmark(self.dataset, self.heuristic, MatchConfig())
        self.assertEqual(json.dumps(again, sort_keys=True), json.dumps(self.results, sort_keys=True))

    def test_split_selection(self) -> None:
        dev = run_benchmark(self.dataset, self.heuristic, MatchConfig(), split="dev")
        self.assertEqual([r["recordingId"] for r in dev["recordings"]], ["single-notes"])
        self.assertEqual(dev["dataset"]["split"], "dev")

    def test_precomputed_predictions_matching_ground_truth_score_perfectly(self) -> None:
        predictions = self.tmp / "oracle-predictions"
        predictions.mkdir(exist_ok=True)
        for recording in self.dataset.recordings:
            events = [{"pitchMidi": n.pitch_midi, "onsetSeconds": n.onset_seconds, "offsetSeconds": n.offset_seconds,
                       "onsetConfidence": 1.0, "offsetConfidence": None if n.offset_seconds is None else 1.0,
                       "pitchConfidence": 1.0, "source": "model"} for n in recording.annotation.notes]
            (predictions / f"{recording.id}.json").write_text(json.dumps({"noteEvents": {"events": events}}))
        results = run_benchmark(self.dataset, predictions_detector(predictions, "oracle", "1"), MatchConfig())
        overall = results["summary"]["overall"]
        self.assertEqual(overall["onset"]["f1"], 1.0)
        self.assertEqual(overall["onsetOffset"]["f1"], 1.0)
        self.assertEqual(overall["onset"]["falsePositives"], 0)
        self.assertEqual(results["detector"]["name"], "oracle")

    def test_precomputed_predictions_are_validated_with_the_worker_contract(self) -> None:
        bad = self.tmp / "bad-predictions"
        bad.mkdir(exist_ok=True)
        event = {"pitchMidi": 60, "onsetSeconds": 1.0, "offsetSeconds": 0.5, "onsetConfidence": 1.0,
                 "offsetConfidence": 1.0, "pitchConfidence": 1.0, "source": "model"}
        for recording in self.dataset.recordings:
            (bad / f"{recording.id}.json").write_text(json.dumps({"events": [event]}))
        with self.assertRaises(ValueError):
            run_benchmark(self.dataset, predictions_detector(bad), MatchConfig())

    def test_future_models_plug_in_through_the_worker_model_adapter(self) -> None:
        module = types.ModuleType("fake_future_model")
        module.PerfectOracle = PerfectOracle
        sys.modules["fake_future_model"] = module
        self.addCleanup(sys.modules.pop, "fake_future_model", None)
        detector = load_detector("fake_future_model:PerfectOracle")
        self.assertEqual(detector.name, "oracle-test-model")
        self.assertNotIn("hammer-on", detector.unsupported_techniques)
        results = run_benchmark(self.dataset, detector, MatchConfig(), split="dev")
        self.assertEqual(results["detector"]["source"], "model")

    def test_markdown_report_contains_required_sections(self) -> None:
        report = render_markdown(self.results)
        for text in ("No real guitar recordings were evaluated", "synthetic-smoke", "1.0.0", "heuristic-cqt-onset-baseline",
                     "## Overall", "Baseline scenarios", "Experimental scenarios", "## By scenario", "Pitch accuracy",
                     "Onset |", "Offset |", "## Recall by annotated technique", "## Missed notes and false positives",
                     "## Known limitations", "False positive rate", "Missed note rate"):
            self.assertIn(text, report)


class CliTests(unittest.TestCase):
    def test_validate_run_and_invalid_dataset_exit_codes(self) -> None:
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        with redirect_stdout(io.StringIO()):
            self.assertEqual(main(["make-synthetic", str(tmp / "ds")]), 0)
            self.assertEqual(main(["validate", str(tmp / "ds")]), 0)
            self.assertEqual(main(["run", str(tmp / "ds"), "--split", "dev", "--output", str(tmp / "out"),
                                   "--onset-tolerance", "0.03", "--open-ended-policy", "ignore-offset"]), 0)
        results = json.loads((tmp / "out" / "results.json").read_text())
        self.assertEqual(results["matchConfig"]["onsetToleranceSeconds"], 0.03)
        self.assertEqual(results["matchConfig"]["openEndedPredictionPolicy"], "ignore-offset")
        self.assertTrue((tmp / "out" / "report.md").read_text().startswith("# Note-event benchmark"))
        (tmp / "ds" / "audio" / "chords.wav").write_bytes(b"tampered")
        stderr = io.StringIO()
        with redirect_stderr(stderr):
            self.assertEqual(main(["validate", str(tmp / "ds")]), 2)
        self.assertIn("checksum mismatch", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
