"""Synthesize deterministic reference progressions for integration tests.

These are additive-sine "piano-like" tones with a decaying envelope: a controlled
reference, NOT a guitar recording. Each chord lasts 2 s; with 1 s analysis windows every
chord spans exactly two windows. Run with the audio-worker virtualenv (numpy, soundfile):

    python e2e/synth_progressions.py e2e/fixtures/out
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

SAMPLE_RATE = 22_050
CHORD_SECONDS = 2.0

# name -> list of (expected symbol, bass MIDI, upper-voice MIDI notes)
PROGRESSIONS: dict[str, list[tuple[str, int, list[int]]]] = {
    "pop-I-V-vi-IV-C": [
        ("C", 48, [52, 55, 60, 64]),
        ("G", 43, [47, 50, 55, 59]),
        ("Am", 45, [52, 57, 60, 64]),
        ("F", 41, [48, 53, 57, 60]),
    ],
    # F#m7 shares A-C#-E with A major; only the bass and the F# separate them.
    "A-F#m7-D-E": [
        ("A", 45, [52, 57, 61, 64]),
        ("F#m7", 42, [49, 52, 57, 61, 66]),
        ("D", 50, [54, 57, 62, 66]),
        ("E", 40, [47, 52, 56, 59]),
    ],
    "ii-V-I-sevenths-C": [
        ("Dm7", 50, [53, 57, 60, 65]),
        ("G7", 43, [50, 53, 59, 62]),
        ("CMaj7", 48, [52, 55, 59, 64]),
        ("Am7", 45, [52, 55, 60, 64]),
    ],
    "minor-Em-C-G-D": [
        ("Em", 40, [47, 52, 55, 59]),
        ("C", 48, [52, 55, 60, 64]),
        ("G", 43, [47, 50, 55, 59]),
        ("D", 50, [54, 57, 62, 66]),
    ],
    "sus4-resolution-D": [
        ("Dsus4", 50, [55, 57, 62, 67]),
        ("D", 50, [54, 57, 62, 66]),
        ("Asus4", 45, [52, 57, 62, 64]),
        ("A", 45, [52, 57, 61, 64]),
    ],
}


def tone(midi: int, seconds: float, gain: float) -> np.ndarray:
    t = np.arange(int(SAMPLE_RATE * seconds)) / SAMPLE_RATE
    freq = 440.0 * 2 ** ((midi - 69) / 12)
    # Fundamental plus two soft partials so chroma is not a pure-sine idealization.
    wave = np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(4 * np.pi * freq * t) + 0.15 * np.sin(6 * np.pi * freq * t)
    return gain * wave * np.exp(-t * 1.1)


def render(chords: list[tuple[str, int, list[int]]]) -> np.ndarray:
    parts = []
    for _, bass, upper in chords:
        mix = tone(bass, CHORD_SECONDS, 1.0) + sum(tone(m, CHORD_SECONDS, 0.55) for m in upper)
        parts.append(mix)
    audio = np.concatenate(parts)
    return (audio / (np.max(np.abs(audio)) * 1.25)).astype(np.float32)


def main(out_dir: str) -> None:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for name, chords in PROGRESSIONS.items():
        path = out / f"{name}.wav"
        sf.write(path, render(chords), SAMPLE_RATE)
        manifest[name] = {"file": path.name, "chordSeconds": CHORD_SECONDS, "expected": [c[0] for c in chords]}
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"wrote {len(manifest)} progressions to {out}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "e2e/fixtures/out")
