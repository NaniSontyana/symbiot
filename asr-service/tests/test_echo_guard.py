from services.echo_guard import EchoGuard


class Clock:
    def __init__(self):
        self.t = 100.0

    def __call__(self):
        return self.t


def test_mic_echo_of_interviewer_words_is_dropped():
    clock = Clock()
    guard = EchoGuard(clock=clock)
    guard.note_interviewer_text("how would you design a rate limiter", is_final=True)
    clock.t += 0.4
    assert guard.is_echo("how would you design a rate limiter")
    assert guard.is_echo("would you design rate limiter")  # imperfect echo transcription


def test_echo_matches_interviewer_partial_still_in_progress():
    clock = Clock()
    guard = EchoGuard(clock=clock)
    guard.note_interviewer_text("explain the difference between processes and", is_final=False)
    assert guard.is_echo("difference between processes")


def test_real_applicant_answer_is_kept():
    clock = Clock()
    guard = EchoGuard(clock=clock)
    guard.note_interviewer_text("how would you design a rate limiter", is_final=True)
    clock.t += 1.0
    assert not guard.is_echo("i would use a token bucket stored in redis with a sliding window")
    assert not guard.is_echo("sure")


def test_no_echo_when_interviewer_channel_is_quiet():
    """Mic-only mode: the interviewer channel gets no fresh audio, so the guard never fires."""
    clock = Clock()
    guard = EchoGuard(clock=clock, activity_window=3.0)
    guard.note_interviewer_text("what is a closure", is_final=True)
    clock.t += 5.0
    assert not guard.is_echo("a closure")


def test_voice_activity_keeps_guard_armed():
    clock = Clock()
    guard = EchoGuard(clock=clock, activity_window=3.0, window_secs=8.0)
    guard.note_interviewer_text("tell me about kafka partitions", is_final=True)
    clock.t += 4.0
    assert not guard.is_echo("kafka partitions")
    guard.note_interviewer_speech()
    assert guard.is_echo("kafka partitions")


def test_old_interviewer_text_expires():
    clock = Clock()
    guard = EchoGuard(clock=clock, window_secs=8.0)
    guard.note_interviewer_text("tell me about kafka partitions", is_final=True)
    clock.t += 9.0
    guard.note_interviewer_speech()
    assert not guard.is_echo("kafka partitions")
