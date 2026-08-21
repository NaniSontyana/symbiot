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
    return {"status": "healthy", "service": "symbiot-asr-service"}

@app.websocket("/ws/transcribe")
async def websocket_transcribe(websocket: WebSocket):
    await websocket.accept()
    logger.info("[ASR WS] Client connected to speech-to-text pipeline")
    
    try:
        while True:
            audio_bytes = await websocket.receive_bytes()
            
            # Check voice activity
            if vad.is_speech(audio_bytes):
                text_chunk = transcriber.process_audio_buffer(audio_bytes)
                if text_chunk:
                    await websocket.send_json({
                        "type": "transcript_chunk",
                        "text": text_chunk,
                        "is_final": True
                    })
    except WebSocketDisconnect:
        logger.info("[ASR WS] Client disconnected")
    except Exception as e:
        logger.error(f"[ASR WS] Error: {e}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
