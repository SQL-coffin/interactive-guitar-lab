"""Event matching: pure functions, no audio, no worker imports."""
from __future__ import annotations

import unittest

from guitar_eval.matching import MatchConfig, Note, match_notes


def ref(pitch: int, onset: float, offset: float | None = None, **extra: object) -> Note:
    return Note(pitch_midi=pitch, onset_seconds=onset, offset_seconds=offset, **extra)  # type: ignore[arg-type]


pred = ref


class OnsetMatchingTests(unittest.TestCase):
    def test_exact_match(self) -> None:
        result = match_notes([ref(60, 1.0, 2.0)], [pred(60, 1.0, 2.0)], MatchConfig())
        self.assertEqual(result.pairs, [(0, 0)])
        self.assertEqual(result.unmatched_references, [])
        self.assertEqual(result.unmatched_predictions, [])

    def test_pitch_mismatch_does_not_match_unless_pitch_is_ignored(self) -> None:
        result = match_notes([ref(60, 1.0)], [pred(61, 1.0)], MatchConfig())
        self.assertEqual(result.pairs, [])
        self.assertEqual(result.unmatched_references, [0])
        self.assertEqual(result.unmatched_predictions, [0])
        agnostic = match_notes([ref(60, 1.0)], [pred(72, 1.0)], MatchConfig(), ignore_pitch=True)
        self.assertEqual(agnostic.pairs, [(0, 0)])

    def test_pitch_tolerance_is_configurable(self) -> None:
        self.assertEqual(match_notes([ref(60, 1.0)], [pred(61, 1.0)], MatchConfig(pitch_tolerance_semitones=1)).pairs, [(0, 0)])

    def test_onset_tolerance_boundary_is_inclusive(self) -> None:
        config = MatchConfig(onset_tolerance_seconds=0.05)
        self.assertEqual(match_notes([ref(60, 1.0)], [pred(60, 1.05)], config).pairs, [(0, 0)])
        self.assertEqual(match_notes([ref(60, 1.0)], [pred(60, 0.95)], config).pairs, [(0, 0)])
        self.assertEqual(match_notes([ref(60, 1.0)], [pred(60, 1.0501)], config).pairs, [])
        self.assertEqual(match_notes([ref(60, 1.0)], [pred(60, 1.02)], MatchConfig(onset_tolerance_seconds=0.01)).pairs, [])

    def test_duplicate_predictions_match_only_once(self) -> None:
        result = match_notes([ref(60, 1.0)], [pred(60, 1.01), pred(60, 1.0), pred(60, 1.03)], MatchConfig())
        # The closest prediction wins; the rest are unmatched (false positives).
        self.assertEqual(result.pairs, [(0, 1)])
        self.assertEqual(result.unmatched_predictions, [0, 2])

    def test_one_prediction_cannot_match_two_references(self) -> None:
        result = match_notes([ref(60, 1.0), ref(60, 1.02)], [pred(60, 1.01)], MatchConfig())
        self.assertEqual(len(result.pairs), 1)
        self.assertEqual(len(result.unmatched_references), 1)

    def test_matching_maximises_matches_instead_of_greedy_nearest(self) -> None:
        # Greedy nearest would pair ref0 with pred1 (distance 0.01) and leave ref1 unmatched.
        refs = [ref(60, 1.00), ref(60, 1.06)]
        preds = [pred(60, 0.96), pred(60, 1.01)]
        result = match_notes(refs, preds, MatchConfig())
        self.assertEqual(sorted(result.pairs), [(0, 0), (1, 1)])

    def test_missing_predictions_and_empty_inputs(self) -> None:
        result = match_notes([ref(60, 1.0), ref(64, 2.0)], [], MatchConfig())
        self.assertEqual(result.unmatched_references, [0, 1])
        empty = match_notes([], [], MatchConfig())
        self.assertEqual((empty.pairs, empty.unmatched_references, empty.unmatched_predictions), ([], [], []))

    def test_overlapping_notes_of_different_pitches_match_independently(self) -> None:
        refs = [ref(52, 0.5, 2.0), ref(59, 0.5, 2.0), ref(64, 0.52, 2.0)]
        preds = [pred(64, 0.53, 1.9), pred(52, 0.49, 2.1), pred(59, 0.51, 1.95)]
        result = match_notes(refs, preds, MatchConfig())
        self.assertEqual(sorted(result.pairs), [(0, 1), (1, 2), (2, 0)])

    def test_result_is_independent_of_input_order(self) -> None:
        refs = [ref(60, 1.0), ref(60, 1.04), ref(62, 1.0)]
        preds = [pred(60, 1.02), pred(62, 1.01), pred(60, 1.05)]
        forward = match_notes(refs, preds, MatchConfig())
        mapping = {(refs[r].onset_seconds, refs[r].pitch_midi): (preds[p].onset_seconds, preds[p].pitch_midi) for r, p in forward.pairs}
        rev_refs, rev_preds = refs[::-1], preds[::-1]
        backward = match_notes(rev_refs, rev_preds, MatchConfig())
        mapping_back = {(rev_refs[r].onset_seconds, rev_refs[r].pitch_midi): (rev_preds[p].onset_seconds, rev_preds[p].pitch_midi) for r, p in backward.pairs}
        self.assertEqual(mapping, mapping_back)


