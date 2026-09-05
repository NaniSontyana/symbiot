import numpy as np

class VoiceActivityDetector:
    """
    Enhanced Voice Activity Detector (VAD) with adaptive noise floor estimation and pause tracking
    """
    def __init__(self, base_energy_threshold: float = 0.00012, silence_duration_frames: int = 4):
        self.base_energy_threshold = base_energy_threshold
        self.silence_duration_frames = silence_duration_frames
        self.consecutive_silence = 0
        self.has_speech_started = False
        self.noise_floor = base_energy_threshold / 2.0

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

        energy = float(np.mean(audio_data ** 2))
        return energy

    def is_speech(self, audio_chunk: bytes) -> bool:
        energy = self.calculate_energy(audio_chunk)
        dynamic_threshold = max(self.base_energy_threshold, self.noise_floor * 2.2)

        if energy >= dynamic_threshold:
            self.consecutive_silence = 0
            self.has_speech_started = True
            return True
        else:
            # Adapt background noise floor during silence (exponential moving average)
            if not self.has_speech_started and energy > 0:
                self.noise_floor = 0.95 * self.noise_floor + 0.05 * energy

            self.consecutive_silence += 1
            return False

    def is_utterance_complete(self) -> bool:
        """
        Returns True when consecutive silence frames indicate speech paused/completed after speech started
        """
        return self.has_speech_started and (self.consecutive_silence >= self.silence_duration_frames)

    def reset(self):
        """
        Resets consecutive silence tracking counter and speech state
        """
        self.consecutive_silence = 0
        self.has_speech_started = False


