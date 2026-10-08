import os
import struct
import logging
import numpy as np
from typing import Tuple
from services.parakeet_eou_engine import ParakeetEOUEngine

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
    scale = min(scale, 8.0)

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
    NVIDIA Parakeet Realtime EOU 120M (`parakeet_realtime_eou_120m-v1`) Main Transcriber Wrapper.
    """
    def __init__(self, model_name: str = "nvidia/parakeet-realtime-eou-120m-v1"):
        self.model_name = model_name
        self.engine_type = "parakeet-realtime-eou-120m-v1"
        self.eou_engine = ParakeetEOUEngine(model_name=model_name, device="cpu")
        self._speaker_states = {
            "interviewer": self.eou_engine.create_stream_state(),
            "applicant": self.eou_engine.create_stream_state()
        }

    def process_audio_buffer(self, audio_bytes: bytes, speaker: str = "applicant") -> Tuple[str, str]:
        """
        Processes Int16 PCM streaming audio buffer using NVIDIA Parakeet Realtime EOU 120M CPU engine.
        
        Returns:
            Tuple[transcript_text, engine_name]
        """
        if not audio_bytes or len(audio_bytes) < 3200:
            return "", self.engine_type

        speaker_state = self._speaker_states.get(speaker, self._speaker_states["applicant"])
        transcript, is_eou, engine_used = self.eou_engine.process_chunk(audio_bytes, speaker_state)

        return transcript, engine_used
