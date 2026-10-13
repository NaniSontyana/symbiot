"""
Streaming speaker diarization with NVIDIA Streaming Sortformer
(`nvidia/diar_streaming_sortformer_4spk-v2.1`, up to 4 speakers).

Used in mic-only mode, where the interviewer (laptop speakers / same room) and the
candidate are captured by ONE microphone and must be told apart by voice.

Sortformer outputs, every 80 ms frame, an activity probability per speaker slot.
Slots are ordered by *arrival time*: slot 0 is the first voice heard on the stream,
slot 1 the second, and so on. Across chunks the model keeps a speaker cache and a
FIFO of past embeddings, so slot identities stay stable for the whole session.

Design mirrors `parakeet_eou_engine.py`:
  * `SortformerDiarEngine` owns the shared model (weights only).
  * `DiarStreamState` holds everything for one audio stream.

Chunking follows NeMo's own streaming loop (`SortformerModules.streaming_feat_loader`
+ `SortformerEncLabelModel.forward_streaming_step`). The voice-agent reference
(`nemo/agents/voice_agent/pipecat/services/nemo/streaming_diar.py`) keeps a rolling
mel buffer; here each chunk's mel features are computed from raw audio with a
safety margin so they are bit-exact with offline extraction. That lets the
streaming output be validated against `forward_streaming()` on the same audio.

Default latency setting is the model card's "low latency" row:
chunk 6 frames (0.48 s) + right context 7 frames (0.56 s) = 1.04 s.

Compute cost per step is dominated by the ~30 s speaker-cache + FIFO context, not by
the chunk, so a bigger chunk is the main lever on slow CPUs. With `chunk_len="auto"`
(default) the engine times one full-context step at load time. It then picks the
smallest chunk from AUTO_CHUNK_CANDIDATES that runs at <= `target_rtf` of real time
(e.g. 0.48 s chunks on a GPU, about 1-2 s chunks on a laptop CPU).
"""

from __future__ import annotations

import logging
import math
import threading
from dataclasses import dataclass
from typing import Any, List, Optional, Tuple

import numpy as np

logger = logging.getLogger("sortformer_diar_engine")

DEFAULT_DIAR_MODEL = "nvidia/diar_streaming_sortformer_4spk-v2.1"
AUTO_CHUNK_CANDIDATES = (6, 12, 24, 48)  # 0.48 s, 0.96 s, 1.92 s, 3.84 s


@dataclass
class DiarStreamState:
    """All mutable state for one diarized audio stream."""

    audio: np.ndarray  # retained float32 samples, audio[0] is global sample `audio_start`
    audio_start: int = 0
    total_samples: int = 0
    next_chunk: int = 0
    sortformer_state: Any = None
    chunk_len: int = 6


