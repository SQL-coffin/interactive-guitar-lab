"""Deterministic note-level metrics built on guitar_eval.matching.

Definitions (counts are over *required* reference notes; see MatchConfig.min_reference_confidence):

* onset mode: a true positive is a pitch + onset match. onsetOffset mode also requires the offset.
* precision = TP / (TP + FP), recall = TP / (TP + FN), F1 = harmonic mean. A ratio with a zero
  denominator is reported as null (undefined), never silently as 0 or 1.
* falsePositiveRate = FP / evaluated predictions. Its denominator includes predictions absorbed by
  optional references, so it is NOT 1 - precision when optional references are present.
* falseDiscoveryRate = FP / (TP + FP), which equals 1 - precision whenever precision is defined.
* missedNoteRate = FN / required references (= 1 - recall); falsePositivesPerMinute normalises FP by
  audio duration.
* pitch accuracy: among notes whose onset was detected, the share with the right pitch. Correct =
  onset-mode true positives (pitch + onset). Wrong-pitch pairs = references and predictions left over
  after that, matched again on onset alone. Matching pitch first keeps simultaneous chord notes from
  being paired with each other arbitrarily. accuracy = correct / (correct + wrong). Octave errors are
  the wrong-pitch pairs that differ by a multiple of 12 semitones.
* onset/offset errors (ms, prediction minus reference) are taken from onset-mode true positives;
  offset errors only where both offsets are known.
* Optional (low-confidence) references can absorb a prediction (not a false positive) but are never
  counted as hits or misses. Required references are matched first so they keep priority.
* With annotated_regions (partial annotations), predictions whose onset lies outside every region
  (widened by the onset tolerance) are ignored and reported as ignoredPredictions.

Scenario semantics (aggregate): scenarios are *recording tags*. A recording tagged with several
scenarios (e.g. background noise + single notes) cannot be split by scenario, because annotations are
not labelled per scenario. So:

* byScenario[s] - "isolated" result: only recordings tagged with s and nothing else. This is the only
  per-scenario number that can be read as that scenario's accuracy.
* mixedScenarioRecordings - every recording with more than one tag, listed with its tags. Such a
  recording is never attributed to any single scenario's isolated result.
* byScenarioTag[s] - every recording carrying tag s, mixed or not. Cohorts overlap; each entry
  lists mixedRecordingIds and overlapsOtherScenarios so it is never mistaken for isolated accuracy.
* byCapability - a partition: recordings whose tags all fall in one capability group, plus "mixed"
  for recordings spanning groups. Groups sum exactly to the overall totals.
* overall - every recording once, independent of tags.
"""
from __future__ import annotations

import math
from collections.abc import Collection, Mapping, Sequence
from typing import Any

from .matching import MatchConfig, Note, match_notes

NO_TECHNIQUE = "none"


def _ratio(numerator: int, denominator: int) -> float | None:
    return None if denominator == 0 else numerator / denominator


def _prf(tp: int, fp: int, fn: int) -> dict[str, Any]:
    precision = _ratio(tp, tp + fp)
    recall = _ratio(tp, tp + fn)
    if precision is None or recall is None:
        f1 = None
    elif precision + recall == 0:
        f1 = 0.0
    else:
        f1 = 2 * precision * recall / (precision + recall)
    return {"truePositives": tp, "falsePositives": fp, "falseNegatives": fn, "precision": precision, "recall": recall, "f1": f1}


def _error_stats(errors_ms: Sequence[float]) -> dict[str, Any]:
    if not errors_ms:
        return {"count": 0, "meanAbsolute": None, "medianAbsolute": None, "p95Absolute": None, "maxAbsolute": None, "meanSigned": None}
    absolute = sorted(abs(value) for value in errors_ms)
    middle = len(absolute) // 2
    median = absolute[middle] if len(absolute) % 2 else (absolute[middle - 1] + absolute[middle]) / 2
    p95 = absolute[max(0, math.ceil(0.95 * len(absolute)) - 1)]  # nearest-rank percentile
    return {
        "count": len(absolute),
        "meanAbsolute": sum(absolute) / len(absolute),
        "medianAbsolute": median,
        "p95Absolute": p95,
        "maxAbsolute": absolute[-1],
        "meanSigned": sum(errors_ms) / len(errors_ms),
    }


def _note_dict(note: Note, index: int, unsupported: Collection[str] = ()) -> dict[str, Any]:
    result: dict[str, Any] = {
        "index": index,
        "pitchMidi": note.pitch_midi,
        "onsetSeconds": note.onset_seconds,
        "offsetSeconds": note.offset_seconds,
    }
    if note.technique is not None:
        result["technique"] = note.technique
        result["unsupportedTechnique"] = note.technique in unsupported
    return result


def _in_regions(onset: float, regions: Sequence[tuple[float, float]], tolerance: float) -> bool:
    return any(start - tolerance <= onset <= end + tolerance for start, end in regions)


