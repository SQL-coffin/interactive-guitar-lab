"""Human-readable Markdown report rendered from the JSON results (no extra computation)."""
from __future__ import annotations

from typing import Any

MAX_LISTED_ERRORS = 20


def _pct(value: float | None) -> str:
    return "n/a" if value is None else f"{value * 100:.1f}%"


def _ms(value: float | None) -> str:
    return "n/a" if value is None else f"{value:.1f}"


def _prf_row(label: str, group: dict[str, Any], key: str = "onset") -> str:
    prf = group[key]
    return (f"| {label} | {group['recordings']} | {prf['truePositives']} | {prf['falsePositives']} | {prf['falseNegatives']} "
            f"| {_pct(prf['precision'])} | {_pct(prf['recall'])} | {_pct(prf['f1'])} | {_pct(group['onsetOffset']['f1'])} "
            f"| {_pct(group['pitch']['accuracy'])} |")


PRF_HEADER = ("| Group | Recordings | TP | FP | FN | Precision | Recall | F1 (onset) | F1 (onset+offset) | Pitch accuracy |\n"
              "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |")


def render_markdown(results: dict[str, Any]) -> str:
    dataset, detector, config = results["dataset"], results["detector"], results["matchConfig"]
    overall = results["summary"]["overall"]
    lines = [
        f"# Note-event benchmark: {detector['name']} {detector['version']} on {dataset['id']} {dataset['version']}",
        "",
    ]
    if not results["realWorldEvidence"]:
        lines += [
            "> **No real guitar recordings were evaluated.** Every recording in this run is synthetic. These numbers check",
            "> that the benchmark pipeline works; they say nothing about accuracy on real guitar playing.",
            "",
        ]
    else:
        lines += [
            f"> Real recordings: {dataset['realRecordings']}; synthetic: {dataset['syntheticRecordings']}. "
            "Results generalise only as far as this dataset represents the playing you care about.",
            "",
        ]
    lines += [
        "## Run",
        "",
        f"- Dataset: `{dataset['id']}` version `{dataset['version']}`, split `{dataset['split'] or 'all'}`, "
        f"manifest SHA-256 `{dataset['manifestSha256'][:16]}…`, licence: {dataset['license']}",
        f"- Detector: `{detector['name']}` `{detector['version']}` (source: {detector['source']}, calibrated confidences: "
        f"{'yes' if detector['calibrated'] else 'no'})",
        f"- Matching: pitch within {config['pitchToleranceSemitones']} semitone(s); onset within ±{config['onsetToleranceSeconds'] * 1000:g} ms; "
        f"offset within max({config['offsetMinToleranceSeconds'] * 1000:g} ms, {config['offsetRatio']:g} × reference duration); "
        f"open-ended predictions: `{config['openEndedPredictionPolicy']}`; references with annotationConfidence < "
        f"{config['minReferenceConfidence']:g} are optional.",
        "",
        "## Overall",
        "",
        PRF_HEADER,
        _prf_row("All recordings", overall),
    ]
    for group_name, group in results["summary"].get("byCapability", {}).items():
        if group["recordings"]:
            lines.append(_prf_row(f"{group_name.capitalize()} scenarios", group))
    fp_per_minute = overall["falsePositivesPerMinute"]
    lines += [
        "",
        f"- Macro onset F1 (mean over recordings with defined F1): {_pct(overall['macroOnsetF1'])}",
        f"- False positive rate (FP / predictions): {_pct(overall['falsePositiveRate'])}; "
        f"false positives per minute: {'n/a' if fp_per_minute is None else format(fp_per_minute, '.1f')}",
        f"- Missed note rate (FN / references): {_pct(overall['missedNoteRate'])}",
        f"- Octave errors (pitch-agnostic onset matches): {overall['pitch']['octaveErrors']}",
        f"- Open-ended predictions (null offset): {overall['openEndedPredictions']}",
        f"- Ignored predictions outside partially annotated regions: {overall['counts']['ignoredPredictions']}; "
        f"optional references: {overall['counts']['optionalReferences']}",
        "",
        "| Timing error (ms, prediction − reference) | Count | Mean abs | Median abs | P95 abs | Max abs | Mean signed |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for label, key in (("Onset", "onsetErrorMs"), ("Offset", "offsetErrorMs")):
        stats = overall[key]
        lines.append(f"| {label} | {stats['count']} | {_ms(stats['meanAbsolute'])} | {_ms(stats['medianAbsolute'])} "
                     f"| {_ms(stats['p95Absolute'])} | {_ms(stats['maxAbsolute'])} | {_ms(stats['meanSigned'])} |")

    lines += ["", "## By scenario", "", PRF_HEADER.replace("| Group |", "| Scenario (capability) |")]
    for scenario_id, group in results["summary"]["byScenario"].items():
        scenario = results["scenarios"][scenario_id]
        lines.append(_prf_row(f"{scenario['title']} ({scenario['capability']})", group))

    techniques = overall["byTechnique"]
    if techniques:
        lines += ["", "## Recall by annotated technique", "",
                  "| Technique | Supported by detector | References | Matched | Recall |", "| --- | --- | ---: | ---: | ---: |"]
        for technique, bucket in techniques.items():
            lines.append(f"| {technique} | {'yes' if bucket['supportedByDetector'] else '**no**'} | {bucket['references']} "
                         f"| {bucket['matched']} | {_pct(bucket['recall'])} |")
        lines += ["", "Misses on techniques the detector does not support reflect a known limitation, not an unexplained "
                  "pitch-detection failure. They are still counted in every total above."]

    lines += ["", "## Per recording", "",
              "| Recording | Source | Scenarios | Refs | Preds | TP | FP | FN | F1 (onset) | Pitch acc. | Onset MAE (ms) |",
              "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"]
    for recording in results["recordings"]:
        onset = recording["onset"]
        lines.append(
            f"| {recording['recordingId']} | {recording['source']} | {', '.join(recording['scenarios'])} | {recording['counts']['references']} "
            f"| {recording['counts']['evaluatedPredictions']} | {onset['truePositives']} | {onset['falsePositives']} | {onset['falseNegatives']} "
            f"| {_pct(onset['f1'])} | {_pct(recording['pitch']['accuracy'])} | {_ms(recording['onsetErrorMs']['meanAbsolute'])} |")

    lines += ["", "## Missed notes and false positives", ""]
    any_errors = False
    for recording in results["recordings"]:
        missed, extra = recording["unmatchedReferences"], recording["unmatchedPredictions"]
        if not missed and not extra:
            continue
        any_errors = True
        lines.append(f"### {recording['recordingId']}")
        lines.append("")
        for label, items in (("Missed (reference without a match)", missed), ("False positive (prediction without a match)", extra)):
            if not items:
                continue
            shown = items[:MAX_LISTED_ERRORS]
            rendered = []
            for item in shown:
                offset = "open" if item["offsetSeconds"] is None else f"{item['offsetSeconds']:.3f}"
                text = f"MIDI {item['pitchMidi']} @ {item['onsetSeconds']:.3f}–{offset} s"
                if item.get("technique"):
                    text += f" [{item['technique']}{', unsupported' if item.get('unsupportedTechnique') else ''}]"
                rendered.append(text)
            more = f" … and {len(items) - len(shown)} more (see JSON)" if len(items) > len(shown) else ""
            lines.append(f"- {label}: {'; '.join(rendered)}{more}")
        lines.append("")
    if not any_errors:
        lines.append("None.")
        lines.append("")

    lines += ["## Known limitations", "",
              "- Scores are only as good as the annotations. Partial annotations and low-confidence notes are handled as described in `evaluation/README.md`, not hidden.",
              "- Detector confidences are not used for matching; precision/recall reflect the detector's own thresholds.",
              "- Timing tolerances are configurable; results are not comparable across runs with different settings.",
              ]
    for scenario_id in results["summary"]["byScenario"]:
        scenario = results["scenarios"][scenario_id]
        lines.append(f"- {scenario['title']} ({scenario['capability']}): {scenario['knownLimitation']}")
    return "\n".join(lines) + "\n"
