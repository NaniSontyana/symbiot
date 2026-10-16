import os
import json
import time
import asyncio
import logging
import threading
from contextlib import asynccontextmanager

try:
    from dotenv import load_dotenv

    load_dotenv()  # picks up asr-service/.env when present (optional)
except ImportError:
    pass

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from services.echo_guard import EchoGuard
from services.mock_engine import MockParakeetEngine
from services.parakeet_eou_engine import DEFAULT_MODEL_NAME, ParakeetEOUEngine
from services.sortformer_diar_engine import DEFAULT_DIAR_MODEL, SortformerDiarEngine
from services.speaker_attribution import DiarizationConfig, DiarizedTranscriber, SpeakerRoles
from services.transcriber import ChannelTranscriber, TranscriberConfig
from services.vad import VoiceActivityDetector

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("asr_app")

CHANNELS = ("interviewer", "applicant")
# 0x01 = interviewer (system audio), 0x02 = applicant (mic),
# 0x03 = mixed: one mic hears both people -> speakers separated by voice (Streaming Sortformer)
CHANNEL_HEADERS = {0x01: "interviewer", 0x02: "applicant", 0x03: "mixed"}
MIXED = "mixed"


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return default


def use_mock_engine() -> bool:
    return os.getenv("ASR_ENGINE", "parakeet").strip().lower() == "mock" or os.getenv("ASR_MOCK") == "1"


def build_engine():
    if use_mock_engine():
        # Scripted interviewer simulation: no GPU models needed, identical streaming interface.
        return MockParakeetEngine(
            model_name=os.getenv("ASR_MODEL", "mock/parakeet-simulator"),
            device=os.getenv("ASR_DEVICE") or "cpu",
        )
    return ParakeetEOUEngine(
        model_name=os.getenv("ASR_MODEL", DEFAULT_MODEL_NAME),
        device=os.getenv("ASR_DEVICE") or None,  # default: cuda if available, else cpu
    )


def build_transcriber_config() -> TranscriberConfig:
    return TranscriberConfig(
        input_gain=_env_float("ASR_INPUT_GAIN", 1.0),
        emit_partials=os.getenv("ASR_EMIT_PARTIALS", "1") != "0",
    )


def build_echo_guard():
    if os.getenv("ASR_ECHO_GUARD", "1") == "0":
        return None
    return EchoGuard(overlap_threshold=_env_float("ASR_ECHO_OVERLAP", 0.6))


def build_diar_engine():
    if os.getenv("ASR_DIARIZATION", "0" if use_mock_engine() else "1") == "0":
        return None
    return SortformerDiarEngine(
        model_name=os.getenv("ASR_DIAR_MODEL", DEFAULT_DIAR_MODEL),
        device=os.getenv("ASR_DEVICE") or None,
        # "auto" = benchmark at load and pick the lowest latency this machine sustains
        chunk_len=os.getenv("ASR_DIAR_CHUNK_LEN", "auto"),
        chunk_right_context=_env_int("ASR_DIAR_RIGHT_CONTEXT", 7),  # 0.56 s look-ahead
    )


def build_diarization_config() -> DiarizationConfig:
    return DiarizationConfig(
        threshold=_env_float("ASR_DIAR_THRESHOLD", 0.5),
        min_switch_secs=_env_float("ASR_DIAR_MIN_SWITCH_SECS", 0.4),
        word_lag_secs=_env_float("ASR_DIAR_WORD_LAG_SECS", 0.25),
    )


def build_roles() -> SpeakerRoles:
    return SpeakerRoles(os.getenv("ASR_DIAR_FIRST_SPEAKER", "interviewer"))


def build_vad() -> VoiceActivityDetector:
    return VoiceActivityDetector(base_energy_threshold=_env_float("ASR_VAD_ENERGY_THRESHOLD", 0.000003))


# Shared models (weights only). All per-stream state lives in ChannelTranscriber /
# DiarizedTranscriber instances.
engine = build_engine()
diar_engine = build_diar_engine()


def _load_models() -> None:
    if not engine.is_ready:
        engine.load()
    if diar_engine is not None and not diar_engine.is_ready:
        diar_engine.load()  # after ASR so transcription is available as early as possible


