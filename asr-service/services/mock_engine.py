"""
Speech-free simulation engine with the exact streaming interface of
`ParakeetEOUEngine`.

Enabled with `ASR_ENGINE=mock` (or `ASR_MOCK=1`). It replays a scripted
interviewer conversation word-by-word with realistic streaming pacing and
`<EOU>` turn boundaries, so the whole pipeline — VAD gating, turn manager,
copilot WebSocket, and the overlay UI — can be developed and demoed on any
machine without GPU models or network access.

The engine never inspects the audio content: one word is emitted every
`chunks_per_word` model steps. A step only runs when the VAD saw speech
energy, so the script effectively advances while someone (or some audio) is
playing and pauses naturally on silence.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import List, Optional

from services.parakeet_eou_engine import StepResult

logger = logging.getLogger("mock_asr_engine")

DEFAULT_MOCK_MODEL = "mock/parakeet-simulator"

# Scripted interviewer turns, replayed in order on every stream. The topics
# line up with the gateway's offline copilot knowledge base so a no-GPU,
# no-API-key demo still produces strong answers.
DEFAULT_SCRIPT: List[str] = [
    "Can you walk me through how React reconciliation and the virtual DOM work under the hood?",
    "How do WebSockets differ from HTTP long-polling in terms of latency and server load?",
    "What is the practical difference between a HashMap and a tree-based map?",
    "How would you design a scalable WebSocket architecture for thousands of concurrent users?",
    "Explain how you would optimize a slow PostgreSQL query that filters on a vector column?",
    "How does FastAPI achieve asynchronous non-blocking performance with Python asyncio?",
    "Tell me about a challenging project where you handled real-time data streaming.",
    "How do you prevent unnecessary component re-renders in a large React application?",
]

_CHUNKS_PER_WORD = 3  # ~240 ms per word at 80 ms model steps (natural speaking pace)
# ~12 s of stream time between turns: a real interviewer waits for the answer,
# and the gap lets the copilot finish streaming before the next question.
_GAP_AFTER_QUESTION = 150


@dataclass
class MockStreamState:
    """Per-stream playback position inside the scripted conversation."""

    script_index: int = 0
    word_index: int = 0
    pending_words: List[str] = field(default_factory=list)
    counter: int = 0  # steps since emission window opened
    pausing: int = 0  # remaining pause steps between turns
    steps: int = 0


class MockParakeetEngine:
    """Drop-in replacement for `ParakeetEOUEngine` used in demos and tests."""

    engine_type = "mock_parakeet_simulator"

    def __init__(
        self,
        model_name: str = DEFAULT_MOCK_MODEL,
        device: Optional[str] = "cpu",
        chunk_size_in_secs: float = 0.08,
        sample_rate: int = 16000,
        script: Optional[List[str]] = None,
    ):
        self.model_name = model_name
        self.device = device
        self.chunk_size_in_secs = chunk_size_in_secs
        self.sample_rate = sample_rate
        self.chunk_samples = int(round(chunk_size_in_secs * sample_rate))
        self.script = list(script) if script else list(DEFAULT_SCRIPT)

        self.is_ready = False
        self.load_error: Optional[str] = None

    # ------------------------------------------------------------------ loading
    def load(self) -> None:
        self.is_ready = True
        logger.info("[Mock ASR] Simulation engine ready (%d scripted interviewer turns)", len(self.script))

    # ---------------------------------------------------------------- streaming
    def create_stream_state(self) -> MockStreamState:
        return MockStreamState()

    def reset_stream_state(self, state: MockStreamState) -> None:
        # Keep script_index so the conversation continues across utterances.
        state.pending_words = []
        state.word_index = 0
        state.counter = 0
        state.pausing = 0
        state.steps = 0

    def step(self, state: MockStreamState, _samples) -> StepResult:
        state.steps += 1

        # Between-question breathing room.
        if state.pausing > 0:
            state.pausing -= 1
            return StepResult(text="", is_eou=False)

        # Load the next scripted turn once the previous one finished.
        if not state.pending_words:
            if not self.script:
                return StepResult(text="", is_eou=False)
            turn = self.script[state.script_index % len(self.script)]
            state.script_index += 1
            state.pending_words = turn.split()
            state.word_index = 0
            state.counter = 0

        # Emit one word every few 80 ms steps for natural pacing.
        state.counter += 1
        if state.counter % _CHUNKS_PER_WORD != 0:
            return StepResult(text="", is_eou=False)

        if state.word_index < len(state.pending_words):
            word = state.pending_words[state.word_index]
            state.word_index += 1
            if state.word_index >= len(state.pending_words):
                # Last word delivered: close the utterance like <EOU> does.
                state.pending_words = []
                state.pausing = _GAP_AFTER_QUESTION
                return StepResult(text=f" {word}", is_eou=True)
            return StepResult(text=f" {word}", is_eou=False)

        return StepResult(text="", is_eou=False)
