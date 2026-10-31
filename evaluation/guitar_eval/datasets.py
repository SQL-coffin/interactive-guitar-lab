"""Dataset manifest and annotation loading with validation.

Formats are documented in evaluation/schemas/*.schema.json and evaluation/README.md. This module
is the authoritative validator (no jsonschema dependency); tests keep the schema files in sync.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .matching import Note
from .scenarios import SCENARIO_IDS

SCHEMA_VERSION = "1.0"
# Same vocabulary as the worker's GuitarNoteAttributes (tests enforce it).
TECHNIQUES: tuple[str, ...] = (
    "slide-in", "slide-out", "bend", "release", "hammer-on", "pull-off", "vibrato", "palm-mute", "harmonic",
)
SOURCES = ("real", "synthetic")
INSTRUMENTS = ("acoustic-guitar", "electric-guitar", "classical-guitar", "synthetic", "other")
RECORDING_METHODS = ("di", "processed", "microphone", "mixed", "synthetic")
NOISE_LEVELS = ("none", "low", "moderate", "high")
ANNOTATION_METHODS = ("manual", "semi-automatic", "hexaphonic-pickup", "midi-aligned", "synthetic")
COMPLETENESS = ("complete", "partial")
_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,127}$")
_SEMVER = re.compile(r"^\d+\.\d+\.\d+$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
DURATION_TOLERANCE_SECONDS = 0.01


class DatasetError(ValueError):
    def __init__(self, errors: list[str]):
        super().__init__("\n".join(errors))
        self.errors = errors


@dataclass(frozen=True)
class Annotation:
    recording_id: str
    completeness: str
    annotated_regions: tuple[tuple[float, float], ...] | None
    notes: tuple[Note, ...]


@dataclass(frozen=True)
class Recording:
    id: str
    audio_path: Path
    annotation_path: Path
    scenarios: tuple[str, ...]
    metadata: dict[str, Any]
    annotation: Annotation

    @property
    def source(self) -> str:
        return self.metadata["source"]

    @property
    def duration_seconds(self) -> float:
        return float(self.metadata["durationSeconds"])


@dataclass(frozen=True)
class Dataset:
    root: Path
    dataset_id: str
    version: str
    description: str
    license: str
    splits: dict[str, tuple[str, ...]]
    recordings: tuple[Recording, ...]
    manifest_sha256: str = field(default="")

    def select(self, split: str | None) -> list[Recording]:
        if split is None:
            return list(self.recordings)
        if split not in self.splits:
            raise DatasetError([f"Unknown split {split!r}; available: {', '.join(sorted(self.splits)) or 'none'}."])
        wanted = set(self.splits[split])
        return [recording for recording in self.recordings if recording.id in wanted]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _is_int(value: Any, low: int, high: int) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and low <= value <= high


def _resolve(root: Path, relative: Any, label: str, errors: list[str]) -> Path | None:
    if not isinstance(relative, str) or not relative or Path(relative).is_absolute() or ".." in Path(relative).parts:
        errors.append(f"{label}: path must be a relative path inside the dataset directory.")
        return None
    return root / relative


def validate_annotation(data: Any, *, recording_id: str, duration_seconds: float,
                        tuning_midi: list[int] | None = None, label: str = "annotation") -> tuple[Annotation | None, list[str]]:
    errors: list[str] = []
    if not isinstance(data, dict):
        return None, [f"{label}: must be a JSON object."]
    if data.get("schemaVersion") != SCHEMA_VERSION:
        errors.append(f"{label}.schemaVersion must be {SCHEMA_VERSION!r}.")
    if data.get("recordingId") != recording_id:
        errors.append(f"{label}.recordingId must be {recording_id!r}.")
    completeness = data.get("completeness")
    if completeness not in COMPLETENESS:
        errors.append(f"{label}.completeness must be one of {', '.join(COMPLETENESS)}.")
    regions_raw = data.get("annotatedRegions")
    regions: list[tuple[float, float]] | None = None
    if regions_raw is not None:
        if not isinstance(regions_raw, list) or not regions_raw:
            errors.append(f"{label}.annotatedRegions must be a non-empty array of [start, end] pairs.")
        else:
            regions = []
            for i, region in enumerate(regions_raw):
                if (not isinstance(region, list) or len(region) != 2 or not all(_is_number(v) for v in region)
                        or not 0 <= region[0] < region[1] <= duration_seconds + DURATION_TOLERANCE_SECONDS):
                    errors.append(f"{label}.annotatedRegions[{i}] must be [start, end] with 0 <= start < end <= duration.")
                else:
                    regions.append((float(region[0]), float(region[1])))
    if completeness == "partial" and regions_raw is None:
        errors.append(f"{label}.annotatedRegions is required when completeness is 'partial'.")

    notes_raw = data.get("notes")
    notes: list[Note] = []
    if not isinstance(notes_raw, list):
        errors.append(f"{label}.notes must be an array.")
        notes_raw = []
    allowed = {"pitchMidi", "onsetSeconds", "offsetSeconds", "stringNumber", "fret", "technique", "annotationConfidence"}
    for i, note in enumerate(notes_raw):
        where = f"{label}.notes[{i}]"
        if not isinstance(note, dict):
            errors.append(f"{where} must be an object.")
            continue
        unknown = sorted(set(note) - allowed)
        if unknown:
            errors.append(f"{where} has unknown fields: {', '.join(unknown)}.")
        pitch, onset, offset = note.get("pitchMidi"), note.get("onsetSeconds"), note.get("offsetSeconds", "missing")
        start_errors = len(errors)
        if not _is_int(pitch, 0, 127):
            errors.append(f"{where}.pitchMidi must be an integer from 0 to 127.")
        if not _is_number(onset) or onset < 0 or onset > duration_seconds + DURATION_TOLERANCE_SECONDS:
            errors.append(f"{where}.onsetSeconds must be a finite number within the recording.")
        if offset == "missing":
            errors.append(f"{where}.offsetSeconds is required (use null when the end is unknown).")
        elif offset is not None and (not _is_number(offset) or not _is_number(onset) or offset <= onset
                                     or offset > duration_seconds + DURATION_TOLERANCE_SECONDS):
            errors.append(f"{where}.offsetSeconds must be null or a finite number after onsetSeconds and within the recording.")
        string_number, fret = note.get("stringNumber"), note.get("fret")
        if string_number is not None and not _is_int(string_number, 1, 12):
            errors.append(f"{where}.stringNumber must be an integer from 1 (lowest string) to 12.")
        if fret is not None and not _is_int(fret, 0, 36):
            errors.append(f"{where}.fret must be an integer from 0 to 36.")
        if (tuning_midi and _is_int(string_number, 1, len(tuning_midi)) and _is_int(fret, 0, 36) and _is_int(pitch, 0, 127)
                and tuning_midi[string_number - 1] + fret != pitch):
            errors.append(f"{where}: string {string_number} fret {fret} sounds MIDI {tuning_midi[string_number - 1] + fret}, not pitchMidi {pitch}.")
        if tuning_midi and _is_int(string_number, 1, 12) and string_number > len(tuning_midi):
            errors.append(f"{where}.stringNumber exceeds the {len(tuning_midi)} strings in the tuning.")
        technique = note.get("technique")
        if technique is not None and technique not in TECHNIQUES:
            errors.append(f"{where}.technique must be one of {', '.join(TECHNIQUES)}.")
        confidence = note.get("annotationConfidence")
        if confidence is not None and (not _is_number(confidence) or not 0 <= confidence <= 1):
            errors.append(f"{where}.annotationConfidence must be between 0 and 1.")
        if regions and _is_number(onset) and not any(start <= onset <= end for start, end in regions):
            errors.append(f"{where}.onsetSeconds lies outside every annotated region.")
        if len(errors) == start_errors:
            notes.append(Note(
                pitch_midi=pitch, onset_seconds=float(onset), offset_seconds=None if offset is None else float(offset),
                technique=technique, annotation_confidence=None if confidence is None else float(confidence),
                string_number=string_number, fret=fret,
            ))
    if errors:
        return None, errors
    notes.sort(key=lambda item: (item.onset_seconds, item.pitch_midi))
    return Annotation(recording_id, completeness, tuple(regions) if regions else None, tuple(notes)), []


def _validate_metadata(metadata: Any, where: str, errors: list[str]) -> list[int] | None:
    if not isinstance(metadata, dict):
        errors.append(f"{where} must be an object.")
        return None
    checks = [
        ("source", lambda v: v in SOURCES, f"one of {', '.join(SOURCES)}"),
        ("sampleRateHz", lambda v: _is_int(v, 1, 1_000_000), "a positive integer"),
        ("durationSeconds", lambda v: _is_number(v) and v > 0, "a positive number"),
        ("instrument", lambda v: v in INSTRUMENTS, f"one of {', '.join(INSTRUMENTS)}"),
        ("recordingMethod", lambda v: v in RECORDING_METHODS, f"one of {', '.join(RECORDING_METHODS)}"),
    ]
    for key, check, expected in checks:
        if not check(metadata.get(key)):
            errors.append(f"{where}.{key} must be {expected}.")
    tuning = metadata.get("tuning")
    strings: list[int] | None = None
    if (not isinstance(tuning, dict) or not isinstance(tuning.get("name"), str) or not isinstance(tuning.get("stringsMidi"), list)
            or not 4 <= len(tuning["stringsMidi"]) <= 12 or not all(_is_int(v, 0, 127) for v in tuning["stringsMidi"])):
        errors.append(f"{where}.tuning must be {{name, stringsMidi}} with 4-12 MIDI notes, lowest string first.")
    else:
        strings = list(tuning["stringsMidi"])
    conditions = metadata.get("conditions")
    if not isinstance(conditions, dict) or conditions.get("noise") not in NOISE_LEVELS:
        errors.append(f"{where}.conditions.noise must be one of {', '.join(NOISE_LEVELS)}.")
    elif "effects" in conditions and (not isinstance(conditions["effects"], list) or not all(isinstance(v, str) for v in conditions["effects"])):
        errors.append(f"{where}.conditions.effects must be an array of strings.")
    source = metadata.get("annotationSource")
    if not isinstance(source, dict) or source.get("method") not in ANNOTATION_METHODS:
        errors.append(f"{where}.annotationSource.method must be one of {', '.join(ANNOTATION_METHODS)}.")
    synthetic_fields = [metadata.get("source") == "synthetic", metadata.get("instrument") == "synthetic",
                        metadata.get("recordingMethod") == "synthetic"]
    if any(synthetic_fields) and not all(synthetic_fields):
        errors.append(f"{where}: source, instrument and recordingMethod must all be 'synthetic' or none of them.")
    return strings


def load_dataset(root: str | Path, *, verify_audio: bool = True) -> Dataset:
    """Load and fully validate a dataset; raises DatasetError listing every problem found."""
    root = Path(root)
    manifest_path = root / "dataset.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise DatasetError([f"Cannot read {manifest_path}: {exc}"]) from exc
    errors: list[str] = []
    if not isinstance(manifest, dict):
        raise DatasetError(["dataset.json must be a JSON object."])
    if manifest.get("schemaVersion") != SCHEMA_VERSION:
        errors.append(f"schemaVersion must be {SCHEMA_VERSION!r}.")
    dataset_id = manifest.get("datasetId")
    if not isinstance(dataset_id, str) or not _ID.match(dataset_id):
        errors.append("datasetId must be a lowercase identifier ([a-z0-9._-]).")
    version = manifest.get("version")
    if not isinstance(version, str) or not _SEMVER.match(version):
        errors.append("version must be semantic (MAJOR.MINOR.PATCH); bump it whenever audio or annotations change.")
    for key in ("description", "license"):
        if not isinstance(manifest.get(key), str) or not manifest[key].strip():
            errors.append(f"{key} must be a non-empty string.")

    recordings: list[Recording] = []
    seen: set[str] = set()
    raw_recordings = manifest.get("recordings")
    if not isinstance(raw_recordings, list):
        errors.append("recordings must be an array.")
        raw_recordings = []
    for i, raw in enumerate(raw_recordings):
        where = f"recordings[{i}]"
        if not isinstance(raw, dict):
            errors.append(f"{where} must be an object.")
            continue
        recording_id = raw.get("id")
        if not isinstance(recording_id, str) or not _ID.match(recording_id):
            errors.append(f"{where}.id must be a lowercase identifier.")
            continue
        where = f"recordings[{recording_id}]"
        if recording_id in seen:
            errors.append(f"{where}: duplicate recording id.")
        seen.add(recording_id)
        scenarios = raw.get("scenarios")
        if not isinstance(scenarios, list) or not scenarios or any(s not in SCENARIO_IDS for s in scenarios):
            errors.append(f"{where}.scenarios must list known scenarios: {', '.join(SCENARIO_IDS)}.")
        metadata = raw.get("metadata")
        tuning = _validate_metadata(metadata, f"{where}.metadata", errors)
        files: dict[str, Path] = {}
        for kind in ("audio", "annotation"):
            entry = raw.get(kind)
            if not isinstance(entry, dict) or not isinstance(entry.get("sha256"), str) or not _SHA256.match(entry["sha256"]):
                errors.append(f"{where}.{kind} must be {{path, sha256}} with a lowercase hex SHA-256.")
                continue
            path = _resolve(root, entry.get("path"), f"{where}.{kind}.path", errors)
            if path is None:
                continue
            if not path.is_file():
                errors.append(f"{where}.{kind}: file not found: {entry['path']}.")
                continue
            actual = sha256_file(path)
            if actual != entry["sha256"]:
                errors.append(f"{where}.{kind}: checksum mismatch for {entry['path']} (expected {entry['sha256'][:12]}..., got {actual[:12]}...). "
                              "The file changed; update the manifest and bump the dataset version.")
                continue
            files[kind] = path
        if not isinstance(metadata, dict) or "audio" not in files or "annotation" not in files:
            continue
        if verify_audio and _is_number(metadata.get("durationSeconds")):
            import soundfile  # Only needed when audio is actually checked.
            info = soundfile.info(str(files["audio"]))
            if info.samplerate != metadata.get("sampleRateHz"):
                errors.append(f"{where}.metadata.sampleRateHz is {metadata.get('sampleRateHz')} but the file is {info.samplerate} Hz.")
            if abs(info.duration - metadata["durationSeconds"]) > DURATION_TOLERANCE_SECONDS:
                errors.append(f"{where}.metadata.durationSeconds is {metadata['durationSeconds']} but the file lasts {info.duration:.4f} s.")
        try:
            annotation_data = json.loads(files["annotation"].read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            errors.append(f"{where}.annotation: invalid JSON: {exc}")
            continue
        if not _is_number(metadata.get("durationSeconds")):
            continue
        annotation, annotation_errors = validate_annotation(
            annotation_data, recording_id=recording_id, duration_seconds=float(metadata["durationSeconds"]),
            tuning_midi=tuning, label=f"{where}.annotation",
        )
        errors.extend(annotation_errors)
        if annotation is not None and isinstance(scenarios, list):
            recordings.append(Recording(recording_id, files["audio"], files["annotation"], tuple(scenarios), metadata, annotation))

    splits_raw = manifest.get("splits")
    splits: dict[str, tuple[str, ...]] = {}
    if not isinstance(splits_raw, dict) or not splits_raw:
        errors.append("splits must map split names to arrays of recording ids.")
    else:
        assigned: dict[str, str] = {}
        for name, ids in sorted(splits_raw.items()):
            if not isinstance(ids, list) or not all(isinstance(v, str) for v in ids):
                errors.append(f"splits.{name} must be an array of recording ids.")
                continue
            for recording_id in ids:
                if recording_id not in seen:
                    errors.append(f"splits.{name} references unknown recording {recording_id!r}.")
                if recording_id in assigned and assigned[recording_id] != name:
                    errors.append(f"Recording {recording_id!r} is in both {assigned[recording_id]!r} and {name!r}; splits must not overlap.")
                assigned[recording_id] = name
            splits[name] = tuple(ids)
    if errors:
        raise DatasetError(errors)
    return Dataset(root, dataset_id, version, manifest["description"], manifest["license"], splits,
                   tuple(sorted(recordings, key=lambda r: r.id)), sha256_file(manifest_path))
