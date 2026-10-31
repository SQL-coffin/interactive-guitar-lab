"""Command line: python -m guitar_eval {validate,run,make-synthetic} ...  (run from evaluation/)."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .datasets import DatasetError, load_dataset
from .matching import OPEN_ENDED_POLICIES, MatchConfig
from .report import render_markdown


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m guitar_eval", description="Note-event detection benchmark.")
    commands = parser.add_subparsers(dest="command", required=True)

    validate = commands.add_parser("validate", help="Validate a dataset manifest, checksums and annotations.")
    validate.add_argument("dataset", type=Path)
    validate.add_argument("--skip-audio-check", action="store_true", help="Do not open audio files to check rate/duration.")

    run = commands.add_parser("run", help="Run a detector on a dataset and write results.json + report.md.")
    run.add_argument("dataset", type=Path)
    run.add_argument("--split", default=None, help="Evaluate one split (default: all recordings).")
    run.add_argument("--detector", default="heuristic", help="'heuristic' or 'module:attribute' implementing NoteEventModel.")
    run.add_argument("--predictions", type=Path, default=None, help="Evaluate precomputed <recordingId>.json files instead.")
    run.add_argument("--detector-name", default="precomputed", help="Name recorded for --predictions.")
    run.add_argument("--detector-version", default="unknown", help="Version recorded for --predictions.")
    run.add_argument("--output", type=Path, required=True, help="Directory for results.json and report.md.")
    defaults = MatchConfig()
    run.add_argument("--onset-tolerance", type=float, default=defaults.onset_tolerance_seconds, help="Seconds (default 0.05).")
    run.add_argument("--pitch-tolerance", type=int, default=defaults.pitch_tolerance_semitones, help="Semitones (default 0).")
    run.add_argument("--offset-ratio", type=float, default=defaults.offset_ratio, help="Fraction of reference duration (default 0.2).")
    run.add_argument("--offset-min-tolerance", type=float, default=defaults.offset_min_tolerance_seconds, help="Seconds (default 0.05).")
    run.add_argument("--open-ended-policy", choices=OPEN_ENDED_POLICIES, default=defaults.open_ended_prediction_policy)
    run.add_argument("--min-reference-confidence", type=float, default=defaults.min_reference_confidence)

    synthetic = commands.add_parser("make-synthetic", help="Write the deterministic synthetic smoke-test dataset.")
    synthetic.add_argument("output", type=Path)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.command == "make-synthetic":
        from .synthetic import write_synthetic_dataset
        print(write_synthetic_dataset(args.output))
        return 0
    try:
        dataset = load_dataset(args.dataset, verify_audio=not getattr(args, "skip_audio_check", False))
    except DatasetError as exc:
        print(f"Dataset is invalid ({len(exc.errors)} problem(s)):", file=sys.stderr)
        for error in exc.errors:
            print(f"  - {error}", file=sys.stderr)
        return 2
    if args.command == "validate":
        print(f"OK: {dataset.dataset_id} {dataset.version}, {len(dataset.recordings)} recording(s), "
              f"splits: {', '.join(f'{k}={len(v)}' for k, v in sorted(dataset.splits.items()))}")
        return 0

    from .detectors import load_detector, predictions_detector
    from .runner import run_benchmark

    config = MatchConfig(
        onset_tolerance_seconds=args.onset_tolerance, pitch_tolerance_semitones=args.pitch_tolerance,
        offset_ratio=args.offset_ratio, offset_min_tolerance_seconds=args.offset_min_tolerance,
        open_ended_prediction_policy=args.open_ended_policy, min_reference_confidence=args.min_reference_confidence,
    )
    detector = (predictions_detector(args.predictions, args.detector_name, args.detector_version)
                if args.predictions else load_detector(args.detector))
    results = run_benchmark(dataset, detector, config, split=args.split)
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "results.json").write_text(json.dumps(results, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    (args.output / "report.md").write_text(render_markdown(results), encoding="utf-8")
    overall = results["summary"]["overall"]["onset"]
    print(f"{results['detector']['name']} on {dataset.dataset_id} {dataset.version}: "
          f"P={overall['precision']} R={overall['recall']} F1={overall['f1']} -> {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
