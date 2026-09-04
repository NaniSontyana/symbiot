import os
import json
import logging
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from services.vad import VoiceActivityDetector
from services.transcriber import ParakeetTranscriber

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("asr_app")

app = FastAPI(title="Symbiot ASR Streaming Microservice")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Read GROQ_API_KEY from backend-gateway/.env if present
groq_key = (os.getenv("GROQ_API_KEY") or "").strip().strip('"').strip("'")
if not groq_key and os.path.exists("../backend-gateway/.env"):
    try:
        with open("../backend-gateway/.env", "r") as f:
            for line in f:
                if line.startswith("GROQ_API_KEY="):
                    groq_key = line.strip().split("=", 1)[1].strip().strip('"').strip("'")
                    break
    except Exception:
        pass

interviewer_vad = VoiceActivityDetector()
applicant_vad = VoiceActivityDetector()
transcriber = ParakeetTranscriber(groq_api_key=groq_key)

@app.get("/health")
def health_check():
    has_groq = bool(transcriber.groq_api_key and transcriber.groq_api_key.startswith("gsk_"))
    return {
        "status": "healthy",
        "service": "symbiot-asr-service",
        "engine": "groq-whisper-v3-turbo (80ms)" if has_groq else getattr(transcriber, "model_name", "local-whisper")
    }

@app.websocket("/ws/transcribe")
async def websocket_transcribe(websocket: WebSocket):
    await websocket.accept()
    logger.info("[ASR WS] Client connected to real-time dual-channel speech pipeline")
    
    interviewer_buffer = bytearray()
    applicant_buffer = bytearray()
    MAX_BUFFER_SIZE = 16000 * 2 * 10
    active_speaker = "interviewer"
    
    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                logger.info("[ASR WS] Client disconnected cleanly")
                break

            if "bytes" in message and message["bytes"]:
                raw_bytes = message["bytes"]
                if len(raw_bytes) == 0:
                    continue

                # Check channel header prefix (0x01 = Interviewer / System, 0x02 = Applicant / Mic)
                if raw_bytes[0] in (0x01, 0x02):
                    channel = "interviewer" if raw_bytes[0] == 0x01 else "applicant"
                    chunk_bytes = raw_bytes[1:]
                else:
                    channel = active_speaker
                    chunk_bytes = raw_bytes

                target_buffer = interviewer_buffer if channel == "interviewer" else applicant_buffer
                target_vad = interviewer_vad if channel == "interviewer" else applicant_vad

                # Always buffer incoming audio bytes to prevent audio loss
                target_buffer.extend(chunk_bytes)

                # Evaluate Voice Activity Detection (VAD) independently per channel
                has_speech = target_vad.is_speech(chunk_bytes)
                
                # Transcribe upon complete utterance pause (min 0.4s audio) OR max speech buffer (~1.0s)
                should_transcribe = (target_vad.is_utterance_complete() and len(target_buffer) >= 12800) or (target_vad.has_speech_started and len(target_buffer) >= 32000) or (len(target_buffer) >= 32000)
                
                # If buffer reached 32,000 bytes without speech having started, clear silent background noise
                if len(target_buffer) >= 32000 and not target_vad.has_speech_started:
                    target_buffer.clear()
                    target_vad.reset()
                    should_transcribe = False

                if should_transcribe:
                    res = await asyncio.to_thread(transcriber.process_audio_buffer, bytes(target_buffer))
                    transcript_text, engine_used = res if isinstance(res, tuple) else (res, "whisper")
                    if transcript_text:
                        logger.info(f"[ASR WS] Transcribed [{channel}] [{engine_used}]: '{transcript_text}'")
                        try:
                            await websocket.send_json({
                                "type": "transcript_chunk",
                                "text": transcript_text,
                                "speaker": channel,
                                "engine": engine_used,
                                "is_final": True
                            })
                        except Exception as send_err:
                            logger.info(f"[ASR WS] Client disconnected before transcript send: {send_err}")
                        target_buffer.clear()
                        target_vad.reset()
                    else:
                        # Clear buffer if audio was silence or empty hallucination
                        target_buffer.clear()
                        target_vad.reset()
            elif "text" in message and message["text"]:
                try:
                    payload = json.loads(message["text"])
                    if payload.get("type") == "set_speaker":
                        active_speaker = payload.get("speaker", "interviewer")
                        logger.info(f"[ASR WS] Manual fallback speaker set to: '{active_speaker}'")
                    elif payload.get("type") == "reset_buffer":
                        interviewer_buffer.clear()
                        applicant_buffer.clear()
                        interviewer_vad.reset()
                        applicant_vad.reset()
                        logger.info("[ASR WS] ⚡ Audio buffers flushed & VAD reset. Ready for next question!")
                except Exception:
                    pass

            # Prevent memory overflow
            if len(interviewer_buffer) > MAX_BUFFER_SIZE:
                interviewer_buffer.clear()
            if len(applicant_buffer) > MAX_BUFFER_SIZE:
                applicant_buffer.clear()

    except WebSocketDisconnect:
        logger.info("[ASR WS] Client disconnected")
    except Exception as e:
        logger.error(f"[ASR WS] Error: {e}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
