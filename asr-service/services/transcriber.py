import os
import time
import struct
import io
import logging
import numpy as np
import urllib.request
import json

logger = logging.getLogger("asr_transcriber")

def normalize_audio(pcm_data: bytes, target_peak: float = 0.85) -> bytes:
    """
    Normalizes Int16 PCM audio peak volume to ~85% of full scale to boost low/soft microphone inputs.
    """
    if not pcm_data or len(pcm_data) < 4:
        return pcm_data

    aligned_len = len(pcm_data) - (len(pcm_data) % 2)
    samples = np.frombuffer(pcm_data[:aligned_len], dtype=np.int16).astype(np.float32)
    if len(samples) == 0:
        return pcm_data

    max_val = np.max(np.abs(samples))
    if max_val <= 0:
        return pcm_data

    scale = (32767.0 * target_peak) / max_val
    scale = min(scale, 4.0)  # Max gain cap of 4x (12dB) to prevent boosting silent noise floors

    if scale > 1.05:
        normalized_samples = np.clip(samples * scale, -32768, 32767).astype(np.int16)
        return normalized_samples.tobytes()
    return pcm_data

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
        self.groq_cooldown_until = 0.0

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

        # Check if rate-limited (HTTP 429 cooldown)
        if time.time() < self.groq_cooldown_until:
            return ""

        try:
            norm_audio = normalize_audio(audio_bytes)
            wav_bytes = pcm_to_wav(norm_audio)
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

            # 3. Add temperature=0.0 parameter for deterministic accuracy
            body.extend(f'--{boundary}\r\n'.encode('utf-8'))
            body.extend(b'Content-Disposition: form-data; name="temperature"\r\n\r\n')
            body.extend(b'0.0\r\n')

            # 4. Add response_format=json parameter
            body.extend(f'--{boundary}\r\n'.encode('utf-8'))
            body.extend(b'Content-Disposition: form-data; name="response_format"\r\n\r\n')
            body.extend(b'json\r\n')

            # 5. Natural clean prompt context without meta labels
            clean_prompt = "The candidate and interviewer are discussing software development, database design, vector indexing, system architecture, microservices, PostgreSQL, WebSockets, Python, React, and Node.js."
            body.extend(f'--{boundary}\r\n'.encode('utf-8'))
            body.extend(b'Content-Disposition: form-data; name="prompt"\r\n\r\n')
            body.extend(clean_prompt.encode('utf-8'))
            body.extend(b'\r\n')

            # 6. Add audio file payload
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
            err_str = str(err)
            if "429" in err_str:
                self.groq_cooldown_until = time.time() + 6.0
                logger.warning(f"[Groq Cloud STT] Rate limit (HTTP 429). Cooldown 6s activated, using local fallback.")
            else:
                logger.warning(f"[Groq Cloud STT] Error/fallback: {err}")
            return ""

    def clean_hallucination(self, text: str) -> str:
        if not text:
            return ""
        lower = text.lower().strip()
        hallucinations = [
          'sous-titrage', 'radio-canada', 'amara.org', 'subtitles by', 'thank you for watching',
          'subscribe to', 'pog.org', 'pyscript', 'psyche', 'shizuk', 'particip', 'mbc',
          'tentical', 'dicenical', 'ssshh'
        ]
        if any(h in lower for h in hallucinations):
            logger.info(f"[ASR Cleaner] Dropped subtitle hallucination: '{text}'")
            return ""
        return text

    def process_audio_buffer(self, audio_bytes: bytes) -> tuple:
        """
        Processes streaming audio Int16 PCM buffer into (transcript_text, engine_name)
        """
        if not audio_bytes or len(audio_bytes) < 3200:
            return "", "none"

        # 1. Try Groq Cloud Whisper (<90ms ultra-low latency)
        if self.groq_api_key:
            groq_text = self.transcribe_groq_cloud(audio_bytes)
            clean_text = self.clean_hallucination(groq_text)
            if clean_text:
                return clean_text, "groq-whisper-v3-turbo"

        # 2. Local Faster-Whisper Fallback
        if self.use_faster_whisper and self.model:
            try:
                norm_bytes = normalize_audio(audio_bytes)
                audio_np = np.frombuffer(norm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
                segments, _ = self.model.transcribe(
                    audio_np,
                    beam_size=1,
                    language="en",
                    vad_filter=True,
                    vad_parameters=dict(min_silence_duration_ms=250)
                )
                text = " ".join([segment.text for segment in segments]).strip()
                clean_text = self.clean_hallucination(text)
                if clean_text:
                    return clean_text, "local-faster-whisper"
            except Exception as e:
                logger.error(f"[Local Whisper Engine Error]: {e}")

        return "", "none"
