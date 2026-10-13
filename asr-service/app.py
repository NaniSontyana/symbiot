import os
import json
import time
import asyncio
import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from services.echo_guard import EchoGuard
from services.parakeet_eou_engine import DEFAULT_MODEL_NAME, ParakeetEOUEngine
from services.transcriber import ChannelTranscriber, TranscriberConfig
from services.vad import VoiceActivityDetector

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("asr_app")

CHANNELS = ("interviewer", "applicant")
CHANNEL_HEADERS = {0x01: "interviewer", 0x02: "applicant"}


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except ValueError:
        return default


def build_engine() -> ParakeetEOUEngine:
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


def build_vad() -> VoiceActivityDetector:
    return VoiceActivityDetector(base_energy_threshold=_env_float("ASR_VAD_ENERGY_THRESHOLD", 0.000003))


# Shared model (weights only). All per-stream state lives in ChannelTranscriber instances.
engine = build_engine()


def _load_engine_in_background() -> None:
    if engine.is_ready:
        return
    threading.Thread(target=engine.load, name="parakeet-loader", daemon=True).start()


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
    }


@app.websocket("/ws/transcribe")
async def websocket_transcribe(websocket: WebSocket):
    await websocket.accept()
    logger.info("[ASR WS] Client connected to real-time dual-channel speech pipeline")

    # Per-connection state: one independent streaming transcriber per speaker channel.
    transcribers = {}
    echo_guard = build_echo_guard()  # drops interviewer audio that leaked into the mic
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
        status = _engine_status()
        if status != last_status_sent:
            last_status_sent = status
            await send_json({"type": "asr_status", "status": status, "message": engine.load_error})

    def get_transcriber(channel: str) -> ChannelTranscriber:
        if channel not in transcribers:
            transcribers[channel] = ChannelTranscriber(
                engine, channel, config=build_transcriber_config(), vad=build_vad()
            )
        return transcribers[channel]

    async def emit(events, channel: str):
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
                    logger.info("[ASR WS] Audio buffers & streaming state reset. Ready for next question!")
                elif msg_type == "flush":
                    for channel, transcriber in list(transcribers.items()):
                        await emit(await asyncio.to_thread(transcriber.flush), channel)

    except WebSocketDisconnect:
        logger.info("[ASR WS] Client disconnected")
    except Exception as e:
        logger.exception(f"[ASR WS] Error: {e}")
    finally:
        transcribers.clear()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
