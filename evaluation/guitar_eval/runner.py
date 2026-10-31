"""Benchmark runner: dataset -> detector -> matching -> metrics -> JSON results."""
from __future__ import annotations

from typing import Any

from .datasets import Dataset
from .detectors import Detector
from .matching import MatchConfig
from .metrics import aggregate, evaluate_recording
from .scenarios import SCENARIOS, capability_groups

RESULTS_SCHEMA_VERSION = "1.0"
_DECIMALS = 6


def _round(value: Any) -> Any:
    """Round floats so results are byte-stable across platforms with tiny floating-point drift."""
    if isinstance(value, float):
        return round(value, _DECIMALS)
    if isinstance(value, dict):
        return {key: _round(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_round(item) for item in value]
    return value


def run_benchmark(dataset: Dataset, detector: Detector, config: MatchConfig, *, split: str | None = None) -> dict[str, Any]:
    recordings = dataset.select(split)
    per_recording = []
    for recording in recordings:
        predictions = detector.predict(recording.id, recording.audio_path)
        annotation = recording.annotation
        result = evaluate_recording(
            recording.id, annotation.notes, predictions, config,
            duration_seconds=recording.duration_seconds,
            annotated_regions=annotation.annotated_regions if annotation.completeness == "partial" else None,
            unsupported_techniques=detector.unsupported_techniques,
        )
        metadata = recording.metadata
        result.update({
            "scenarios": list(recording.scenarios),
            "source": recording.source,
            "instrument": metadata["instrument"],
            "recordingMethod": metadata["recordingMethod"],
            "noise": metadata["conditions"]["noise"],
            "annotationMethod": metadata["annotationSource"]["method"],
            "annotationCompleteness": annotation.completeness,
        })
        per_recording.append(result)

    scenarios_by_recording = {recording.id: list(recording.scenarios) for recording in recordings}
    real = sum(1 for recording in recordings if recording.source == "real")
    return _round({
        "schemaVersion": RESULTS_SCHEMA_VERSION,
        "dataset": {
            "id": dataset.dataset_id,
            "version": dataset.version,
            "manifestSha256": dataset.manifest_sha256,
            "split": split,
            "recordings": len(recordings),
            "realRecordings": real,
            "syntheticRecordings": len(recordings) - real,
            "license": dataset.license,
        },
        "detector": detector.describe(),
        "matchConfig": config.to_dict(),
        "scenarios": {
            scenario.id: {"title": scenario.title, "capability": scenario.capability, "knownLimitation": scenario.known_limitation}
            for scenario in SCENARIOS.values()
        },
        # Real-world claims are only meaningful when real annotated recordings were evaluated.
        "realWorldEvidence": real > 0,
        "summary": aggregate(per_recording, scenarios_by_recording=scenarios_by_recording, scenario_groups=capability_groups()),
        "recordings": sorted(per_recording, key=lambda item: item["recordingId"]),
    })
