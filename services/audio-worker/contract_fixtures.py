"""Generate cross-language contract fixtures from the real worker endpoints.

Each fixture is the JSON body the worker actually returns for a deterministic synthetic WAV,
captured in-process through FastAPI's TestClient (no running server). The TypeScript test
`packages/audio-analysis/src/worker-contract.test.ts` feeds these bodies through the TS client's
runtime validators, so a Python response shape the TS side would reject fails CI.

    python contract_fixtures.py [OUTPUT_DIR]   # default: ../../contracts/audio-worker

Committed fixtures are checked for drift by test_contract_fixtures.py. Regenerate them with the
command above after an intentional contract change.

These are synthetic tones for contract testing only, not evidence of transcription accuracy.
"""
from __future__ import annotations

import io
import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient

from app import app

SAMPLE_RATE = 22_050
DEFAULT_OUTPUT = Path(__file__).resolve().parents[2] / "contracts" / "audio-worker"


def _tone(midi: int, start: float, end: float, total: float) -> np.ndarray:
    times = np.arange(int(total * SAMPLE_RATE)) / SAMPLE_RATE
    frequency = 440.0 * 2 ** ((midi - 69) / 12)
    envelope = np.zeros_like(times)
    sounding = (times >= start) & (times < end)
    envelope[sounding] = np.minimum(1.0, (times[sounding] - start) / 0.005)
    return 0.3 * np.sin(2 * math.pi * frequency * times) * envelope


def _wav(samples: np.ndarray) -> bytes:
    stream = io.BytesIO()
    sf.write(stream, np.clip(samples, -1.0, 1.0).astype(np.float32), SAMPLE_RATE, format="WAV")
    return stream.getvalue()


def _cases() -> dict[str, bytes]:
    return {
        "silence": _wav(np.zeros(SAMPLE_RATE * 2)),
        "single-tone": _wav(_tone(69, 0.5, 2.0, 3.0)),
        # The upper note is still sounding at the end, so its offset must be null.
        "overlapping-open-ended": _wav(_tone(57, 0.2, 1.8, 3.0) + _tone(64, 0.9, 5.0, 3.0)),
    }


def generate() -> dict[str, Any]:
    fixtures: dict[str, Any] = {}
    with TestClient(app) as client:
        for name, wav in _cases().items():
            files = {"file": (f"{name}.wav", wav, "audio/wav")}
            responses = {
                f"note-events.{name}": client.post("/v1/features/note-events", files=files),
                f"chroma-default.{name}": client.post("/v1/features/chroma", files=files),
                f"chroma-with-note-events.{name}": client.post(
                    "/v1/features/chroma", files=files, data={"includeNoteEvents": "true"},
                ),
            }
            for key, response in responses.items():
                if response.status_code != 200:
                    raise RuntimeError(f"{key} returned HTTP {response.status_code}: {response.text}")
                fixtures[key] = response.json()
    return fixtures


def write(output: Path) -> list[Path]:
    output.mkdir(parents=True, exist_ok=True)
    written = []
    for key, body in sorted(generate().items()):
        path = output / f"{key}.json"
        path.write_text(json.dumps(body, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        written.append(path)
    return written


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUTPUT
    for written_path in write(target):
        print(written_path)
