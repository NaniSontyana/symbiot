"""
Per-connection, per-channel streaming transcription on top of `ParakeetEOUEngine`.

A `ChannelTranscriber` owns every piece of mutable state for one audio channel
(e.g. the interviewer channel of one WebSocket client):

  * a byte re-chunker that turns arbitrarily sized PCM packets into exact
    80 ms model steps,
  * an energy VAD used only to *gate* inference while the channel is idle
    (with a short pre-roll so word onsets are never lost),
  * the model's `StreamState` (caches + partial hypothesis),
  * the text of the utterance currently being spoken.

Utterances are finalised when the model emits its `<EOU>` token. Two safety nets
cover the cases where it does not: a long trailing silence and a maximum
utterance length.
"""

from __future__ import annotations

import logging
import re
import time
from collections import deque
from dataclasses import dataclass
from typing import Callable, Deque, List, Optional

import numpy as np

from services.vad import VoiceActivityDetector

logger = logging.getLogger("asr_transcriber")

_WHITESPACE = re.compile(r"\s+")


@dataclass
class TranscriptEvent:
    text: str
    is_final: bool
    reason: str  # "partial" | "eou" | "silence" | "max_length" | "flush"


@dataclass
class TranscriberConfig:
    preroll_chunks: int = 3  # 240 ms of audio replayed when speech starts
    idle_after_silence_chunks: int = 12  # ~1 s of silence with no text -> stop inference
    force_final_silence_chunks: int = 20  # ~1.6 s of silence with pending text but no <EOU>
    max_utterance_chunks: int = 375  # ~30 s hard cap per utterance
    input_gain: float = 1.0
    emit_partials: bool = True


def _clean(text: str) -> str:
    return _WHITESPACE.sub(" ", text).strip()


class ChannelTranscriber:
    def __init__(
        self,
        engine,
        channel: str,
        config: Optional[TranscriberConfig] = None,
        vad: Optional[VoiceActivityDetector] = None,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.engine = engine
        self.channel = channel
        self.config = config or TranscriberConfig()
        self.vad = vad or VoiceActivityDetector()
        self._clock = clock
        self.last_speech_time: Optional[float] = None  # clock() of the last chunk with voice activity

        self._chunk_bytes = engine.chunk_samples * 2  # int16
        self._pending = bytearray()
        self._preroll: Deque[np.ndarray] = deque(maxlen=max(self.config.preroll_chunks, 0) or None)
        self._state = None  # created lazily so idle channels cost nothing

        self._active = False
        self._utterance_raw = ""
        self._last_partial = ""
        self._silence_run = 0
        self._utterance_chunks = 0

    # ---------------------------------------------------------------- public
    def feed(self, pcm_bytes: bytes) -> List[TranscriptEvent]:
        """Consume Int16 little-endian 16 kHz mono PCM. Returns transcript events."""
        events: List[TranscriptEvent] = []
        if not pcm_bytes:
            return events
        self._pending.extend(pcm_bytes)

        while len(self._pending) >= self._chunk_bytes:
            chunk = bytes(self._pending[: self._chunk_bytes])
            del self._pending[: self._chunk_bytes]
            events.extend(self._process_chunk(chunk))
        return events

    def flush(self) -> List[TranscriptEvent]:
        """Finalise whatever has been recognised so far (e.g. on disconnect)."""
        events: List[TranscriptEvent] = []
        self._finalize(events, "flush")
        return events

    def reset(self) -> None:
        """Drop all buffered audio, text and model state for this channel."""
        self._pending.clear()
        self._preroll.clear()
        self._go_idle()

    @property
    def is_active(self) -> bool:
        return self._active

    # -------------------------------------------------------------- internals
    def _process_chunk(self, chunk: bytes) -> List[TranscriptEvent]:
        events: List[TranscriptEvent] = []
        has_speech = self.vad.is_speech(chunk)
        if has_speech:
            self.last_speech_time = self._clock()
        samples = np.frombuffer(chunk, dtype=np.int16).astype(np.float32) / 32768.0
        if self.config.input_gain != 1.0:
            samples = np.clip(samples * self.config.input_gain, -1.0, 1.0)

        if not self._active:
            if not has_speech:
                if self._preroll.maxlen:
                    self._preroll.append(samples)
                return events
            # Speech onset: wake the model and replay the pre-roll for context.
            self._active = True
            self._silence_run = 0
            self._utterance_chunks = 0
            if self._state is None:
                self._state = self.engine.create_stream_state()
            backlog = list(self._preroll)
            self._preroll.clear()
            for past in backlog:
                if self._run_step(past, events):
                    return events

        self._silence_run = 0 if has_speech else self._silence_run + 1
        if self._run_step(samples, events):
            return events

        if self._utterance_raw.strip():
            if self._silence_run >= self.config.force_final_silence_chunks:
                self._finalize(events, "silence")
            elif self._utterance_chunks >= self.config.max_utterance_chunks:
                self._finalize(events, "max_length")
        elif self._silence_run >= self.config.idle_after_silence_chunks or (
            self._utterance_chunks >= self.config.max_utterance_chunks
        ):
            # Noise burst that produced no words: stop spending CPU on it.
            self._go_idle()
        return events

    def _run_step(self, samples: np.ndarray, events: List[TranscriptEvent]) -> bool:
        """Run one model step. Returns True if the utterance was finalised."""
        result = self.engine.step(self._state, samples)
        self._utterance_chunks += 1
        if result.text:
            self._utterance_raw += result.text
            partial = _clean(self._utterance_raw)
            if self.config.emit_partials and partial and partial != self._last_partial and not result.is_eou:
                events.append(TranscriptEvent(text=partial, is_final=False, reason="partial"))
            self._last_partial = partial
        if result.is_eou:
            self._finalize(events, "eou")
            return True
        return False

    def _finalize(self, events: List[TranscriptEvent], reason: str) -> None:
        text = _clean(self._utterance_raw)
        if text:
            events.append(TranscriptEvent(text=text, is_final=True, reason=reason))
            logger.info("[ASR %s] final (%s): %r", self.channel, reason, text)
        self._go_idle()

    def _go_idle(self) -> None:
        self._active = False
        self._utterance_raw = ""
        self._last_partial = ""
        self._silence_run = 0
        self._utterance_chunks = 0
        self.vad.reset()
        if self._state is not None:
            self.engine.reset_stream_state(self._state)