class SortformerDiarEngine:
    """Shared, thread-safe wrapper around a streaming Sortformer diarization model."""

    def __init__(
        self,
        model_name: str = DEFAULT_DIAR_MODEL,
        device: Optional[str] = None,
        chunk_len="auto",
        chunk_left_context: int = 1,
        chunk_right_context: int = 7,
        fifo_len: int = 188,
        spkcache_len: int = 188,
        spkcache_update_period: int = 144,
        sample_rate: int = 16000,
        target_rtf: float = 0.6,
    ):
        self.model_name = model_name
        self.requested_device = device
        self.device = None
        self.auto_chunk = str(chunk_len).lower() == "auto"
        self.chunk_len = AUTO_CHUNK_CANDIDATES[0] if self.auto_chunk else int(chunk_len)
        self.target_rtf = target_rtf
        self.step_secs: Optional[float] = None  # measured cost of one full-context step
        self.chunk_left_context = int(chunk_left_context)
        self.chunk_right_context = int(chunk_right_context)
        self.fifo_len = int(fifo_len)
        self.spkcache_len = int(spkcache_len)
        self.spkcache_update_period = int(spkcache_update_period)
        self.sample_rate = sample_rate

        self.engine_type = "diar_streaming_sortformer"
        self.is_ready = False
        self.load_error: Optional[str] = None
        self.num_speakers = 4

        # Geometry (filled in by load(); defaults match the released models)
        self.hop_samples = 160  # 10 ms mel hop
        self.subsampling = 8  # 8 mel frames per diarization frame
        self.frame_secs = 0.08
        self._margin_frames = 4  # extra mel frames each side so every STFT window is complete

        self._lock = threading.Lock()
        self._model = None
        self._preprocessor = None

    # ------------------------------------------------------------------ loading
    @property
    def latency_secs(self) -> float:
        return (self.chunk_len + self.chunk_right_context) * self.frame_secs

    def load(self) -> None:
        """Download (first run) and initialise the model. Blocking; call once."""
        try:
            import torch
            from nemo.collections.asr.models import SortformerEncLabelModel
        except Exception as import_err:  # pragma: no cover - depends on env
            self.load_error = f"NVIDIA NeMo is not installed (needs nemo_toolkit[asr]): {import_err}"
            logger.error("[Sortformer] %s", self.load_error)
            return

        try:
            device = self.requested_device or ("cuda" if torch.cuda.is_available() else "cpu")
            self.device = torch.device(device)
            logger.info("[Sortformer] Loading '%s' on %s ...", self.model_name, self.device)
            if self.model_name.endswith(".nemo"):
                model = SortformerEncLabelModel.restore_from(self.model_name, map_location=self.device)
            else:
                model = SortformerEncLabelModel.from_pretrained(self.model_name, map_location=self.device)
            self._configure(model)
            if self.auto_chunk:
                self.choose_chunk_len()
            logger.info(
                "[Sortformer] Ready: %d speakers, chunk %.2fs, latency %.2fs, step %s",
                self.num_speakers, self.chunk_len * self.frame_secs, self.latency_secs,
                f"{self.step_secs * 1000:.0f} ms" if self.step_secs else "n/a",
            )
        except Exception as load_err:  # pragma: no cover - depends on env / network
            self.load_error = f"{type(load_err).__name__}: {load_err}"
            logger.exception("[Sortformer] Failed to load diarization model")

    def _configure(self, model) -> None:
        """Apply streaming parameters to a loaded model (also used by tests)."""
        model.eval()
        modules = model.sortformer_modules
        modules.chunk_len = self.chunk_len
        modules.chunk_left_context = self.chunk_left_context
        modules.chunk_right_context = self.chunk_right_context
        modules.fifo_len = self.fifo_len
        modules.spkcache_len = self.spkcache_len
        modules.spkcache_update_period = self.spkcache_update_period
        modules.log = False
        if hasattr(modules, "_check_streaming_parameters"):
            modules._check_streaming_parameters()

        pre_cfg = model.cfg.preprocessor
        self.hop_samples = int(round(float(pre_cfg.window_stride) * self.sample_rate))
        n_fft = int(pre_cfg.get("n_fft", 512))
        self._margin_frames = max(4, math.ceil((n_fft // 2 + 1) / self.hop_samples) + 1)
        self.subsampling = int(modules.subsampling_factor)
        self.frame_secs = self.hop_samples * self.subsampling / self.sample_rate
        self.num_speakers = int(modules.n_spk)
        self._preprocessor = model.preprocessor
        self._preprocessor.eval()
        self._model = model
        self.load_error = None
        self.is_ready = True

    def set_chunk_len(self, chunk_len: int) -> None:
        """Change the chunk size. Only affects streams created afterwards."""
        self.chunk_len = int(chunk_len)
        if self._model is not None:
            self._model.sortformer_modules.chunk_len = self.chunk_len

    def benchmark_step(self, repeats: int = 2) -> float:
        """Seconds for one streaming step with full speaker cache + FIFO (worst case)."""
        import time
        import torch

        modules = self._model.sortformer_modules
        frames = self.spkcache_len + self.fifo_len + self.chunk_left_context + self.chunk_len + self.chunk_right_context
        embs = torch.randn(1, frames, modules.fc_d_model, device=self.device)
        lengths = torch.tensor([frames], device=self.device)
        best = float("inf")
        with self._lock, torch.inference_mode():
            for _ in range(max(repeats, 1) + 1):  # first run warms up kernels
                started = time.perf_counter()
                enc, enc_len = self._model.frontend_encoder(
                    processed_signal=embs, processed_signal_length=lengths, bypass_pre_encode=True
                )
                self._model.forward_infer(enc, enc_len)
                if self.device is not None and self.device.type == "cuda":
                    torch.cuda.synchronize()
                best = min(best, time.perf_counter() - started)
        return best

    def choose_chunk_len(self, candidates=AUTO_CHUNK_CANDIDATES) -> int:
        """Pick the lowest-latency chunk this machine can run in real time with headroom."""
        chosen = candidates[-1]
        for chunk in candidates:
            self.set_chunk_len(chunk)
            self.step_secs = self.benchmark_step()
            if self.step_secs <= self.target_rtf * chunk * self.frame_secs:
                chosen = chunk
                break
        self.set_chunk_len(chosen)
        logger.info(
            "[Sortformer] Auto chunk: %d frames (%.2f s), step %.0f ms, expected RTF %.2f",
            chosen, chosen * self.frame_secs, self.step_secs * 1000, self.step_secs / (chosen * self.frame_secs),
        )
        return chosen

    # ------------------------------------------------------------ stream state
    def create_stream(self) -> DiarStreamState:
        state = DiarStreamState(audio=np.zeros(0, dtype=np.float32))
        state.chunk_len = self.chunk_len  # fixed for the lifetime of the stream
        self.reset_stream(state)
        return state

    def reset_stream(self, state: DiarStreamState) -> None:
        state.audio = np.zeros(0, dtype=np.float32)
        state.audio_start = 0
        state.total_samples = 0
        state.next_chunk = 0
        state.sortformer_state = None
        if self._model is not None:
            state.sortformer_state = self._model.sortformer_modules.init_streaming_state(
                batch_size=1, async_streaming=self._model.async_streaming, device=self.device
            )

    # -------------------------------------------------------------- inference
    def feed(self, state: DiarStreamState, samples: np.ndarray) -> List[Tuple[int, np.ndarray]]:
        """
        Append float32 16 kHz samples. Runs every chunk that now has its full right
        context and returns `[(first_frame_index, probs[chunk_len, num_speakers]), ...]`.
        Frame `g` covers audio [g * frame_secs, (g + 1) * frame_secs) of this stream.
        """
        if not self.is_ready:
            raise RuntimeError("Sortformer diarization model is not loaded")
        samples = np.asarray(samples, dtype=np.float32).reshape(-1)
        if samples.size:
            state.audio = np.concatenate([state.audio, samples])
            state.total_samples += samples.size

        outputs: List[Tuple[int, np.ndarray]] = []
        chunk_len = getattr(state, "chunk_len", self.chunk_len)
        chunk_feats = chunk_len * self.subsampling
        while True:
            start_feat = state.next_chunk * chunk_feats
            end_feat = start_feat + chunk_feats
            right_feats = self.chunk_right_context * self.subsampling
            needed = (end_feat + right_feats + self._margin_frames) * self.hop_samples
            if state.total_samples < needed:
                break
            left_feats = min(self.chunk_left_context * self.subsampling, start_feat)
            probs = self._run_chunk(state, start_feat - left_feats, end_feat + right_feats, left_feats, right_feats)
            outputs.append((state.next_chunk * chunk_len, probs))
            state.next_chunk += 1
            self._trim(state)
        return outputs

    def _features(self, state: DiarStreamState, feat_lo: int, feat_hi: int):
        """Mel features for global frames [feat_lo, feat_hi), identical to offline extraction."""
        import torch

        margin = self._margin_frames
        s0 = (feat_lo - margin) * self.hop_samples
        s1 = (feat_hi + margin) * self.hop_samples
        lo = s0 - state.audio_start
        segment = state.audio[max(lo, 0): s1 - state.audio_start]
        if lo < 0:  # before the start of the stream: zeros, like the STFT's constant padding
            segment = np.concatenate([np.zeros(-lo, dtype=np.float32), segment])
        signal = torch.from_numpy(np.ascontiguousarray(segment)).unsqueeze(0).to(self.device)
        length = torch.tensor([signal.shape[1]], device=self.device)
        feats, _ = self._preprocessor(input_signal=signal, length=length)
        return feats[:, :, margin: margin + (feat_hi - feat_lo)]  # [1, n_mels, T]

    def _run_chunk(self, state, feat_lo, feat_hi, left_feats, right_feats) -> np.ndarray:
        import torch

        with self._lock, torch.inference_mode():
            feats = self._features(state, feat_lo, feat_hi).transpose(1, 2)  # [1, T, n_mels]
            lengths = torch.tensor([feats.shape[1]], device=self.device)
            empty = torch.zeros((1, 0, self.num_speakers), device=self.device)
            state.sortformer_state, chunk_preds = self._model.forward_streaming_step(
                processed_signal=feats,
                processed_signal_length=lengths,
                streaming_state=state.sortformer_state,
                total_preds=empty,  # only this chunk is returned; avoids unbounded growth
                left_offset=left_feats,
                right_offset=right_feats,
            )
        return chunk_preds[0].float().cpu().numpy()

    def _trim(self, state: DiarStreamState) -> None:
        """Drop audio that no future chunk (incl. left context and margin) will read."""
        next_start = state.next_chunk * getattr(state, "chunk_len", self.chunk_len) * self.subsampling
        keep_from_feat = next_start - self.chunk_left_context * self.subsampling - self._margin_frames
        keep_from = max(keep_from_feat * self.hop_samples, 0)
        drop = keep_from - state.audio_start
        if drop > 0:
            state.audio = state.audio[drop:]
            state.audio_start = keep_from
