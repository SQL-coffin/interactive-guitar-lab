"""Dataset manifest and annotation validation."""
from __future__ import annotations

import copy
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

from guitar_eval import datasets
from guitar_eval.datasets import DatasetError, load_dataset, sha256_file, validate_annotation
from guitar_eval.scenarios import SCENARIO_IDS, SCENARIOS
from guitar_eval.synthetic import write_synthetic_dataset

SCHEMAS = Path(__file__).resolve().parents[1] / "schemas"
STANDARD = [40, 45, 50, 55, 59, 64]


def annotation(**overrides):
    data = {"schemaVersion": "1.0", "recordingId": "rec", "completeness": "complete",
            "notes": [{"pitchMidi": 45, "onsetSeconds": 0.5, "offsetSeconds": 1.0, "stringNumber": 2, "fret": 0}]}
    data.update(overrides)
    return data


def note(**overrides):
    base = {"pitchMidi": 60, "onsetSeconds": 0.5, "offsetSeconds": 1.0}
    base.update(overrides)
    return annotation(notes=[base])


def errors_for(data, duration=2.0):
    parsed, errors = validate_annotation(data, recording_id="rec", duration_seconds=duration, tuning_midi=STANDARD)
    return parsed, errors


class AnnotationValidationTests(unittest.TestCase):
    def test_valid_annotation_is_parsed_and_sorted(self) -> None:
        data = annotation(notes=[{"pitchMidi": 64, "onsetSeconds": 1.0, "offsetSeconds": None},
                                 {"pitchMidi": 45, "onsetSeconds": 0.5, "offsetSeconds": 0.9, "technique": "hammer-on",
                                  "annotationConfidence": 0.4}])
        parsed, errors = errors_for(data)
        self.assertEqual(errors, [])
        self.assertEqual([n.pitch_midi for n in parsed.notes], [45, 64])
        self.assertIsNone(parsed.notes[1].offset_seconds)
        self.assertEqual(parsed.notes[0].technique, "hammer-on")

    def test_rejects_invalid_notes(self) -> None:
        cases = {
            "pitch": note(pitchMidi=128),
            "fractional pitch": note(pitchMidi=60.5),
            "negative onset": note(onsetSeconds=-0.1),
            "onset beyond duration": note(onsetSeconds=5.0, offsetSeconds=None),
            "missing offset key": annotation(notes=[{"pitchMidi": 60, "onsetSeconds": 0.5}]),
            "offset before onset": note(offsetSeconds=0.4),
            "nan offset": note(offsetSeconds=float("nan")),
            "unknown technique": note(technique="tapping-with-elbow"),
            "confidence": note(annotationConfidence=1.5),
            "string/fret inconsistent with pitch": note(pitchMidi=60, stringNumber=1, fret=3),
            "unknown field": note(velocity=100),
            "bad completeness": annotation(completeness="mostly"),
            "partial without regions": annotation(completeness="partial"),
            "region outside recording": annotation(completeness="partial", annotatedRegions=[[0.0, 9.0]]),
            "note outside region": annotation(completeness="partial", annotatedRegions=[[1.5, 2.0]]),
            "wrong recording id": annotation(recordingId="other"),
            "wrong schema version": annotation(schemaVersion="2.0"),
        }
        for label, data in cases.items():
            with self.subTest(label):
                parsed, errors = errors_for(data)
                self.assertIsNone(parsed)
                self.assertTrue(errors)

    def test_accepts_partial_annotations_and_empty_recordings(self) -> None:
        parsed, errors = errors_for(annotation(completeness="partial", annotatedRegions=[[0.0, 1.5]]))
        self.assertEqual(errors, [])
        self.assertEqual(parsed.annotated_regions, ((0.0, 1.5),))
        empty, errors = errors_for(annotation(notes=[]))
        self.assertEqual(errors, [])
        self.assertEqual(empty.notes, ())


class DatasetLoadingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = Path(tempfile.mkdtemp()) / "synthetic"
        write_synthetic_dataset(cls.source)

    @classmethod
    def tearDownClass(cls) -> None:
        shutil.rmtree(cls.source.parent, ignore_errors=True)

    def copy(self) -> Path:
        target = Path(tempfile.mkdtemp()) / "dataset"
        shutil.copytree(self.source, target)
        self.addCleanup(shutil.rmtree, target.parent, ignore_errors=True)
        return target

    def edit_manifest(self, root: Path, change) -> None:
        manifest = json.loads((root / "dataset.json").read_text())
        change(manifest)
        (root / "dataset.json").write_text(json.dumps(manifest))

    def assert_invalid(self, root: Path, fragment: str) -> None:
        with self.assertRaises(DatasetError) as caught:
            load_dataset(root)
        self.assertTrue(any(fragment in error for error in caught.exception.errors), caught.exception.errors)

    def test_synthetic_dataset_is_valid_and_covers_every_scenario(self) -> None:
        dataset = load_dataset(self.source)
        self.assertEqual((dataset.dataset_id, dataset.version), ("synthetic-smoke", "1.0.0"))
        covered = {scenario for recording in dataset.recordings for scenario in recording.scenarios}
        self.assertEqual(covered, set(SCENARIO_IDS))
        self.assertTrue(all(recording.source == "synthetic" for recording in dataset.recordings))
        self.assertEqual([r.id for r in dataset.select("dev")], ["single-notes"])
        with self.assertRaises(DatasetError):
            dataset.select("nope")

    def test_synthetic_dataset_is_byte_reproducible(self) -> None:
        other = Path(tempfile.mkdtemp()) / "again"
        self.addCleanup(shutil.rmtree, other.parent, ignore_errors=True)
        write_synthetic_dataset(other)
        self.assertEqual(sha256_file(other / "dataset.json"), sha256_file(self.source / "dataset.json"))

    def test_detects_modified_audio_via_checksum(self) -> None:
        root = self.copy()
        with (root / "audio" / "chords.wav").open("ab") as handle:
            handle.write(b"\0")
        self.assert_invalid(root, "checksum mismatch")

    def test_detects_modified_annotation_via_checksum(self) -> None:
        root = self.copy()
        path = root / "annotations" / "chords.json"
        path.write_text(path.read_text().replace('"pitchMidi": 40', '"pitchMidi": 41', 1))
        self.assert_invalid(root, "checksum mismatch")

    def test_detects_metadata_that_disagrees_with_the_audio_file(self) -> None:
        root = self.copy()
        self.edit_manifest(root, lambda m: m["recordings"][0]["metadata"].update(sampleRateHz=48_000, durationSeconds=99.0))
        self.assert_invalid(root, "sampleRateHz is 48000")
        self.assert_invalid(root, "durationSeconds is 99.0")

    def test_rejects_bad_manifest_fields(self) -> None:
        cases = {
            "version must be semantic": lambda m: m.update(version="v1"),
            "splits must not overlap": lambda m: m["splits"].update(dev=["single-notes", "chords"]),
            "unknown recording": lambda m: m["splits"].update(extra=["ghost"]),
            "must list known scenarios": lambda m: m["recordings"][0].update(scenarios=["tapping"]),
            "duplicate recording id": lambda m: m["recordings"].append(copy.deepcopy(m["recordings"][0])),
            "relative path": lambda m: m["recordings"][0]["audio"].update(path="../escape.wav"),
            "all be 'synthetic'": lambda m: m["recordings"][0]["metadata"].update(source="real"),
            "recordingMethod must be": lambda m: m["recordings"][0]["metadata"].update(recordingMethod="tape"),
        }
        for fragment, change in cases.items():
            with self.subTest(fragment):
                root = self.copy()
                self.edit_manifest(root, change)
                self.assert_invalid(root, fragment)


class SchemaDocumentationTests(unittest.TestCase):
    """The JSON Schema files document the format; keep their enums in sync with the validator."""

    def test_manifest_schema_matches_validator_constants(self) -> None:
        schema = json.loads((SCHEMAS / "dataset-manifest.schema.json").read_text())
        meta = schema["$defs"]["metadata"]["properties"]
        self.assertEqual(meta["source"]["enum"], list(datasets.SOURCES))
        self.assertEqual(meta["instrument"]["enum"], list(datasets.INSTRUMENTS))
        self.assertEqual(meta["recordingMethod"]["enum"], list(datasets.RECORDING_METHODS))
        self.assertEqual(meta["conditions"]["properties"]["noise"]["enum"], list(datasets.NOISE_LEVELS))
        self.assertEqual(meta["annotationSource"]["properties"]["method"]["enum"], list(datasets.ANNOTATION_METHODS))
        self.assertEqual(schema["$defs"]["recording"]["properties"]["scenarios"]["items"]["enum"], list(SCENARIO_IDS))

    def test_annotation_schema_matches_validator_constants(self) -> None:
        schema = json.loads((SCHEMAS / "annotation.schema.json").read_text())
        self.assertEqual(schema["properties"]["completeness"]["enum"], list(datasets.COMPLETENESS))
        self.assertEqual(schema["$defs"]["note"]["properties"]["technique"]["enum"], list(datasets.TECHNIQUES))

    def test_technique_vocabulary_matches_the_worker(self) -> None:
        worker = Path(__file__).resolve().parents[2] / "services" / "audio-worker"
        sys.path.insert(0, str(worker))
        from note_events import GUITAR_TECHNIQUES
        self.assertEqual(datasets.TECHNIQUES, GUITAR_TECHNIQUES)

    def test_every_scenario_has_a_capability_and_limitation(self) -> None:
        for scenario in SCENARIOS.values():
            self.assertIn(scenario.capability, ("baseline", "experimental"))
            self.assertTrue(scenario.known_limitation)


class ExampleFilesTests(unittest.TestCase):
    def test_documented_example_annotation_is_valid(self) -> None:
        example = Path(__file__).resolve().parents[1] / "datasets" / "examples" / "annotation.example.json"
        parsed, errors = validate_annotation(json.loads(example.read_text()), recording_id="clean-di-arpeggio-01",
                                             duration_seconds=12.5, tuning_midi=STANDARD)
        self.assertEqual(errors, [])
        self.assertEqual(len(parsed.notes), 5)


if __name__ == "__main__":
    unittest.main()