def _load_engine_in_background() -> None:
    if engine.is_ready and (diar_engine is None or diar_engine.is_ready):
        return
    threading.Thread(target=_load_models, name="model-loader", daemon=True).start()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if os.getenv("ASR_SKIP_MODEL_LOAD") != "1":
        _load_engine_in_background()
    yield


app = FastAPI(title="Symbiot ASR Streaming Microservice", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _engine_status() -> str:
    if engine.is_ready:
        return "ready"
    if engine.load_error:
        return "error"
    return "loading"


def _diar_status() -> str:
    if diar_engine is None:
        return "disabled"
    if diar_engine.is_ready:
        return "ready"
    if diar_engine.load_error:
        return "error"
    return "loading"


@app.get("/health")
def health_check():
    status = _engine_status()
    return {
        "status": "healthy" if status == "ready" else "degraded",
        "service": "symbiot-asr-service",
        "engine": engine.engine_type,
        "model": engine.model_name,
        "model_status": status,
        "device": str(engine.device) if engine.device is not None else None,
        "error": engine.load_error,
        "diarization": {
            "status": _diar_status(),
            "model": diar_engine.model_name if diar_engine is not None else None,
            "latency_secs": round(diar_engine.latency_secs, 2) if diar_engine is not None else None,
            "error": diar_engine.load_error if diar_engine is not None else None,
        },
    }


@app.websocket("/ws/transcribe")
async def websocket_transcribe(websocket: WebSocket):
    await websocket.accept()
    logger.info("[ASR WS] Client connected to real-time dual-channel speech pipeline")

    # Per-connection state: one independent streaming transcriber per speaker channel.
    transcribers = {}
    echo_guard = build_echo_guard()  # drops interviewer audio that leaked into the mic
    roles = build_roles()  # voice slot -> interviewer / applicant (mixed channel only)
    diar_too_slow = False  # this machine could not keep up with live diarization
    active_speaker = "interviewer"
    last_status_sent = None
    stats = {"chunks": 0, "proc_s": 0.0, "audio_s": 0.0}

    async def send_json(payload) -> bool:
        try:
            await websocket.send_json(payload)
            return True
        except Exception as send_err:
            logger.info(f"[ASR WS] Client disconnected before send: {send_err}")
            return False

    async def announce_status():
        nonlocal last_status_sent
        status = (_engine_status(), "too_slow" if diar_too_slow else _diar_status())
        if status != last_status_sent:
            last_status_sent = status
            await send_json({
                "type": "asr_status",
                "status": status[0],
                "message": engine.load_error,
                "diarization": status[1],
                "diarization_message": diar_engine.load_error if diar_engine is not None else None,
            })

    def get_transcriber(channel: str):
        if channel not in transcribers:
            base = ChannelTranscriber(engine, channel, config=build_transcriber_config(), vad=build_vad())
            if channel == MIXED and diar_engine is not None and diar_engine.is_ready and not diar_too_slow:
                transcribers[channel] = DiarizedTranscriber(
                    base, diar_engine, build_diarization_config(), threaded=True
                )
            else:
                transcribers[channel] = base
        return transcribers[channel]

    async def emit_mixed(events):
        for event in events:
            if not event.text:
                continue
            await send_json({
                "type": "transcript_chunk" if event.is_final else "transcript_partial",
                "text": event.text,
                "speaker": roles.role(event.speaker_index),
                "speaker_index": event.speaker_index,
                "diarized": True,
                "engine": engine.engine_type,
                "is_final": event.is_final,
                "reason": event.reason,
            })

    async def emit(events, channel: str):
        if channel == MIXED and isinstance(transcribers.get(MIXED), DiarizedTranscriber):
            await emit_mixed(events)
            return
        if channel == MIXED:
            channel = active_speaker  # diarizer unavailable: fall back to the manual speaker toggle
        for event in events:
            if echo_guard is not None:
                if channel == "interviewer":
                    echo_guard.note_interviewer_text(event.text, event.is_final)
                elif echo_guard.is_echo(event.text):
                    if event.is_final:
                        logger.info(f"[ASR WS] Dropped mic echo of interviewer audio: '{event.text}'")
                    continue
            await send_json({
                "type": "transcript_chunk" if event.is_final else "transcript_partial",
                "text": event.text,
                "speaker": channel,
                "engine": engine.engine_type,
                "is_final": event.is_final,
                "reason": event.reason,
            })

    await announce_status()

    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                logger.info("[ASR WS] Client disconnected cleanly")
                break

            raw_bytes = message.get("bytes")
            if raw_bytes:
                # Channel header prefix (0x01 = Interviewer / System, 0x02 = Applicant / Mic)
                if raw_bytes[0] in CHANNEL_HEADERS:
                    channel = CHANNEL_HEADERS[raw_bytes[0]]
                    chunk_bytes = raw_bytes[1:]
                else:
                    channel = active_speaker
                    chunk_bytes = raw_bytes

                if not engine.is_ready:
                    await announce_status()  # audio is dropped until the model is ready
                    continue
                await announce_status()

                transcriber = get_transcriber(channel)
                started = time.perf_counter()
                events = await asyncio.to_thread(transcriber.feed, chunk_bytes)
                if echo_guard is not None and channel == "interviewer" and transcriber.last_speech_time:
                    echo_guard.note_interviewer_speech(transcriber.last_speech_time)
                stats["proc_s"] += time.perf_counter() - started
                stats["audio_s"] += len(chunk_bytes) / 2 / engine.sample_rate
                stats["chunks"] += 1
                if stats["chunks"] % 200 == 0 and stats["audio_s"] > 0:
                    logger.info(
                        f"[ASR WS] {stats['chunks']} packets, real-time factor "
                        f"{stats['proc_s'] / stats['audio_s']:.3f}"
                    )
                await emit(events, channel)
                if isinstance(transcriber, DiarizedTranscriber) and transcriber.degraded:
                    # Too slow for live diarization: stop it and let the client switch to the manual toggle.
                    diar_too_slow = True
                    transcriber.close()
                    await emit(await asyncio.to_thread(transcriber.flush), channel)
                    transcribers.pop(channel, None)
                    await announce_status()
                continue

            text = message.get("text")
            if text:
                try:
                    payload = json.loads(text)
                except Exception:
                    continue
                msg_type = payload.get("type")
                if msg_type == "set_speaker":
                    requested = payload.get("speaker", "interviewer")
                    active_speaker = requested if requested in CHANNELS else "interviewer"
                    logger.info(f"[ASR WS] Manual fallback speaker set to: '{active_speaker}'")
                elif msg_type == "reset_buffer":
                    for transcriber in transcribers.values():
                        await asyncio.to_thread(transcriber.reset)
                    echo_guard = build_echo_guard()
                    roles.clear_assignment()  # voice slots restart in arrival order after a reset
                    logger.info("[ASR WS] Audio buffers & streaming state reset. Ready for next question!")
                elif msg_type in ("assign_last_speaker", "assign_speaker", "set_first_speaker"):
                    # Live correction of the voice -> role mapping ("That was me" / "That was the interviewer")
                    role = payload.get("role", "applicant")
                    mixed = transcribers.get(MIXED)
                    if msg_type == "set_first_speaker":
                        roles.set_first_speaker(role)
                    elif msg_type == "assign_speaker":
                        roles.assign(payload.get("speaker_index"), role)
                    elif isinstance(mixed, DiarizedTranscriber):
                        roles.assign(mixed.last_final_speaker, role)
                    logger.info(f"[ASR WS] Speaker roles updated: {roles.describe()}")
                    await send_json({"type": "diar_roles", **roles.describe()})
                elif msg_type == "flush":
                    for channel, transcriber in list(transcribers.items()):
                        await emit(await asyncio.to_thread(transcriber.flush), channel)

    except WebSocketDisconnect:
        logger.info("[ASR WS] Client disconnected")
    except Exception as e:
        logger.exception(f"[ASR WS] Error: {e}")
    finally:
        for transcriber in transcribers.values():
            if isinstance(transcriber, DiarizedTranscriber):
                transcriber.close()
        transcribers.clear()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
