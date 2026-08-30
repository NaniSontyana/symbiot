import numpy as np

class VoiceActivityDetector:
    """
    Enhanced Voice Activity Detector (VAD) with adaptive energy thresholding and silence tracking
    """
    def __init__(self, energy_threshold: float = 0.00002, silence_duration_frames: int = 4):
        self.energy_threshold = energy_threshold
        self.silence_duration_frames = silence_duration_frames
        self.consecutive_silence = 0

    def calculate_energy(self, audio_chunk: bytes) -> float:
        if not audio_chunk:
            return 0.0

        # Ensure byte length is multiple of 2 for Int16 alignment
        aligned_len = len(audio_chunk) - (len(audio_chunk) % 2)
        if aligned_len == 0:
            return 0.0

        # Convert raw bytes to 16-bit PCM numpy float array normalized to [-1.0, 1.0]
        audio_data = np.frombuffer(audio_chunk[:aligned_len], dtype=np.int16).astype(np.float32) / 32768.0
        if len(audio_data) == 0:
            return 0.0

        energy = np.mean(audio_data ** 2)
        return float(energy)

    def is_speech(self, audio_chunk: bytes) -> bool:
        energy = self.calculate_energy(audio_chunk)
        if energy >= self.energy_threshold:
            self.consecutive_silence = 0
            return True
        else:
            self.consecutive_silence += 1
            return False

    def is_utterance_complete(self) -> bool:
        """
        Returns True when consecutive silence frames indicate speech paused/completed
        """
        return self.consecutive_silence >= self.silence_duration_frames

    def reset(self):
        """
        Resets consecutive silence tracking counter
        """
        self.consecutive_silence = 0
