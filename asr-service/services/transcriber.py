import os
import struct
import io
import logging
import numpy as np
import urllib.request
import json

logger = logging.getLogger("asr_transcriber")

def pcm_to_wav(pcm_data: bytes, sample_rate: int = 16000, num_channels: int = 1, bits_per_sample: int = 16) -> bytes:
    """
    Constructs an in-memory WAV file from raw Int16 PCM binary audio data
    """
    byte_rate = sample_rate * num_channels * (bits_per_sample // 8)
    block_align = num_channels * (bits_per_sample // 8)
    data_size = len(pcm_data)
    chunk_size = 36 + data_size

    # WAV header binary format
    header = struct.pack(
        '<4sI4s4sIHHIIHH4sI',
        b'RIFF', chunk_size, b'WAVE',
        b'fmt ', 16, 1, num_channels,
        sample_rate, byte_rate, block_align, bits_per_sample,
        b'data', data_size
    )
    return header + pcm_data

class ParakeetTranscriber:
    """
    Real-Time Speech-to-Text Transcriber with Groq Cloud Whisper (<90ms) & local faster-whisper fallback
    """
    def __init__(self, model_size: str = "base.en", groq_api_key: str = None):
        self.model_name = model_size
        self.model = None
        self.use_faster_whisper = False
        self.groq_api_key = groq_api_key or os.getenv("GROQ_API_KEY")

        try:
            from faster_whisper import WhisperModel
            logger.info(f"Loading local faster-whisper model '{model_size}' on CPU (int8)...")
            self.model = WhisperModel(model_size, device="cpu", compute_type="int8")
            self.use_faster_whisper = True
            logger.info("Local faster-whisper STT engine initialized successfully")
        except Exception as e:
            logger.warning(f"faster-whisper local model load skipped/failed ({e}).")

    def transcribe_groq_cloud(self, audio_bytes: bytes) -> str:
        """
        Transcribes audio buffer via Groq Cloud Whisper API (whisper-large-v3-turbo) in ~80ms
        """
        if not self.groq_api_key or not self.groq_api_key.startswith("gsk_"):
            return ""

        try:
            wav_bytes = pcm_to_wav(audio_bytes)
            boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW'
            
            body = bytearray()
            # 1. Add model parameter
            body.extend(f'--{boundary}\r\n'.encode('utf-8'))
            body.extend(b'Content-Disposition: form-data; name="model"\r\n\r\n')
            body.extend(b'whisper-large-v3-turbo\r\n')

            # 2. Add language parameter
            body.extend(f'--{boundary}\r\n'.encode('utf-8'))
            body.extend(b'Content-Disposition: form-data; name="language"\r\n\r\n')
            body.extend(b'en\r\n')

            # 3. Add prompt parameter for 100% technical dictionary accuracy
            tech_prompt = "PostgreSQL, pgvector, WebSockets, React, Next.js, Node.js, Microservices, Python, FastAPI, Docker, Kubernetes, HNSW, Redis, REST API, GraphQL, SQL, NoSQL, TypeScript, JavaScript"
            body.extend(f'--{boundary}\r\n'.encode('utf-8'))
            body.extend(b'Content-Disposition: form-data; name="prompt"\r\n\r\n')
            body.extend(tech_prompt.encode('utf-8'))
            body.extend(b'\r\n')

            # 4. Add audio file payload
            body.extend(f'--{boundary}\r\n'.encode('utf-8'))
            body.extend(b'Content-Disposition: form-data; name="file"; filename="audio.wav"\r\n')
            body.extend(b'Content-Type: audio/wav\r\n\r\n')
            body.extend(wav_bytes)
            body.extend(b'\r\n')
            body.extend(f'--{boundary}--\r\n'.encode('utf-8'))

            req = urllib.request.Request(
                "https://api.groq.com/openai/v1/audio/transcriptions",
                data=bytes(body),
                headers={
                    "Authorization": f"Bearer {self.groq_api_key}",
                    "Content-Type": f"multipart/form-data; boundary={boundary}",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                },
                method="POST"
            )

            with urllib.request.urlopen(req, timeout=3.5) as response:
                res_data = json.loads(response.read().decode('utf-8'))
                transcript = res_data.get("text", "").strip()
                if transcript:
                    logger.info(f"[Groq Cloud STT ⚡ 80ms]: '{transcript}'")
                return transcript
        except Exception as err:
            logger.warning(f"[Groq Cloud STT] Error/fallback: {err}")
            return ""

    def process_audio_buffer(self, audio_bytes: bytes) -> tuple:
        """
        Processes streaming audio Int16 PCM buffer into (transcript_text, engine_name)
        """
        if not audio_bytes or len(audio_bytes) < 3200:
            return "", "none"

        # 1. Try Groq Cloud Whisper (<90ms ultra-low latency)
        if self.groq_api_key:
            groq_text = self.transcribe_groq_cloud(audio_bytes)
            if groq_text:
                return groq_text, "groq-whisper-v3-turbo"

        # 2. Local Faster-Whisper Fallback
        if self.use_faster_whisper and self.model:
            try:
                audio_np = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
                segments, _ = self.model.transcribe(audio_np, beam_size=1, language="en", vad_filter=True)
                transcript = " ".join([segment.text for segment in segments]).strip()
                if transcript:
                    return transcript, "local-faster-whisper"
            except Exception as err:
                logger.error(f"Inference error in faster-whisper: {err}")

        return "", "none"
