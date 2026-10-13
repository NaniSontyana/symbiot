"""Mic-only diarization: attributing Parakeet words to Sortformer speakers."""

import numpy as np

from services.parakeet_eou_engine import StepResult
from services.speaker_attribution import (
    DiarizationConfig,
    DiarizedTranscriber,
    SpeakerRoles,
    SpeakerTimeline,
)
from services.transcriber import ChannelTranscriber
from conftest import FakeDiarEngine, FakeEngine, silence_chunk, speech_chunk

FRAME = 0.08
STEP = 0.08  # ASR chunk


def script(words, eou_at_secs, lag=0.25):
    """ASR script: each (start_secs, word) is decoded `lag` after it starts; <EOU> at eou_at_secs."""
    steps = int(round(eou_at_secs / STEP))
    results = [StepResult(text="", is_eou=False) for _ in range(steps + 1)]
    for start, word in words:
        i = int(round((start + lag) / STEP))
        results[i] = StepResult(text=results[i].text + " " + word, is_eou=False)
    results[steps] = StepResult(text=results[steps].text, is_eou=True)
    return results


def run(engine_script, speaker_at, speech_until, total_secs, **diar_kwargs):
    asr = ChannelTranscriber(FakeEngine(script=engine_script), "mixed")
    dt = DiarizedTranscriber(asr, FakeDiarEngine(speaker_at, **diar_kwargs), DiarizationConfig())
    events = []
    for i in range(int(round(total_secs / STEP))):
        chunk = speech_chunk() if i * STEP < speech_until else silence_chunk()
        for e in dt.feed(chunk):
            events.append((round((i + 1) * STEP, 2), e))
    return dt, events


def finals(events):
    return [(e.text, e.speaker_index, e.reason) for _, e in events if e.is_final]


def test_speaker_change_without_pause_splits_the_utterance():
    words = [(0.0, "what"), (0.4, "is"), (0.8, "a"), (1.2, "closure"),
             (2.1, "a"), (2.4, "closure"), (2.7, "is"), (3.0, "a"), (3.3, "function"), (3.6, "that"), (3.9, "captures")]
    speaker_at = lambda t: 0 if t < 1.9 else (1 if t < 4.2 else None)  # noqa: E731
    _, events = run(script(words, eou_at_secs=4.4), speaker_at, speech_until=4.2, total_secs=7.0)

    assert finals(events) == [
        ("what is a closure", 0, "speaker_change"),
        ("a closure is a function that captures", 1, "eou"),
    ]
    split_time = next(t for t, e in events if e.is_final)
    assert split_time < 4.4, "the question is finalised while the candidate is still talking"
    partial_speakers = [e.speaker_index for _, e in events if not e.is_final]
    assert partial_speakers and partial_speakers[0] == 0 and partial_speakers[-1] == 1


def test_finals_wait_for_diarization_then_get_the_right_voice():
    # Interviewer asks; utterance ends with <EOU> before diarization has seen its last word.
    words = [(0.0, "explain"), (0.4, "react"), (0.8, "hooks")]
    speaker_at = lambda t: 1 if t < 1.3 else None  # noqa: E731  (slot 1 = second voice of the session)
    _, events = run(script(words, eou_at_secs=1.4), speaker_at, speech_until=1.3, total_secs=4.0)

    assert finals(events) == [("explain react hooks", 1, "eou")]
    released_at = next(t for t, e in events if e.is_final)
    assert released_at > 1.4  # held until the diarizer covered the last word (~1 s behind)
    assert released_at <= 1.48 + 1.04 + 0.6 + STEP  # never later than EOU + max hold (latency + 0.6 s)


def test_partials_are_not_emitted_before_the_speaker_is_known():
    words = [(0.0, "tell"), (0.3, "me"), (0.6, "about"), (0.9, "yourself")]
    _, events = run(script(words, eou_at_secs=2.0), lambda t: 0 if t < 1.2 else None, speech_until=1.2, total_secs=4.0)
    first_partial_time = next(t for t, e in events if not e.is_final)
    assert first_partial_time >= 1.0  # diarizer latency: 0.48 s chunk + 0.56 s right context
    assert all(e.speaker_index == 0 for _, e in events)


def test_short_backchannel_from_other_voice_does_not_split():
    words = [(0.0, "so"), (0.4, "how"), (0.8, "would"), (1.2, "you"), (1.6, "scale"), (2.0, "this"), (2.4, "service")]
    # candidate says "mm" around 1.2 s for 0.3 s (one ASR word attributed to them)
    speaker_at = lambda t: 1 if 1.15 <= t < 1.45 else (0 if t < 2.8 else None)  # noqa: E731
    _, events = run(script(words, eou_at_secs=3.0), speaker_at, speech_until=2.8, total_secs=5.0)
    assert finals(events) == [("so how would you scale this service", 0, "eou")]


