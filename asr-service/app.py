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

vad = VoiceActivityDetector()
transcriber = ParakeetTranscriber()

@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "service": "symbiot-asr-service",
        "engine": getattr(transcriber, "model_name", "whisper")
    }

@app.websocket("/ws/transcribe")
async def websocket_transcribe(websocket: WebSocket):
    await websocket.accept()
    logger.info("[ASR WS] Client connected to real-time speech pipeline")
    
    audio_buffer = bytearray()
    MAX_BUFFER_SIZE = 16000 * 2 * 10  # 10 seconds of 16kHz 16-bit audio
    
    try:
        while True:
            chunk_bytes = await websocket.receive_bytes()
            if not chunk_bytes:
                continue

            # Evaluate Voice Activity Detection (VAD)
            has_speech = vad.is_speech(chunk_bytes)
            
            if has_speech:
                audio_buffer.extend(chunk_bytes)
                
                # Run transcription when buffer reaches minimum size (~1.5s of speech audio)
                if len(audio_buffer) >= 48000:
                    transcript_text = transcriber.process_audio_buffer(bytes(audio_buffer))
                    if transcript_text:
                        logger.info(f"[ASR WS] Transcribed speech segment: '{transcript_text}'")
                        await websocket.send_json({
                            "type": "transcript_chunk",
                            "text": transcript_text,
                            "is_final": True
                        })
                        audio_buffer.clear()
            else:
                # Flush buffer on utterance completion (silence pause detected)
                if len(audio_buffer) >= 16000 and vad.is_utterance_complete():
                    transcript_text = transcriber.process_audio_buffer(bytes(audio_buffer))
                    if transcript_text:
                        logger.info(f"[ASR WS] Final utterance transcribed: '{transcript_text}'")
                        await websocket.send_json({
                            "type": "transcript_chunk",
                            "text": transcript_text,
                            "is_final": True
                        })
                    audio_buffer.clear()

            # Prevent memory overflow
            if len(audio_buffer) > MAX_BUFFER_SIZE:
                audio_buffer.clear()

    except WebSocketDisconnect:
        logger.info("[ASR WS] Client disconnected")
    except Exception as e:
        logger.error(f"[ASR WS] Error: {e}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
