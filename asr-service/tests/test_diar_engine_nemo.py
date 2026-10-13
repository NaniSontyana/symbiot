"""
SortformerDiarEngine against NeMo's own streaming loop (runs only when NeMo is installed).

A tiny, randomly initialised Streaming Sortformer with the real architecture
(FastConformer + Transformer + SortformerModules) is built in memory. The engine
receives audio in uneven packets, as from the browser, and its per-frame speaker
probabilities must equal `SortformerEncLabelModel.forward_streaming()` on the
offline features of the same audio, including speaker-cache / FIFO updates (> 30 s).
"""

import inspect

import numpy as np
import pytest

torch = pytest.importorskip("torch")
pytest.importorskip("nemo.collections.asr")

from omegaconf import OmegaConf  # noqa: E402
from nemo.collections.asr.models import SortformerEncLabelModel  # noqa: E402
from nemo.collections.asr.modules.sortformer_modules import SortformerModules  # noqa: E402

from services.sortformer_diar_engine import SortformerDiarEngine  # noqa: E402

TINY_CFG = {
    "sample_rate": 16000,
    "pil_weight": 0.5,
    "ats_weight": 0.5,
    "max_num_of_spks": 4,
    "streaming_mode": True,
    "model_defaults": {"fc_d_model": 64, "tf_d_model": 32},
    "preprocessor": {
        "_target_": "nemo.collections.asr.modules.AudioToMelSpectrogramPreprocessor",
        "normalize": "NA", "window_size": 0.025, "sample_rate": 16000, "window_stride": 0.01,
        "window": "hann", "features": 128, "n_fft": 512, "frame_splicing": 1, "dither": 0.00001,
    },
    "sortformer_modules": {
        "_target_": "nemo.collections.asr.modules.sortformer_modules.SortformerModules",
        "num_spks": 4, "dropout_rate": 0.5, "fc_d_model": 64, "tf_d_model": 32,
        "spkcache_len": 188, "fifo_len": 188, "chunk_len": 6, "spkcache_update_period": 144,
        "chunk_left_context": 1, "chunk_right_context": 7, "spkcache_sil_frames_per_spk": 3,
        "scores_add_rnd": 0, "pred_score_threshold": 0.25, "max_index": 99999,
        "scores_boost_latest": 0.05, "sil_threshold": 0.2, "strong_boost_rate": 0.75,
        "weak_boost_rate": 1.5, "min_pos_scores_rate": 0.5, "causal_attn_rate": 0, "causal_attn_rc": 7,
    },
    "encoder": {
        "_target_": "nemo.collections.asr.modules.ConformerEncoder",
        "feat_in": 128, "feat_out": -1, "n_layers": 2, "d_model": 64, "subsampling": "dw_striding",
        "subsampling_factor": 8, "subsampling_conv_channels": 32, "causal_downsampling": False,
        "ff_expansion_factor": 4, "self_attention_model": "rel_pos", "n_heads": 4,
        "att_context_size": [-1, -1], "att_context_style": "regular", "xscaling": True,
        "untie_biases": True, "pos_emb_max_len": 5000, "conv_kernel_size": 9,
        "conv_norm_type": "batch_norm", "conv_context_size": None, "dropout": 0.1,
        "dropout_pre_encoder": 0.1, "dropout_emb": 0.0, "dropout_att": 0.1,
    },
    "transformer_encoder": {
        "_target_": "nemo.collections.asr.modules.transformer.transformer_encoders.TransformerEncoder",
        "num_layers": 2, "hidden_size": 32, "inner_size": 64, "num_attention_heads": 4,
        "attn_score_dropout": 0.5, "attn_layer_dropout": 0.5, "ffn_dropout": 0.5,
        "hidden_act": "relu", "pre_ln": False, "pre_ln_final_layer_norm": True,
    },
    "loss": {"_target_": "nemo.collections.asr.losses.bce_loss.BCELoss", "weight": None, "reduction": "mean"},
}


@pytest.fixture(scope="module")
def tiny_model():
    cfg = OmegaConf.create(TINY_CFG)
    allowed = set(inspect.signature(SortformerModules.__init__).parameters) | {"_target_"}
    for key in list(cfg.sortformer_modules.keys()):
        if key not in allowed:  # keep the test working across NeMo versions
            del cfg.sortformer_modules[key]
    torch.manual_seed(0)
    return SortformerEncLabelModel(cfg=cfg).eval()


def _two_voice_audio(seconds=40.0, sr=16000):
    rng = np.random.default_rng(0)
    t = np.arange(int(sr * seconds)) / sr
    audio = np.zeros_like(t, dtype=np.float32)
    for i, start in enumerate(np.arange(0, seconds, 2.5)):
        seg = (t >= start) & (t < start + 2.0)
        f0 = 140 if i % 2 == 0 else 230
        audio[seg] = 0.2 * np.sin(2 * np.pi * f0 * t[seg]) * (1 + 0.5 * np.sin(2 * np.pi * 3 * t[seg]))
    return audio + 0.01 * rng.standard_normal(audio.shape).astype(np.float32)


def test_streaming_matches_nemo_forward_streaming(tiny_model):
    engine = SortformerDiarEngine(device="cpu", chunk_len=6, chunk_right_context=7)
    engine._configure(tiny_model)
    audio = _two_voice_audio()

    with torch.inference_mode():
        signal = torch.from_numpy(audio).unsqueeze(0)
        feats, feat_len = tiny_model.process_signal(audio_signal=signal, audio_signal_length=torch.tensor([signal.shape[1]]))
        reference = tiny_model.forward_streaming(feats, feat_len)[0].numpy()

    state = engine.create_stream()
    outputs, pos, sizes = [], 0, [2048, 4096, 1280, 333, 8000]
    for k in range(10_000):
        if pos >= audio.size:
            break
        n = sizes[k % len(sizes)]
        outputs += engine.feed(state, audio[pos:pos + n])
        pos += n

    assert [first for first, _ in outputs] == list(range(0, 6 * len(outputs), 6))
    ours = np.concatenate([probs for _, probs in outputs])
    full_chunks = (int(feat_len[0]) - 7 * 8) // 48  # chunks that had full right context offline
    n = full_chunks * 6
    assert n > 450  # > 36 s: speaker cache and FIFO were both updated
    np.testing.assert_allclose(ours[:n], reference[:n], atol=1e-5)
    assert state.audio.size < 16000  # audio retained per stream stays bounded


def test_streams_are_independent_and_reset(tiny_model):
    engine = SortformerDiarEngine(device="cpu", chunk_len=6, chunk_right_context=7)
    engine._configure(tiny_model)
    audio = _two_voice_audio(seconds=4.0)
    a, b = engine.create_stream(), engine.create_stream()
    out_a = engine.feed(a, audio)
    engine.feed(b, np.zeros(8000, dtype=np.float32))  # interleaved other stream
    engine.reset_stream(a)
    out_a2 = engine.feed(a, audio)
    assert len(out_a) == len(out_a2) > 0
    for (fa, pa), (fb, pb) in zip(out_a, out_a2):
        assert fa == fb
        np.testing.assert_allclose(pa, pb, atol=1e-6)


def test_auto_chunk_picks_a_real_time_setting(tiny_model):
    engine = SortformerDiarEngine(device="cpu")  # chunk_len="auto"
    engine._configure(tiny_model)
    chosen = engine.choose_chunk_len()
    assert chosen in (6, 12, 24, 48)
    assert engine.step_secs > 0
    assert engine.latency_secs == pytest.approx((chosen + 7) * 0.08)
