"""
Cache-aware streaming inference for NVIDIA Parakeet Realtime EOU 120M
(`nvidia/parakeet_realtime_eou_120m-v1`).

The model is a cache-aware streaming FastConformer encoder with an RNNT decoder.
It consumes 80 ms audio chunks and emits an `<EOU>` token when the speaker has
finished an utterance.

Design:
  * `ParakeetEOUEngine` owns the (heavy) model and is shared process-wide.
    It is stateless between calls: every call receives a `StreamState`.
  * `StreamState` holds everything that belongs to ONE audio stream
    (one speaker channel of one WebSocket connection): the rolling audio /
    mel-feature buffers, the encoder attention + convolution caches and the
    RNNT partial hypothesis.

The step logic follows NVIDIA's reference implementation used by NeMo Voice Agent
(`nemo/agents/voice_agent/pipecat/services/nemo/streaming_asr.py` and `utils.py`,
Apache-2.0), adapted so that the feature extractor is shared, the per-stream
state is explicit, and mel features are bit-exact with offline extraction
(frames are emitted with a 10 ms lag so every STFT window is complete).
"""

from __future__ import annotations

import logging
import math
import threading
from dataclasses import dataclass
from typing import Any, List, Optional, Sequence

import numpy as np

logger = logging.getLogger("parakeet_eou_engine")

DEFAULT_MODEL_NAME = "nvidia/parakeet_realtime_eou_120m-v1"
EOU_TOKEN = "<EOU>"
EOB_TOKEN = "<EOB>"  # end-of-backchannel ("uh-huh", "yeah"), also ends a turn
LOG_MEL_ZERO = -16.635  # log-mel value of a zero (silent) signal
_SENTENCEPIECE_SPACE = "\u2581"  # '▁'


@dataclass
class StepResult:
    """Output of one 80 ms streaming step."""

    text: str  # newly decoded text for this chunk (end-of-turn markers removed)
    is_eou: bool  # True when the model emitted <EOU>/<EOB> in this chunk


@dataclass
class StreamState:
    """All mutable state for a single audio stream."""

    sample_buffer: Any  # torch.Tensor [buffer_samples]
    feature_buffer: Any  # torch.Tensor [n_mels, buffer_frames]
    cache_last_channel: Any = None
    cache_last_time: Any = None
    cache_last_channel_len: Any = None
    previous_hypotheses: Optional[list] = None
    steps: int = 0


