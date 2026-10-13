import json

import pytest
from fastapi.testclient import TestClient

import app as app_module
from conftest import FakeEngine, silence_chunk, speech_chunk
from services.parakeet_eou_engine import StepResult


@pytest.fixture
def client_with(monkeypatch):
    def _make(engine, diar=None):
        monkeypatch.setattr(app_module, "engine", engine)
        monkeypatch.setattr(app_module, "diar_engine", diar)
        return TestClient(app_module.app)

    return _make


def receive_until(ws, predicate, limit=50):
    for _ in range(limit):
        msg = ws.receive_json()
        if predicate(msg):
            return msg
    raise AssertionError("expected message not received")


def test_health_reports_model_status(client_with):
    engine = FakeEngine(is_ready=False, load_error="NeMo missing")
    with client_with(engine) as client:
        body = client.get("/health").json()
    assert body["status"] == "degraded"
    assert body["model_status"] == "error"
    assert body["error"] == "NeMo missing"


def test_audio_is_dropped_while_model_not_ready(client_with):
    engine = FakeEngine(is_ready=False)
    with client_with(engine) as client, client.websocket_connect("/ws/transcribe") as ws:
        status = ws.receive_json()
        assert status["type"] == "asr_status" and status["status"] == "loading" and status["message"] is None
        assert status["diarization"] == "disabled"
        ws.send_bytes(b"\x01" + speech_chunk())
        ws.send_text(json.dumps({"type": "set_speaker", "speaker": "applicant"}))
    assert engine.calls == []


def test_final_transcript_uses_frontend_contract(client_with):
    engine = FakeEngine(script=[StepResult(" what is", False), StepResult(" a closure", True)])
    with client_with(engine) as client, client.websocket_connect("/ws/transcribe") as ws:
        assert ws.receive_json()["status"] == "ready"
        ws.send_bytes(b"\x01" + speech_chunk())
        partial = ws.receive_json()
        assert partial["type"] == "transcript_partial" and partial["text"] == "what is"
        ws.send_bytes(b"\x01" + speech_chunk())
        final = receive_until(ws, lambda m: m["type"] == "transcript_chunk")
    assert final == {
        "type": "transcript_chunk",
        "text": "what is a closure",
        "speaker": "interviewer",
        "engine": "parakeet_realtime_eou_120m-v1",
        "is_final": True,
        "reason": "eou",
    }


def test_header_routes_channels_and_flush(client_with):
    engine = FakeEngine(script=[StepResult(" from mic", False)])
    with client_with(engine) as client, client.websocket_connect("/ws/transcribe") as ws:
        ws.receive_json()
        ws.send_bytes(b"\x02" + speech_chunk())
        assert ws.receive_json()["speaker"] == "applicant"
        ws.send_text(json.dumps({"type": "flush"}))
        final = receive_until(ws, lambda m: m["type"] == "transcript_chunk")
    assert (final["text"], final["speaker"], final["reason"]) == ("from mic", "applicant", "flush")


def test_each_connection_gets_its_own_stream_state(client_with):
    engine = FakeEngine()
    with client_with(engine) as client:
        with client.websocket_connect("/ws/transcribe") as ws1, client.websocket_connect("/ws/transcribe") as ws2:
            ws1.receive_json()
            ws2.receive_json()
            ws1.send_bytes(b"\x01" + speech_chunk())
            ws2.send_bytes(b"\x01" + speech_chunk())
            ws1.send_bytes(b"\x02" + speech_chunk())
            # round-trip a no-op message so the server has processed the audio
            for ws in (ws1, ws2):
                ws.send_bytes(b"\x01" + silence_chunk())
                ws.send_text(json.dumps({"type": "flush"}))
    # ws1/interviewer, ws2/interviewer, ws1/applicant -> three distinct stream states
    assert len(engine.states) == 3
    assert len({sid for sid, _ in engine.calls}) == 3


def test_reset_buffer_clears_pending_text(client_with):
    engine = FakeEngine(script=[StepResult(" old question", False), StepResult(" new", False)])
    with client_with(engine) as client, client.websocket_connect("/ws/transcribe") as ws:
        ws.receive_json()
        ws.send_bytes(b"\x01" + speech_chunk())
        assert ws.receive_json()["text"] == "old question"
        ws.send_text(json.dumps({"type": "reset_buffer"}))
        ws.send_text(json.dumps({"type": "flush"}))  # nothing pending -> no final
        ws.send_bytes(b"\x01" + speech_chunk())
        msg = ws.receive_json()
    assert (msg["type"], msg["text"]) == ("transcript_partial", "new")
    assert engine.states[0].resets >= 2