def test_stalled_diarizer_releases_final_after_max_hold():
    words = [(0.0, "what"), (0.4, "is"), (0.8, "docker")]
    dt, events = run(script(words, eou_at_secs=1.2), lambda t: 0, speech_until=1.1, total_secs=4.0, stalled=True)
    assert finals(events) == [("what is docker", None, "eou")]
    released_at = next(t for t, e in events if e.is_final)
    assert abs(released_at - (1.28 + dt.config.max_final_hold_secs)) <= 2 * STEP + 1e-9  # EOU step ends at 1.28 s
    assert dt.config.max_final_hold_secs == 1.04 + 0.6
    assert SpeakerRoles().role(None) == "interviewer"


def test_flush_and_reset():
    words = [(0.0, "design"), (0.4, "a"), (0.8, "cache")]
    asr = ChannelTranscriber(FakeEngine(script=script(words, eou_at_secs=5.0)), "mixed")
    diar = FakeDiarEngine(lambda t: 0)
    dt = DiarizedTranscriber(asr, diar)
    for _ in range(14):
        dt.feed(speech_chunk())
    assert finals([(0, e) for e in dt.flush()]) == [("design a cache", 0, "flush")]
    dt.reset()
    assert diar.resets == 1 and dt.timeline.covered_frames == 0 and asr.stream_time == 0


def test_timeline_dominant_and_trimming():
    tl = SpeakerTimeline(frame_secs=FRAME, threshold=0.5, max_frames=10)
    probs = np.zeros((12, 4), dtype=np.float32)
    probs[:6, 0] = 0.8
    probs[6:, 2] = 0.7
    probs[11, 2] = 0.2  # below threshold -> silence
    tl.add(0, probs)
    assert tl.covered_frames == 12 and tl.covered_until == 12 * FRAME
    assert tl.dominant(0.0, 0.8) == 2  # frames 2..9 kept (first two trimmed): 0,0,0,0,2,2,2,2 -> tie -> latest
    assert tl.dominant(0.5, 0.96) == 2
    assert tl.held_frames(2, 0.48) == 5


def test_roles_mapping_and_corrections():
    roles = SpeakerRoles("interviewer")
    assert roles.role(0) == "interviewer" and roles.role(1) == "applicant" and roles.role(2) == "interviewer"
    roles.assign(0, "applicant")  # "that was me"
    assert roles.role(0) == "applicant" and roles.role(1) == "interviewer"
    roles.assign(0, "interviewer")  # "that was the interviewer"
    assert roles.applicant_index == 1
    roles.set_first_speaker("applicant")
    assert roles.describe() == {"applicant_speaker": 0, "first_speaker": "applicant"}


def test_threaded_worker_gives_same_result():
    words = [(0.0, "what"), (0.4, "is"), (0.8, "a"), (1.2, "closure"),
             (2.1, "a"), (2.4, "closure"), (2.7, "is"), (3.0, "a"), (3.3, "function"), (3.6, "that"), (3.9, "captures")]
    asr = ChannelTranscriber(FakeEngine(script=script(words, eou_at_secs=4.4)), "mixed")
    dt = DiarizedTranscriber(asr, FakeDiarEngine(lambda t: 0 if t < 1.9 else (1 if t < 4.2 else None)), threaded=True)
    events = []
    try:
        for i in range(int(7.0 / STEP)):
            events += dt.feed(speech_chunk() if i * STEP < 4.2 else silence_chunk())
            assert dt.wait_idle(2.0)
            events += dt.process([])
    finally:
        dt.close()
    assert [(e.text, e.speaker_index) for e in events if e.is_final] == [
        ("what is a closure", 0), ("a closure is a function that captures", 1)
    ]


def test_diarizer_that_cannot_keep_up_marks_stream_degraded():
    asr = ChannelTranscriber(FakeEngine(), "mixed")
    dt = DiarizedTranscriber(asr, FakeDiarEngine(lambda t: 0, stalled=True), DiarizationConfig(max_lag_secs=2.0))
    for _ in range(int(1.9 / STEP)):
        dt.feed(silence_chunk())
    assert not dt.degraded
    for _ in range(3):
        dt.feed(silence_chunk())
    assert dt.degraded and dt.lag_secs > 2.0