class ParakeetEOUEngine:
    """Shared, thread-safe wrapper around the Parakeet Realtime EOU model."""

    def __init__(
        self,
        model_name: str = DEFAULT_MODEL_NAME,
        device: Optional[str] = None,
        att_context_size: Sequence[int] = (70, 1),
        chunk_size_in_secs: float = 0.08,
        sample_rate: int = 16000,
    ):
        self.model_name = model_name
        self.requested_device = device
        self.device = None
        self.att_context_size = list(att_context_size)
        self.chunk_size_in_secs = chunk_size_in_secs
        self.sample_rate = sample_rate
        self.chunk_samples = int(round(chunk_size_in_secs * sample_rate))

        self.engine_type = "parakeet_realtime_eou_120m-v1"
        self.is_ready = False
        self.load_error: Optional[str] = None

        self._lock = threading.Lock()
        self._model = None
        self._preprocessor = None
        self._blank_id = None

    # ------------------------------------------------------------------ loading
    def load(self) -> None:
        """Download (first run) and initialise the model. Blocking; call once."""
        try:
            import torch
            from omegaconf import open_dict
            import nemo.collections.asr as nemo_asr
        except Exception as import_err:  # pragma: no cover - depends on env
            self.load_error = (
                "NVIDIA NeMo is not installed. Install it with "
                "`pip install -r requirements.txt` (needs nemo_toolkit[asr]). "
                f"Import error: {import_err}"
            )
            logger.error("[Parakeet EOU] %s", self.load_error)
            return

        try:
            if self.requested_device:
                device = self.requested_device
            else:
                device = "cuda" if torch.cuda.is_available() else "cpu"
            self.device = torch.device(device)

            logger.info("[Parakeet EOU] Loading '%s' on %s ...", self.model_name, self.device)
            if self.model_name.endswith(".nemo"):
                model = nemo_asr.models.ASRModel.restore_from(self.model_name, map_location=self.device)
            else:
                model = nemo_asr.models.ASRModel.from_pretrained(self.model_name, map_location=self.device)

            if not hasattr(model, "joint"):
                raise ValueError("Expected an RNNT (transducer) model for Parakeet Realtime EOU")

            # Attention context [left, right] = [70, 1] is what the model was trained for (80 ms latency).
            if hasattr(model.encoder, "set_default_att_context_size"):
                model.encoder.set_default_att_context_size(att_context_size=self.att_context_size)

            # Greedy, alignment-preserving decoding so we can read per-chunk tokens.
            decoding_cfg = model.cfg.decoding
            with open_dict(decoding_cfg):
                decoding_cfg.strategy = "greedy"
                decoding_cfg.compute_timestamps = False
                decoding_cfg.preserve_alignments = True
                decoding_cfg.fused_batch_size = -1
                decoding_cfg.greedy.max_symbols = 10
            model.change_decoding_strategy(decoding_cfg)

            # Streaming geometry (all in mel frames unless stated otherwise).
            window_stride = float(model.cfg.preprocessor.window_stride)  # 0.01 s
            subsampling = int(model.cfg.encoder.subsampling_factor)  # 8
            streaming_cfg = model.encoder.streaming_cfg
            model_chunk_frames = streaming_cfg.chunk_size
            if isinstance(model_chunk_frames, (list, tuple)):
                model_chunk_frames = model_chunk_frames[1]
            pre_encode_cache = streaming_cfg.pre_encode_cache_size
            if isinstance(pre_encode_cache, (list, tuple)):
                pre_encode_cache = pre_encode_cache[1]

            tokens_per_chunk = math.ceil(np.trunc(self.chunk_size_in_secs / window_stride) / subsampling)
            model.encoder.setup_streaming_params(
                chunk_size=model_chunk_frames // subsampling, shift_size=tokens_per_chunk
            )
            self._drop_extra_pre_encoded = model.encoder.streaming_cfg.drop_extra_pre_encoded

            # Encoder input per step = pre-encode cache + model chunk, in mel frames.
            buffer_secs = (pre_encode_cache + model_chunk_frames) * window_stride
            self._buffer_frames = int(round(buffer_secs / window_stride))
            self._chunk_frames = int(round(self.chunk_size_in_secs / window_stride))
            self._configure_exact_features(model.cfg.preprocessor, window_stride)

            # Dedicated feature extractor without dithering for deterministic streaming features.
            preproc_cfg = model.cfg.preprocessor.copy()
            with open_dict(preproc_cfg):
                preproc_cfg.dither = 0.0
                preproc_cfg.pad_to = 0
            self._n_mels = int(preproc_cfg.features)
            self._preprocessor = nemo_asr.models.ASRModel.from_config_dict(preproc_cfg).to(self.device)
            self._preprocessor.eval()

            model.eval()
            self._model = model
            self._blank_id = len(model.tokenizer.vocab)
            self.is_ready = True
            self.load_error = None
            logger.info(
                "[Parakeet EOU] Ready: chunk=%.0f ms, encoder window=%.2f s, feature lag=%d ms, att_context=%s, device=%s",
                self.chunk_size_in_secs * 1000,
                buffer_secs,
                self._lag_frames * self._hop * 1000 // self.sample_rate,
                self.att_context_size,
                self.device,
            )
        except Exception as load_err:  # pragma: no cover - depends on env / network
            self.load_error = f"Failed to load '{self.model_name}': {load_err}"
            logger.exception("[Parakeet EOU] %s", self.load_error)

    # ------------------------------------------------------------ stream state
    def create_stream_state(self) -> StreamState:
        self._require_ready()
        import torch

        state = StreamState(
            sample_buffer=torch.zeros(self._segment_samples, dtype=torch.float32),
            feature_buffer=torch.full(
                (self._n_mels, self._buffer_frames), LOG_MEL_ZERO, dtype=torch.float32, device=self.device
            ),
        )
        self.reset_stream_state(state)
        return state

    def reset_stream_state(self, state: StreamState) -> None:
        """Clear audio history, encoder caches and decoder hypothesis for a stream."""
        self._require_ready()
        from nemo.collections.asr.parts.utils.rnnt_utils import Hypothesis

        state.sample_buffer.zero_()
        state.feature_buffer.fill_(LOG_MEL_ZERO)
        (
            state.cache_last_channel,
            state.cache_last_time,
            state.cache_last_channel_len,
        ) = self._model.encoder.get_initial_cache_state(batch_size=1)
        state.previous_hypotheses = [
            Hypothesis(score=0.0, y_sequence=[], dec_state=None, timestamp=[], last_token=None)
        ]
        state.steps = 0

    # -------------------------------------------------------------- inference
    def step(self, state: StreamState, samples: np.ndarray) -> StepResult:
        """
        Run one streaming step on exactly `chunk_samples` float32 samples in [-1, 1].
        """
        self._require_ready()
        import torch

        if samples.shape[0] != self.chunk_samples:
            raise ValueError(f"Expected {self.chunk_samples} samples per step, got {samples.shape[0]}")

        with self._lock, torch.no_grad():
            self._update_features(state, torch.from_numpy(np.ascontiguousarray(samples, dtype=np.float32)))

            features = state.feature_buffer.unsqueeze(0)  # [1, n_mels, frames]
            feature_lengths = torch.tensor([features.shape[2]], device=self.device)

            (
                encoded,
                encoded_len,
                state.cache_last_channel,
                state.cache_last_time,
                state.cache_last_channel_len,
            ) = self._model.encoder.cache_aware_stream_step(
                processed_signal=features,
                processed_signal_length=feature_lengths,
                cache_last_channel=state.cache_last_channel,
                cache_last_time=state.cache_last_time,
                cache_last_channel_len=state.cache_last_channel_len,
                keep_all_outputs=False,
                drop_extra_pre_encoded=self._drop_extra_pre_encoded,
            )

            hypotheses = self._model.decoding.rnnt_decoder_predictions_tensor(
                encoded,
                encoded_len,
                return_hypotheses=True,
                partial_hypotheses=state.previous_hypotheses,
            )
            if isinstance(hypotheses, tuple):  # older NeMo returns (best, all)
                hypotheses = hypotheses[0]
            state.previous_hypotheses = hypotheses
            state.steps += 1

            tokens = self._tokens_from_alignments(hypotheses[0].alignments)

        raw_text = self._tokens_to_text(tokens)
        is_eou = EOU_TOKEN in raw_text or EOB_TOKEN in raw_text
        text = raw_text.replace(EOU_TOKEN, " ").replace(EOB_TOKEN, " ")
        return StepResult(text=text, is_eou=is_eou)

    # ---------------------------------------------------------------- helpers
    def _require_ready(self) -> None:
        if not self.is_ready:
            raise RuntimeError(self.load_error or "Parakeet EOU model is not loaded yet")

    def _configure_exact_features(self, preproc_cfg, window_stride: float) -> None:
        """
        Work out how much audio history is needed so that every mel frame emitted
        per step is computed from a complete STFT window (bit-exact with offline
        feature extraction). Frames whose window would reach past the newest
        sample are deferred to the next step, i.e. features lag by `_lag_frames`
        (10 ms for this model).
        """
        hop = int(round(window_stride * self.sample_rate))  # 160
        n_fft = int(preproc_cfg.get("n_fft") or 0) or int(round(preproc_cfg.window_size * self.sample_rate))
        half = n_fft // 2  # torch.stft(center=True) reaches n_fft/2 samples either side
        frames = self._chunk_frames
        if frames * hop != self.chunk_samples:
            raise ValueError("Audio chunk must be a whole number of feature hops")

        # Right edge: newest emitted frame centre + half window must not pass the chunk end.
        lag = max(0, math.ceil((frames - 1) - (self.chunk_samples - half) / hop))
        # Left edge: oldest emitted frame centre - half window must lie inside the segment.
        lookback = hop * math.ceil((lag * hop + half) / hop)

        self._hop = hop
        self._lag_frames = lag
        self._lookback_samples = lookback
        self._segment_samples = lookback + self.chunk_samples
        self._first_frame = (lookback - lag * hop) // hop  # index of first emitted frame in segment

    def _update_features(self, state: StreamState, audio) -> None:
        """Shift the new chunk into the sample buffer and append its exact mel frames."""
        import torch

        shift = audio.shape[0]
        state.sample_buffer[:-shift] = state.sample_buffer[shift:].clone()
        state.sample_buffer[-shift:] = audio

        signal = state.sample_buffer.unsqueeze(0).to(self.device)
        signal_len = torch.tensor([signal.shape[1]], device=self.device)
        features, _ = self._preprocessor(input_signal=signal, length=signal_len)
        new_frames = features[0, :, self._first_frame : self._first_frame + self._chunk_frames]

        fb = state.feature_buffer
        fb[:, : -self._chunk_frames] = fb[:, self._chunk_frames :].clone()
        fb[:, -self._chunk_frames :] = new_frames

    def _tokens_from_alignments(self, alignments) -> List[int]:
        tokens: List[int] = []
        if not alignments:
            return tokens
        for frame in alignments:
            for _logits, token_id in frame:
                token_id = int(token_id)
                if token_id != self._blank_id:
                    tokens.append(token_id)
        return tokens

    def _tokens_to_text(self, tokens: List[int]) -> str:
        if not tokens:
            return ""
        pieces = self._model.tokenizer.ids_to_tokens(tokens)
        return "".join(
            p.replace(_SENTENCEPIECE_SPACE, " ") if p.startswith(_SENTENCEPIECE_SPACE) else p for p in pieces
        )

