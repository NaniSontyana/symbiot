"""
Speaker attribution for mic-only mode: one microphone hears both the interviewer
and the candidate, so speech is labelled by *voice* (Streaming Sortformer) instead
of by audio source.

    mic PCM ──► ChannelTranscriber (Parakeet EOU) ──► words + decode times ─┐
           └──► SortformerDiarEngine ──► per-80 ms speaker activity ───────┴─► DiarizedTranscriber
                                                                              │
                         speaker-labelled partials / finals ◄─────────────────┘

Why not just label each ASR utterance with its majority speaker (as NVIDIA's voice
agent does)? Because in interviews the candidate often starts answering right after
the question with no pause, so one ASR utterance can contain both voices. Every word
gets a speaker from the diarization frames around the time it was spoken. When the
voice changes and the new voice keeps going (`min_switch_secs`), the utterance is
split at that word and the first part is finalised immediately (reason
"speaker_change"). The rest stays open under the new speaker.

Diarization trails the audio by about 1 s (chunk + right context). So:
  * partials are only emitted once their speaker is known, so early text never shows
    up under the wrong speaker;
  * finals are held until diarization covers their last word (at most
    `max_final_hold_secs`).

Speaker slots are arrival-ordered (slot 0 = first voice heard). `SpeakerRoles` maps
slots to interviewer / applicant and can be corrected live by the user.

With `threaded=True` (used by the server) diarization runs on its own worker thread,
so a slow diarizer never delays transcription. If it falls more than `max_lag_secs`
behind, the stream is marked `degraded`; the server then tells the client to fall
back to the manual speaker toggle rather than show wrong labels.
"""

from __future__ import annotations

import logging
import math
import threading
from collections import Counter
from dataclasses import dataclass
from typing import List, Optional, Sequence, Tuple

import numpy as np

logger = logging.getLogger("speaker_attribution")


# --------------------------------------------------------------------- timeline
class SpeakerTimeline:
    """Dominant speaker per diarization frame (None = nobody speaking)."""

    def __init__(self, frame_secs: float = 0.08, threshold: float = 0.5, max_frames: int = 6000):
        self.frame_secs = frame_secs
        self.threshold = threshold
        self.max_frames = max_frames  # ~8 min of history at 80 ms
        self._frames: List[Optional[int]] = []
        self._base = 0  # global index of self._frames[0]

    @property
    def covered_frames(self) -> int:
        return self._base + len(self._frames)

    @property
    def covered_until(self) -> float:
        return self.covered_frames * self.frame_secs

    def add(self, first_frame: int, probs: np.ndarray) -> None:
        probs = np.asarray(probs, dtype=np.float32)
        if first_frame > self.covered_frames:  # gap (should not happen): fill as silence
            self._frames.extend([None] * (first_frame - self.covered_frames))
        skip = self.covered_frames - first_frame
        for row in probs[max(skip, 0):]:
            best = int(np.argmax(row))
            self._frames.append(best if row[best] >= self.threshold else None)
        if len(self._frames) > self.max_frames:
            drop = len(self._frames) - self.max_frames
            del self._frames[:drop]
            self._base += drop

    def frames(self, t0: float, t1: float) -> List[Optional[int]]:
        lo = max(int(math.floor(t0 / self.frame_secs)), self._base)
        hi = min(int(math.ceil(t1 / self.frame_secs)), self.covered_frames)
        if hi <= lo:
            return []
        return self._frames[lo - self._base: hi - self._base]

    def dominant(self, t0: float, t1: float) -> Optional[int]:
        """Most active speaker in [t0, t1) among frames already diarized."""
        active = [s for s in self.frames(t0, t1) if s is not None]
        if not active:
            return None
        counts = Counter(active)
        top = max(counts.values())
        for s in reversed(active):  # tie -> most recent speaker
            if counts[s] == top:
                return s
        return None  # pragma: no cover

    def held_frames(self, speaker: int, since: float) -> int:
        """Frames since `since` in which `speaker` was the dominant voice."""
        return sum(1 for s in self.frames(since, self.covered_until) if s == speaker)


