"""Benchmark scenarios and what the current detector family is expected to handle.

"baseline" scenarios are within the heuristic baseline's stated capabilities (it should be judged on
them). "experimental" scenarios involve techniques or conditions the baseline does not model; their
results are reported separately, and misses on notes tagged with an unsupported technique are
labelled as such rather than counted as unexplained pitch-detection failures. Both groups are always
included in the overall numbers: nothing is filtered out.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

Capability = Literal["baseline", "experimental"]


@dataclass(frozen=True)
class Scenario:
    id: str
    title: str
    capability: Capability
    description: str
    known_limitation: str


SCENARIOS: dict[str, Scenario] = {scenario.id: scenario for scenario in (
    Scenario("single-notes", "Single notes", "baseline",
             "Isolated single notes with silence or clear gaps between them.",
             "Pitches outside E2-E6 are never reported."),
    Scenario("chromatic-scales", "Chromatic scales", "baseline",
             "Consecutive semitone steps, picked.",
             "Fast legato runs lose notes without a new attack."),
    Scenario("repeated-notes", "Repeated notes", "baseline",
             "The same pitch re-picked several times.",
             "Re-attacks closer than ~50 ms, or on low strings where the analysis filter is long, can merge."),
    Scenario("sustained-notes", "Sustained notes", "baseline",
             "Long notes held for several seconds.",
             "Notes ringing past the end of the recording get a null offset by design."),
    Scenario("natural-decay", "Natural note decay", "baseline",
             "Notes left to decay naturally without muting.",
             "Offsets of decaying notes are placed where evidence runs out, with low confidence; offset metrics are expected to be weak."),
    Scenario("polyphonic-chords", "Polyphonic chords", "baseline",
             "Chords with notes attacked together (fingerpicked or plucked).",
             "At most six voices; octave doublings, semitone clusters and quiet chord tones are often missed."),
    Scenario("arpeggios", "Arpeggios", "baseline",
             "Chord tones played one after another and left ringing.",
             "Ringing notes overlapping later attacks can be split or merged."),
    Scenario("slides", "Slides", "experimental",
             "Notes reached by sliding along the string.",
             "The baseline does not model slides: target notes without a new attack are usually missed and intermediate pitches may appear."),
    Scenario("hammer-ons-pull-offs", "Hammer-ons and pull-offs", "experimental",
             "Legato notes sounded by the fretting hand.",
             "The baseline relies on attacks; legato notes are frequently missed."),
    Scenario("strumming", "Strumming", "experimental",
             "Chords strummed across strings with staggered onsets.",
             "No strum grouping; staggered string onsets and muted-string noise are not modelled."),
    Scenario("background-noise", "Background noise", "experimental",
             "Playing with room noise, hum or other sources present.",
             "Relative-level thresholds make noise produce spurious candidates; no noise robustness work has been done."),
)}

SCENARIO_IDS: tuple[str, ...] = tuple(SCENARIOS)


def capability_groups() -> dict[str, set[str]]:
    groups: dict[str, set[str]] = {"baseline": set(), "experimental": set()}
    for scenario in SCENARIOS.values():
        groups[scenario.capability].add(scenario.id)
    return groups