class OffsetMatchingTests(unittest.TestCase):
    def test_offset_tolerance_uses_max_of_minimum_and_ratio_of_duration(self) -> None:
        config = MatchConfig(offset_ratio=0.2, offset_min_tolerance_seconds=0.05)
        # 2 s note -> 0.4 s tolerance.
        self.assertEqual(match_notes([ref(60, 1.0, 3.0)], [pred(60, 1.0, 3.39)], config, require_offset=True).pairs, [(0, 0)])
        self.assertEqual(match_notes([ref(60, 1.0, 3.0)], [pred(60, 1.0, 3.41)], config, require_offset=True).pairs, [])
        # 0.1 s note -> minimum 0.05 s tolerance applies.
        self.assertEqual(match_notes([ref(60, 1.0, 1.1)], [pred(60, 1.0, 1.15)], config, require_offset=True).pairs, [(0, 0)])
        self.assertEqual(match_notes([ref(60, 1.0, 1.1)], [pred(60, 1.0, 1.16)], config, require_offset=True).pairs, [])

    def test_open_ended_prediction_policies(self) -> None:
        refs, preds = [ref(60, 1.0, 3.0)], [pred(60, 1.0, None)]
        self.assertEqual(match_notes(refs, preds, MatchConfig(), require_offset=True).pairs, [])
        self.assertEqual(match_notes(refs, preds, MatchConfig(open_ended_prediction_policy="ignore-offset"), require_offset=True).pairs, [(0, 0)])
        extend = MatchConfig(open_ended_prediction_policy="extend-to-audio-end")
        self.assertEqual(match_notes(refs, preds, extend, require_offset=True, audio_duration_seconds=3.1).pairs, [(0, 0)])
        self.assertEqual(match_notes(refs, preds, extend, require_offset=True, audio_duration_seconds=5.0).pairs, [])

    def test_reference_with_unknown_offset_is_matched_on_onset_only(self) -> None:
        result = match_notes([ref(60, 1.0, None)], [pred(60, 1.0, 1.5)], MatchConfig(), require_offset=True)
        self.assertEqual(result.pairs, [(0, 0)])

    def test_rejects_invalid_configuration(self) -> None:
        for kwargs in ({"onset_tolerance_seconds": -1}, {"offset_ratio": -0.1}, {"open_ended_prediction_policy": "guess"}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                MatchConfig(**kwargs)  # type: ignore[arg-type]
        with self.assertRaises(ValueError):
            match_notes([ref(60, 1.0, 3.0)], [pred(60, 1.0, None)], MatchConfig(open_ended_prediction_policy="extend-to-audio-end"), require_offset=True)


if __name__ == "__main__":
    unittest.main()