# ------------------------------------------------------------------------ roles
class SpeakerRoles:
    """Maps arrival-ordered Sortformer slots to interview roles."""

    def __init__(self, first_speaker_role: str = "interviewer"):
        self.first_speaker_role = "applicant" if first_speaker_role == "applicant" else "interviewer"
        self._applicant: Optional[int] = None  # explicit user assignment

    @property
    def applicant_index(self) -> int:
        if self._applicant is not None:
            return self._applicant
        return 0 if self.first_speaker_role == "applicant" else 1

    def role(self, speaker_index: Optional[int]) -> str:
        # Unknown voice: treat as interviewer. A missed question is worse than an extra one,
        # and the gateway's question filter still applies.
        if speaker_index is None:
            return "interviewer"
        return "applicant" if speaker_index == self.applicant_index else "interviewer"

    def assign(self, speaker_index: Optional[int], role: str) -> None:
        if speaker_index is None:
            return
        if role == "applicant":
            self._applicant = speaker_index
        elif role == "interviewer" and speaker_index == self.applicant_index:
            # The other of the two main voices becomes the candidate.
            self._applicant = 1 if speaker_index == 0 else 0

    def set_first_speaker(self, role: str) -> None:
        self.first_speaker_role = "applicant" if role == "applicant" else "interviewer"
        self._applicant = None

    def clear_assignment(self) -> None:
        self._applicant = None

    def describe(self) -> dict:
        return {"applicant_speaker": self.applicant_index, "first_speaker": self.first_speaker_role}


# ------------------------------------------------------------------ transcriber
@dataclass
class DiarizationConfig:
    word_lag_secs: float = 0.25  # Parakeet decodes a word roughly this long after it starts
    word_window_secs: float = 0.32  # diarization frames inspected after a word's start
    min_switch_secs: float = 0.4  # a new voice must hold this long before an utterance is split
    min_run_words: int = 2  # shorter single-voice runs are merged into a neighbour (blips, "yeah")
    max_final_hold_secs: Optional[float] = None  # max wait for diarization; default: its latency + 0.6 s
    threshold: float = 0.5  # speaker activity threshold
    max_lag_secs: float = 8.0  # diarization this far behind real time -> degraded


@dataclass
class SpeakerEvent:
    text: str
    is_final: bool
    reason: str
    speaker_index: Optional[int]


