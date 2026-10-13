from conftest import CHUNK_BYTES, FakeEngine, silence_chunk, speech_chunk

from services.parakeet_eou_engine import StepResult
from services.transcriber import ChannelTranscriber, TranscriberConfig


def make(engine, **cfg):
    return ChannelTranscriber(engine, "interviewer", config=TranscriberConfig(**cfg))


def test_rechunks_arbitrary_packet_sizes_into_80ms_steps(fake_engine):
    tr = make(fake_engine)
    audio = speech_chunk() * 3
    for i in range(0, len(audio), 1000):  # odd-sized packets
        tr.feed(audio[i : i + 1000])
    assert len(fake_engine.calls) == 3
    tr.feed(speech_chunk()[: CHUNK_BYTES // 2])
    assert len(fake_engine.calls) == 3  # half a chunk stays buffered


def test_idle_silence_skips_inference_and_replays_preroll(fake_engine):
    tr = make(fake_engine, preroll_chunks=3)
    for _ in range(10):
        assert tr.feed(silence_chunk()) == []
    assert fake_engine.calls == []
    assert not tr.is_active

    tr.feed(speech_chunk())
    assert tr.is_active
    assert len(fake_engine.calls) == 4  # 3 pre-roll chunks + the speech chunk


def test_partials_then_final_on_eou(fake_engine):
    fake_engine.script = [
        StepResult(" what", False),
        StepResult(" is", False),
        StepResult("", False),
        StepResult(" re", False),
        StepResult("act ", True),
    ]
    tr = make(fake_engine, preroll_chunks=0)
    events = []
    for _ in range(5):
        events += tr.feed(speech_chunk())

    partials = [e.text for e in events if not e.is_final]
    finals = [e for e in events if e.is_final]
    assert partials == ["what", "what is", "what is re"]
    assert len(finals) == 1
    assert finals[0].text == "what is react"
    assert finals[0].reason == "eou"
    assert not tr.is_active
    assert fake_engine.states[0].resets == 1  # model state reset after EOU


def test_next_utterance_starts_clean_after_eou(fake_engine):
    fake_engine.script = [StepResult(" hello", True), StepResult(" world", True)]
    tr = make(fake_engine, preroll_chunks=0)
    first = tr.feed(speech_chunk())
    second = tr.feed(speech_chunk())
    assert [e.text for e in first if e.is_final] == ["hello"]
    assert [e.text for e in second if e.is_final] == ["world"]


def test_forced_final_after_long_silence_without_eou(fake_engine):
    fake_engine.script = [StepResult(" explain hooks", False)]
    tr = make(fake_engine, preroll_chunks=0, force_final_silence_chunks=4)
    events = tr.feed(speech_chunk())
    for _ in range(3):
        events += tr.feed(silence_chunk())
    assert not any(e.is_final for e in events)
    events += tr.feed(silence_chunk())
    finals = [e for e in events if e.is_final]
    assert [(e.text, e.reason) for e in finals] == [("explain hooks", "silence")]
    assert not tr.is_active


def test_noise_burst_without_words_returns_to_idle(fake_engine):
    tr = make(fake_engine, preroll_chunks=0, idle_after_silence_chunks=3)
    tr.feed(speech_chunk())
    for _ in range(3):
        tr.feed(silence_chunk())
    assert not tr.is_active
    calls = len(fake_engine.calls)
    for _ in range(10):
        tr.feed(silence_chunk())
    assert len(fake_engine.calls) == calls  # no more inference while idle


def test_max_length_forces_final(fake_engine):
    fake_engine.script = [StepResult(" word", False)] * 10
    tr = make(fake_engine, preroll_chunks=0, max_utterance_chunks=5, emit_partials=False)
    events = []
    for _ in range(5):
        events += tr.feed(speech_chunk())
    finals = [e for e in events if e.is_final]
    assert len(finals) == 1 and finals[0].reason == "max_length"
    assert finals[0].text == "word word word word word"


def test_flush_and_reset(fake_engine):
    fake_engine.script = [StepResult(" design a cache", False), StepResult(" stale", False)]
    tr = make(fake_engine, preroll_chunks=0)
    tr.feed(speech_chunk())
    flushed = tr.flush()
    assert [(e.text, e.reason) for e in flushed] == [("design a cache", "flush")]

    tr.feed(speech_chunk())  # " stale"
    tr.feed(speech_chunk()[:100])
    tr.reset()
    assert tr.flush() == []
    assert not tr.is_active


def test_channels_have_independent_model_state():
    engine = FakeEngine(script=[StepResult(" interviewer", False), StepResult(" applicant", False)])
    a = ChannelTranscriber(engine, "interviewer", config=TranscriberConfig(preroll_chunks=0))
    b = ChannelTranscriber(engine, "applicant", config=TranscriberConfig(preroll_chunks=0))
    a.feed(speech_chunk())
    b.feed(speech_chunk())
    assert {sid for sid, _ in engine.calls} == {0, 1}
    assert [e.text for e in a.flush()] == ["interviewer"]
    assert [e.text for e in b.flush()] == ["applicant"]
