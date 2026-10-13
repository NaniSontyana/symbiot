"""
Cross-channel echo suppression for dual-source capture.

In dual-source mode the interviewer is captured from system audio (0x01) and the
applicant from the microphone (0x02). Without headphones the interviewer's voice
leaks from the speakers into the microphone, so the same words get transcribed
twice: once correctly on the interviewer channel, once wrongly as "applicant".

`EchoGuard` drops an applicant transcript when BOTH hold:
  * the interviewer channel carried speech within the last `activity_window` s
    (so echo is physically possible; this keeps mic-only mode unaffected), and
  * most of the applicant's content words were also just said by the interviewer.
"""

from __future__ import annotations

import re
import time
from collections import Counter, deque
from typing import Callable, Deque, Optional, Tuple

_WORD = re.compile(r"[a-z0-9']+")

# Very common words carry no evidence of echo; ignored unless nothing else is left.
_STOPWORDS = frozenset(
    "a an the is are was were be been to of in on at for and or but so it this that "
    "i you we they he she do does did can could would will what how why when where "
    "which who your my our me us them with as by from about".split()
)


def _words(text: str):
    return _WORD.findall(text.lower())


def _content(words):
    content = [w for w in words if w not in _STOPWORDS]
    return content or list(words)


class EchoGuard:
    def __init__(
        self,
        window_secs: float = 8.0,
        activity_window: float = 3.0,
        overlap_threshold: float = 0.6,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.window_secs = window_secs
        self.activity_window = activity_window
        self.overlap_threshold = overlap_threshold
        self._clock = clock
        self._finals: Deque[Tuple[float, list]] = deque()
        self._partial: list = []
        self._last_interviewer_speech: Optional[float] = None

    # Interviewer side -------------------------------------------------------
    def note_interviewer_speech(self, at: Optional[float] = None) -> None:
        """Record voice activity on the interviewer channel (defaults to now)."""
        at = self._clock() if at is None else at
        if self._last_interviewer_speech is None or at > self._last_interviewer_speech:
            self._last_interviewer_speech = at

    def note_interviewer_text(self, text: str, is_final: bool) -> None:
        now = self._clock()
        self._last_interviewer_speech = now
        words = _words(text)
        if is_final:
            self._finals.append((now, words))
            self._partial = []
        else:
            self._partial = words
        self._expire(now)

    # Applicant side ---------------------------------------------------------
    def is_echo(self, applicant_text: str) -> bool:
        now = self._clock()
        if self._last_interviewer_speech is None or now - self._last_interviewer_speech > self.activity_window:
            return False
        self._expire(now)

        candidate = _content(_words(applicant_text))
        if not candidate:
            return False

        reference = Counter()
        for _, words in self._finals:
            reference.update(words)
        reference.update(self._partial)
        if not reference:
            return False

        matched = 0
        for word, count in Counter(candidate).items():
            matched += min(count, reference.get(word, 0))
        return matched / len(candidate) >= self.overlap_threshold

    def _expire(self, now: float) -> None:
        while self._finals and now - self._finals[0][0] > self.window_secs:
            self._finals.popleft()
