import numpy as np

class VoiceActivityDetector:
    """
    Lightweight Voice Activity Detector (VAD) to filter background noise and silence
    """
    def __init__(self, energy_threshold: float = 0.015):
        self.energy_threshold = energy_threshold

    def is_speech(self, audio_chunk: bytes) -> bool:
        if not audio_chunk:
            return False
        
        # Convert raw bytes to 16-bit PCM numpy float array
        audio_data = np.frombuffer(audio_chunk, dtype=np.int16).astype(np.float32) / 32768.0
        energy = np.mean(audio_data ** 2)
        
        return energy >= self.energy_threshold