def _staged_match(references, predictions, config, required, optional, evaluated, **kwargs):
    """Match required references first, then let optional references absorb leftover predictions."""
    first = match_notes(references, predictions, config, reference_subset=required, prediction_subset=evaluated, **kwargs)
    second = match_notes(references, predictions, config, reference_subset=optional, prediction_subset=first.unmatched_predictions, **kwargs)
    return first, second


def evaluate_recording(
    recording_id: str,
    references: Sequence[Note],
    predictions: Sequence[Note],
    config: MatchConfig,
    *,
    duration_seconds: float,
    annotated_regions: Sequence[tuple[float, float]] | None = None,
    unsupported_techniques: Collection[str] = frozenset(),
) -> dict[str, Any]:
    required = [i for i, note in enumerate(references)
                if note.annotation_confidence is None or note.annotation_confidence >= config.min_reference_confidence]
    optional = [i for i in range(len(references)) if i not in set(required)]
    if annotated_regions:
        evaluated = [i for i, note in enumerate(predictions)
                     if _in_regions(note.onset_seconds, annotated_regions, config.onset_tolerance_seconds)]
    else:
        evaluated = list(range(len(predictions)))
    ignored = len(predictions) - len(evaluated)

    onset_main, onset_optional = _staged_match(references, predictions, config, required, optional, evaluated)
    full_main, full_optional = _staged_match(
        references, predictions, config, required, optional, evaluated,
        require_offset=True, audio_duration_seconds=duration_seconds,
    )
    wrong_pitch = match_notes(references, predictions, config, ignore_pitch=True,
                              reference_subset=onset_main.unmatched_references,
                              prediction_subset=onset_optional.unmatched_predictions)

    onset_fp = len(onset_optional.unmatched_predictions)
    onset = _prf(len(onset_main.pairs), onset_fp, len(onset_main.unmatched_references))
    onset_offset = _prf(len(full_main.pairs), len(full_optional.unmatched_predictions), len(full_main.unmatched_references))

    pitch_correct = len(onset_main.pairs)
    pitch_pairs = pitch_correct + len(wrong_pitch.pairs)
    octave_errors = sum(1 for r, p in wrong_pitch.pairs
                        if (diff := predictions[p].pitch_midi - references[r].pitch_midi) != 0 and diff % 12 == 0)

    matches = []
    onset_errors: list[float] = []
    offset_errors: list[float] = []
    for r, p in onset_main.pairs:
        reference, prediction = references[r], predictions[p]
        onset_error = (prediction.onset_seconds - reference.onset_seconds) * 1000
        offset_error = None
        if reference.offset_seconds is not None and prediction.offset_seconds is not None:
            offset_error = (prediction.offset_seconds - reference.offset_seconds) * 1000
            offset_errors.append(offset_error)
        onset_errors.append(onset_error)
        matches.append({"referenceIndex": r, "predictionIndex": p, "pitchMidi": reference.pitch_midi,
                        "onsetErrorMs": onset_error, "offsetErrorMs": offset_error})

    matched_refs = {r for r, _ in onset_main.pairs}
    by_technique: dict[str, dict[str, Any]] = {}
    for r in required:
        technique = references[r].technique or NO_TECHNIQUE
        bucket = by_technique.setdefault(technique, {"references": 0, "matched": 0})
        bucket["references"] += 1
        bucket["matched"] += int(r in matched_refs)
    for technique, bucket in by_technique.items():
        bucket["recall"] = _ratio(bucket["matched"], bucket["references"])
        bucket["supportedByDetector"] = technique == NO_TECHNIQUE or technique not in unsupported_techniques

    evaluated_count = len(evaluated)
    return {
        "recordingId": recording_id,
        "durationSeconds": duration_seconds,
        "counts": {
            "references": len(required),
            "optionalReferences": len(optional),
            "predictions": len(predictions),
            "evaluatedPredictions": evaluated_count,
            "ignoredPredictions": ignored,
            "predictionsMatchedToOptional": len(onset_optional.pairs),
        },
        "onset": onset,
        "onsetOffset": onset_offset,
        "pitch": {
            "onsetMatchedPairs": pitch_pairs,
            "correct": pitch_correct,
            "accuracy": _ratio(pitch_correct, pitch_pairs),
            "octaveErrors": octave_errors,
        },
        "onsetErrorMs": _error_stats(onset_errors),
        "offsetErrorMs": _error_stats(offset_errors),
        "openEndedPredictions": sum(1 for i in evaluated if predictions[i].offset_seconds is None),
        "falsePositiveRate": _ratio(onset_fp, evaluated_count),
        "falseDiscoveryRate": _ratio(onset_fp, onset["truePositives"] + onset_fp),
        "missedNoteRate": _ratio(onset["falseNegatives"], len(required)),
        "falsePositivesPerMinute": None if duration_seconds <= 0 else onset_fp / (duration_seconds / 60),
        "byTechnique": dict(sorted(by_technique.items())),
        "matches": matches,
        "unmatchedReferences": [_note_dict(references[i], i, unsupported_techniques) for i in onset_main.unmatched_references],
        "unmatchedPredictions": [_note_dict(predictions[i], i) for i in onset_optional.unmatched_predictions],
    }


