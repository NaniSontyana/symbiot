import os
import sys
from dataclasses import dataclass, field
from typing import List

import numpy as np
import pytest

SERVICE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SERVICE_ROOT not in sys.path:
    sys.path.insert(0, SERVICE_ROOT)

os.environ.setdefault("ASR_SKIP_MODEL_LOAD", "1")

from services.parakeet_eou_engine import StepResult  # noqa: E402

CHUNK_SAMPLES = 1280
CHUNK_BYTES = CHUNK_SAMPLES * 2


@dataclass
class FakeState:
    id: int
    steps: int = 0
    resets: int = 0


@dataclass
class FakeEngine:
    """Drop-in stand-in for ParakeetEOUEngine that replays scripted step results."""

    script: List[StepResult] = field(default_factory=list)
    chunk_samples: int = CHUNK_SAMPLES
    sample_rate: int = 16000
    engine_type: str = "parakeet_realtime_eou_120m-v1"
    model_name: str = "fake"
    device: str = "cpu"
    is_ready: bool = True
    load_error: str = None

    def __post_init__(self):
        self.calls = []  # (state_id, samples)
        self.states = []

    def create_stream_state(self):
        state = FakeState(id=len(self.states))
        self.states.append(state)
        return state

    def reset_stream_state(self, state):
        state.steps = 0
        state.resets += 1

    def step(self, state, samples):
        assert samples.shape == (self.chunk_samples,)
        assert samples.dtype == np.float32
        self.calls.append((state.id, samples))
        state.steps += 1
        if self.script:
            return self.script.pop(0)
        return StepResult(text="", is_eou=False)


class FakeDiarEngine:
    """Same timing as the real engine: 6-frame chunks, released after 7 frames of right context."""

    frame_secs = 0.08
    is_ready = True
    load_error = None
    model_name = "fake-sortformer"
    latency_secs = 1.04

    def __init__(self, speaker_at, chunk_len=6, right_context=7, stalled=False):
        self.speaker_at = speaker_at
        self.chunk_len = chunk_len
        self.right_context = right_context
        self.stalled = stalled
        self.resets = 0

    def create_stream(self):
        return {"samples": 0, "next": 0}

    def reset_stream(self, state):
        state.update(samples=0, next=0)
        self.resets += 1

    def feed(self, state, samples):
        state["samples"] += len(samples)
        out = []
        if self.stalled:
            return out
        while state["samples"] >= (state["next"] * self.chunk_len + self.chunk_len + self.right_context) * CHUNK_SAMPLES:
            first = state["next"] * self.chunk_len
            probs = np.zeros((self.chunk_len, 4), dtype=np.float32)
            for j in range(self.chunk_len):
                spk = self.speaker_at((first + j) * 0.08 + 0.08 / 2)
                if spk is not None:
                    probs[j, spk] = 0.9
            out.append((first, probs))
            state["next"] += 1
        return out


def speech_chunk(amplitude: float = 0.3) -> bytes:
    t = np.arange(CHUNK_SAMPLES) / 16000
    return (amplitude * np.sin(2 * np.pi * 220 * t) * 32767).astype(np.int16).tobytes()


def silence_chunk() -> bytes:
    return np.zeros(CHUNK_SAMPLES, dtype=np.int16).tobytes()


@pytest.fixture
def fake_engine():
    return FakeEngine()