def test_mic_echo_is_dropped_but_real_applicant_speech_passes(client_with):
    engine = FakeEngine(script=[
        StepResult(" how do you scale websockets", True),   # interviewer (system audio)
        StepResult(" how do you scale websockets", True),   # same words leaking into the mic
        StepResult(" i would shard connections", True),     # applicant actually answering
    ])
    with client_with(engine) as client, client.websocket_connect("/ws/transcribe") as ws:
        ws.receive_json()
        ws.send_bytes(b"\x01" + speech_chunk())
        first = ws.receive_json()
        ws.send_bytes(b"\x02" + speech_chunk())
        ws.send_bytes(b"\x02" + speech_chunk())
        second = ws.receive_json()
    assert (first["speaker"], first["text"]) == ("interviewer", "how do you scale websockets")
    assert (second["speaker"], second["text"]) == ("applicant", "i would shard connections")


def _mixed_script():
    """Interviewer (voice slot 0) asks, candidate (slot 1) answers without a pause, then <EOU>."""
    steps = [StepResult("", False) for _ in range(56)]
    for start, word in [(0.0, "what"), (0.4, "is"), (0.8, "a"), (1.2, "closure"),
                        (2.1, "it"), (2.4, "captures"), (2.7, "outer"), (3.0, "variables")]:
        i = int(round((start + 0.25) / 0.08))
        steps[i] = StepResult(steps[i].text + " " + word, False)
    steps[55] = StepResult("", True)
    return steps


def _mixed_session(ws, chunks=90):
    msgs = []
    for i in range(chunks):
        ws.send_bytes(b"\x03" + (speech_chunk() if i * 0.08 < 4.2 else silence_chunk()))
    ws.send_text(json.dumps({"type": "flush"}))
    ws.send_text(json.dumps({"type": "assign_last_speaker", "role": "interviewer"}))
    while True:
        msg = ws.receive_json()
        msgs.append(msg)
        if msg["type"] == "diar_roles":
            return msgs


def test_mixed_channel_separates_interviewer_and_candidate_by_voice(client_with):
    from conftest import FakeDiarEngine

    diar = FakeDiarEngine(lambda t: 0 if t < 1.9 else (1 if t < 4.2 else None))
    with client_with(FakeEngine(script=_mixed_script()), diar) as client:
        with client.websocket_connect("/ws/transcribe") as ws:
            status = ws.receive_json()
            assert status["status"] == "ready" and status["diarization"] == "ready"
            msgs = _mixed_session(ws)
        assert client.get("/health").json()["diarization"]["status"] == "ready"

    finals = [(m["text"], m["speaker"], m["speaker_index"], m["reason"]) for m in msgs if m["type"] == "transcript_chunk"]
    assert finals == [
        ("what is a closure", "interviewer", 0, "speaker_change"),
        ("it captures outer variables", "applicant", 1, "eou"),
    ]
    assert all(m["diarized"] for m in msgs if m["type"].startswith("transcript"))
    # "That was the interviewer" on the last utterance (slot 1) makes slot 0 the candidate
    assert msgs[-1] == {"type": "diar_roles", "applicant_speaker": 0, "first_speaker": "interviewer"}


def test_mixed_channel_without_diarizer_falls_back_to_manual_speaker(client_with):
    engine = FakeEngine(script=[StepResult(" tell me about", False), StepResult(" yourself", True)])
    with client_with(engine, None) as client, client.websocket_connect("/ws/transcribe") as ws:
        assert ws.receive_json()["diarization"] == "disabled"
        ws.send_text(json.dumps({"type": "set_speaker", "speaker": "applicant"}))
        ws.send_bytes(b"\x03" + speech_chunk())
        ws.send_bytes(b"\x03" + speech_chunk())
        final = receive_until(ws, lambda m: m["type"] == "transcript_chunk")
    assert final["speaker"] == "applicant" and final["text"] == "tell me about yourself"