def _summarize(results: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    def total(path: tuple[str, ...]) -> int:
        value = 0
        for result in results:
            node: Any = result
            for key in path:
                node = node[key]
            value += node
        return value

    onset = _prf(total(("onset", "truePositives")), total(("onset", "falsePositives")), total(("onset", "falseNegatives")))
    onset_offset = _prf(total(("onsetOffset", "truePositives")), total(("onsetOffset", "falsePositives")), total(("onsetOffset", "falseNegatives")))
    f1_values = [result["onset"]["f1"] for result in results if result["onset"]["f1"] is not None]
    pairs = total(("pitch", "onsetMatchedPairs"))
    correct = total(("pitch", "correct"))
    evaluated = total(("counts", "evaluatedPredictions"))
    references = total(("counts", "references"))
    duration = sum(result["durationSeconds"] for result in results)
    techniques: dict[str, dict[str, Any]] = {}
    for result in results:
        for technique, bucket in result["byTechnique"].items():
            merged = techniques.setdefault(technique, {"references": 0, "matched": 0, "supportedByDetector": bucket["supportedByDetector"]})
            merged["references"] += bucket["references"]
            merged["matched"] += bucket["matched"]
    for bucket in techniques.values():
        bucket["recall"] = _ratio(bucket["matched"], bucket["references"])
    return {
        "recordings": len(results),
        "recordingIds": [result["recordingId"] for result in results],
        "durationSeconds": duration,
        "counts": {key: total(("counts", key)) for key in (
            "references", "optionalReferences", "predictions", "evaluatedPredictions", "ignoredPredictions", "predictionsMatchedToOptional")},
        "onset": onset,
        "onsetOffset": onset_offset,
        "macroOnsetF1": sum(f1_values) / len(f1_values) if f1_values else None,
        "pitch": {"onsetMatchedPairs": pairs, "correct": correct, "accuracy": _ratio(correct, pairs), "octaveErrors": total(("pitch", "octaveErrors"))},
        "onsetErrorMs": _error_stats([m["onsetErrorMs"] for result in results for m in result["matches"]]),
        "offsetErrorMs": _error_stats([m["offsetErrorMs"] for result in results for m in result["matches"] if m["offsetErrorMs"] is not None]),
        "openEndedPredictions": total(("openEndedPredictions",)),
        "falsePositiveRate": _ratio(onset["falsePositives"], evaluated),
        "falseDiscoveryRate": _ratio(onset["falsePositives"], onset["truePositives"] + onset["falsePositives"]),
        "missedNoteRate": _ratio(onset["falseNegatives"], references),
        "falsePositivesPerMinute": None if duration <= 0 else onset["falsePositives"] / (duration / 60),
        "byTechnique": dict(sorted(techniques.items())),
    }


def aggregate(
    results: Sequence[Mapping[str, Any]],
    *,
    scenarios_by_recording: Mapping[str, Sequence[str]],
    scenario_groups: Mapping[str, Collection[str]] | None = None,
) -> dict[str, Any]:
    """Micro-averaged totals: overall, isolated per scenario, overlapping per tag, and per capability.

    See the module docstring for why mixed-scenario recordings are kept out of isolated results.
    """
    ordered = sorted(results, key=lambda result: result["recordingId"])
    tags = {recording_id: sorted(set(values)) for recording_id, values in scenarios_by_recording.items()}

    def tags_of(result: Mapping[str, Any]) -> list[str]:
        return tags.get(result["recordingId"], [])

    scenario_ids = sorted({scenario for values in tags.values() for scenario in values})
    mixed = [result for result in ordered if len(tags_of(result)) > 1]
    by_tag: dict[str, Any] = {}
    for scenario in scenario_ids:
        tagged = [result for result in ordered if scenario in tags_of(result)]
        mixed_ids = [result["recordingId"] for result in tagged if len(tags_of(result)) > 1]
        by_tag[scenario] = {**_summarize(tagged), "mixedRecordingIds": mixed_ids, "overlapsOtherScenarios": bool(mixed_ids)}
    summary: dict[str, Any] = {
        "overall": _summarize(ordered),
        "byScenario": {
            scenario: _summarize([result for result in ordered if tags_of(result) == [scenario]])
            for scenario in scenario_ids
        },
        "mixedScenarioRecordings": [{"recordingId": result["recordingId"], "scenarios": tags_of(result)} for result in mixed],
        "byScenarioTag": by_tag,
    }
    if scenario_groups:
        def group_of(result: Mapping[str, Any]) -> str:
            groups = {group for group, members in scenario_groups.items() if set(tags_of(result)) & set(members)}
            return groups.pop() if len(groups) == 1 else "mixed"

        names = sorted(scenario_groups) + ["mixed"]
        summary["byCapability"] = {name: _summarize([r for r in ordered if group_of(r) == name]) for name in names}
    return summary