class DiarizedTranscriber:
    """ASR + streaming diarization for one mixed (mic-only) channel."""

    def __init__(self, transcriber, diar_engine, config: Optional[DiarizationConfig] = None, threaded: bool = False):
        self.transcriber = transcriber
        self.diar = diar_engine
        self.config = config or DiarizationConfig()
        if self.config.max_final_hold_secs is None:
            self.config.max_final_hold_secs = float(getattr(diar_engine, "latency_secs", 1.04)) + 0.6
        self.channel = transcriber.channel
        self._diar_state = diar_engine.create_stream()
        self._diar_failed = False
        self.degraded = False
        self._lock = threading.Lock()  # guards the timeline / attribution state
        self._diar_lock = threading.Lock()  # serialises model steps and stream resets
        self._generation = 0  # bumped on reset so results of an in-flight step are discarded
        self._reset_attribution()

        self._threaded = threaded
        self._queue: List[bytes] = []
        self._queue_cv = threading.Condition()
        self._busy = False
        self._closed = False
        self._worker = None
        if threaded:
            self._worker = threading.Thread(target=self._worker_loop, name="sortformer-stream", daemon=True)
            self._worker.start()

    # ---------------------------------------------------------------- public
    @property
    def last_speech_time(self):
        return self.transcriber.last_speech_time

    def feed(self, pcm_bytes: bytes) -> List[SpeakerEvent]:
        asr_events = self.transcriber.feed(pcm_bytes)
        if self._threaded:
            with self._queue_cv:
                self._queue.append(bytes(pcm_bytes))
                self._queue_cv.notify()
        else:
            self._feed_diarizer(pcm_bytes)
        return self.process(asr_events)

    def flush(self) -> List[SpeakerEvent]:
        self.wait_idle(timeout=2.0)
        out = self.process(self.transcriber.flush())
        with self._lock:
            out += self._release_finals(force=True)
        return out

    def reset(self) -> None:
        with self._queue_cv:
            self._queue.clear()
        with self._diar_lock, self._lock:
            self._generation += 1
            self.transcriber.reset()
            self.diar.reset_stream(self._diar_state)
            self._diar_failed = False
            self.degraded = False
            self._reset_attribution()

    def close(self) -> None:
        with self._queue_cv:
            self._closed = True
            self._queue.clear()
            self._queue_cv.notify_all()

    def wait_idle(self, timeout: float = 5.0) -> bool:
        """Block until the diarization worker has consumed all queued audio."""
        if not self._threaded:
            return True
        with self._queue_cv:
            return self._queue_cv.wait_for(lambda: not self._queue and not self._busy, timeout=timeout)

    @property
    def lag_secs(self) -> float:
        """How far diarization trails the audio received so far."""
        return max(0.0, self._now() - self.timeline.covered_until)

    def process(self, asr_events) -> List[SpeakerEvent]:
        """Attribute ASR events using the diarization timeline gathered so far."""
        with self._lock:
            return self._process_locked(asr_events)

    def _process_locked(self, asr_events) -> List[SpeakerEvent]:
        out: List[SpeakerEvent] = []
        for event in asr_events:
            if event.is_final:
                self._pending_finals.append((event, self._emitted))
                self._open = None
                self._emitted = 0
                self._last_partial_sent = None
            else:
                self._open = event
        out += self._release_finals(force=False)
        if not self._pending_finals:  # keep output ordered: no new partials before an older final
            out += self._split_open_utterance()
            out += self._open_partial()
        return out

    # ------------------------------------------------------------- internals
    def _reset_attribution(self) -> None:
        self.timeline = SpeakerTimeline(getattr(self.diar, "frame_secs", 0.08), self.config.threshold)
        self._open = None
        self._emitted = 0  # words of the open utterance already finalised by a speaker change
        self._pending_finals: List[Tuple[object, int]] = []
        self._last_partial_sent: Optional[Tuple[str, Optional[int]]] = None
        self._last_speaker: Optional[int] = None
        self.last_final_speaker: Optional[int] = None

    def _worker_loop(self) -> None:
        while True:
            with self._queue_cv:
                self._queue_cv.wait_for(lambda: self._queue or self._closed)
                if self._closed:
                    return
                batch = b"".join(self._queue)
                self._queue.clear()
                self._busy = True
            try:
                self._feed_diarizer(batch)
            finally:
                with self._queue_cv:
                    self._busy = False
                    self._queue_cv.notify_all()

    def _feed_diarizer(self, pcm_bytes: bytes) -> None:
        if self._diar_failed or self.degraded or not pcm_bytes:
            return
        samples = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        gain = getattr(getattr(self.transcriber, "config", None), "input_gain", 1.0)
        if gain != 1.0:
            samples = np.clip(samples * gain, -1.0, 1.0)
        try:
            # The model step runs outside self._lock so transcription is never blocked by it.
            with self._diar_lock:
                generation = self._generation
                chunks = self.diar.feed(self._diar_state, samples)
        except Exception:
            # Keep transcribing; speakers fall back to the last known voice.
            self._diar_failed = True
            logger.exception("[Diarization] streaming step failed; speaker labels frozen")
            return
        with self._lock:
            if generation != self._generation:
                return  # stream was reset while this step ran
            for first_frame, probs in chunks:
                self.timeline.add(first_frame, probs)
            if self.lag_secs > self.config.max_lag_secs and not self.degraded:
                self.degraded = True
                logger.warning(
                    "[Diarization] %.1fs behind real time; this machine is too slow for live diarization "
                    "(use a GPU or a larger ASR_DIAR_CHUNK_LEN)", self.lag_secs,
                )

    def _now(self) -> float:
        return float(getattr(self.transcriber, "stream_time", 0.0))

    def _words(self, event, skip: int) -> Tuple[List[str], List[float]]:
        words = event.text.split()
        times = list(event.word_times or [])
        if len(times) != len(words):
            fallback = event.end_time if event.end_time is not None else self._now()
            times = (times + [fallback] * len(words))[: len(words)]
        return words[skip:], times[skip:]

    def _label(self, word_time: float) -> Optional[int]:
        start = word_time - self.config.word_lag_secs
        return self.timeline.dominant(start - self.timeline.frame_secs, start + self.config.word_window_secs)

    def _runs(self, words: Sequence[str], times: Sequence[float]) -> List[Tuple[Optional[int], List[str], float]]:
        """Group words into single-speaker runs: [(speaker, words, start_time)]."""
        if not words:
            return []
        labels = [self._label(t) for t in times]
        known = [label for label in labels if label is not None]
        fill = known[0] if known else self._last_speaker
        for i, label in enumerate(labels):  # unknown / silent frames inherit the previous voice
            if label is None:
                labels[i] = fill
            else:
                fill = label

        runs: List[List] = []
        for word, t, label in zip(words, times, labels):
            if runs and runs[-1][0] == label:
                runs[-1][1].append(word)
            else:
                runs.append([label, [word], t - self.config.word_lag_secs])

        # Merge blips (a word or two attributed to another voice) into the neighbouring run.
        changed = True
        while changed and len(runs) > 1:
            changed = False
            for i, run in enumerate(runs):
                if len(run[1]) < self.config.min_run_words:
                    if i > 0:
                        runs[i - 1][1].extend(run[1])
                    else:
                        runs[1][1][:0] = run[1]
                        runs[1][2] = run[2]
                    del runs[i]
                    changed = True
                    break
            merged: List[List] = []
            for run in runs:
                if merged and merged[-1][0] == run[0]:
                    merged[-1][1].extend(run[1])
                else:
                    merged.append(run)
            runs = merged
        return [(r[0], r[1], r[2]) for r in runs]

    def _speaker_event(self, words, speaker, reason, is_final=True) -> SpeakerEvent:
        if speaker is not None:
            self._last_speaker = speaker
        if is_final:
            self.last_final_speaker = speaker
        return SpeakerEvent(text=" ".join(words), is_final=is_final, reason=reason, speaker_index=speaker)

    def _release_finals(self, force: bool) -> List[SpeakerEvent]:
        out: List[SpeakerEvent] = []
        while self._pending_finals:
            event, skip = self._pending_finals[0]
            words, times = self._words(event, skip)
            if words and not force:
                needed = times[-1] - self.config.word_lag_secs + self.config.word_window_secs
                end_time = event.end_time if event.end_time is not None else times[-1]
                waited = self._now() - end_time
                if self.timeline.covered_until < needed and waited < self.config.max_final_hold_secs:
                    break  # diarization has not reached the end of this utterance yet
            self._pending_finals.pop(0)
            runs = self._runs(words, times)
            for i, (speaker, run_words, _start) in enumerate(runs):
                reason = event.reason if i == len(runs) - 1 else "speaker_change"
                out.append(self._speaker_event(run_words, speaker, reason))
        return out

    def _split_open_utterance(self) -> List[SpeakerEvent]:
        if self._open is None:
            return []
        out: List[SpeakerEvent] = []
        words, times = self._words(self._open, self._emitted)
        runs = self._runs(words, times)
        min_frames = max(1, int(round(self.config.min_switch_secs / self.timeline.frame_secs)))
        for current, following in zip(runs, runs[1:]):
            next_speaker, _, next_start = following
            if next_speaker is None or self.timeline.held_frames(next_speaker, next_start) < min_frames:
                break
            speaker, run_words, _ = current
            out.append(self._speaker_event(run_words, speaker, "speaker_change"))
            self._emitted += len(run_words)
            self._last_partial_sent = None
        return out

    def _open_partial(self) -> List[SpeakerEvent]:
        if self._open is None:
            return []
        words, times = self._words(self._open, self._emitted)
        runs = self._runs(words, times)
        if not runs:
            return []
        speaker = runs[0][0]
        if speaker is None or self._label(times[0]) is None and self.timeline.covered_until < (
            times[0] - self.config.word_lag_secs + self.config.word_window_secs
        ):
            return []  # nobody identified yet: wait instead of guessing
        text = " ".join(words)
        if (text, speaker) == self._last_partial_sent:
            return []
        self._last_partial_sent = (text, speaker)
        return [self._speaker_event(words, speaker, "partial", is_final=False)]
