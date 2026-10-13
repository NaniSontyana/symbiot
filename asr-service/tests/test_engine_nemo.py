"""
Integration test for ParakeetEOUEngine against the real NeMo streaming stack.

The real checkpoint is not downloaded; instead a tiny, randomly initialised
model with the same architecture as parakeet_realtime_eou_120m-v1
(cache-aware FastConformer, att_context [70, 1], 8x subsampling, RNNT, BPE
tokenizer with <EOU>) is built on the fly. That is enough to verify that:

  1. streamed mel features are bit-exact with offline feature extraction,
  2. encoder outputs and decoded tokens match NeMo's own cache-aware
     streaming loop driven over the same features,
  3. an emitted <EOU> token is reported as end-of-utterance.

Skipped automatically when nemo_toolkit is not installed.
"""

import sys
import tarfile

import numpy as np
import pytest

torch = pytest.importorskip("torch")
nemo_asr = pytest.importorskip("nemo.collections.asr")
spm = pytest.importorskip("sentencepiece")

from services.parakeet_eou_engine import LOG_MEL_ZERO, ParakeetEOUEngine  # noqa: E402

if (sys.version_info[:2] == (3, 11) and sys.version_info < (3, 11, 4)) or sys.version_info < (3, 10, 12):
    # NeMo passes tarfile's `filter=` argument (added in 3.10.12 / 3.11.4); shim it for old interpreters.
    for _name in ("extract", "extractall"):
        _orig = getattr(tarfile.TarFile, _name)

        def _wrapped(self, *args, _orig=_orig, **kwargs):
            kwargs.pop("filter", None)
            return _orig(self, *args, **kwargs)

        setattr(tarfile.TarFile, _name, _wrapped)


def _tiny_model_config(tokenizer_dir: str):
    from omegaconf import OmegaConf

    return OmegaConf.create({
        "sample_rate": 16000,
        "model_defaults": {"enc_hidden": 64, "pred_hidden": 32, "joint_hidden": 32},
        "tokenizer": {"dir": tokenizer_dir, "type": "bpe"},
        "preprocessor": {
            "_target_": "nemo.collections.asr.modules.AudioToMelSpectrogramPreprocessor",
            "sample_rate": 16000, "normalize": "NA", "window_size": 0.025, "window_stride": 0.01,
            "window": "hann", "features": 80, "n_fft": 512, "frame_splicing": 1,
            "dither": 0.00001, "pad_to": 0,
        },
        "encoder": {
            "_target_": "nemo.collections.asr.modules.ConformerEncoder",
            "feat_in": 80, "feat_out": -1, "n_layers": 2, "d_model": 64, "use_bias": True,
            "subsampling": "dw_striding", "subsampling_factor": 8, "subsampling_conv_channels": 32,
            "causal_downsampling": True, "ff_expansion_factor": 4, "self_attention_model": "rel_pos",
            "n_heads": 4, "att_context_size": [70, 1], "att_context_style": "chunked_limited",
            "xscaling": True, "pos_emb_max_len": 5000, "conv_kernel_size": 9,
            "conv_norm_type": "layer_norm", "conv_context_size": "causal",
            "dropout": 0.0, "dropout_pre_encoder": 0.0, "dropout_emb": 0.0, "dropout_att": 0.0,
        },
        "decoder": {
            "_target_": "nemo.collections.asr.modules.RNNTDecoder",
            "normalization_mode": None, "random_state_sampling": False, "blank_as_pad": True,
            "prednet": {"pred_hidden": 32, "pred_rnn_layers": 1, "t_max": None, "dropout": 0.0},
        },
        "joint": {
            "_target_": "nemo.collections.asr.modules.RNNTJoint",
            "log_softmax": None, "preserve_memory": False, "fuse_loss_wer": False,
            "jointnet": {"joint_hidden": 32, "activation": "relu", "dropout": 0.0},
        },
        "decoding": {"strategy": "greedy_batch", "greedy": {"max_symbols": 10}},
        "loss": {"loss_name": "default"},
        "optim": {"name": "adamw", "lr": 1e-3},
    })


@pytest.fixture(scope="module")
def engine(tmp_path_factory):
    work = tmp_path_factory.mktemp("tiny_parakeet")
    tok_dir = work / "tok"
    tok_dir.mkdir()
    words = ("what is the difference between http and websockets explain react hooks "
             "design a cache system tell me about yourself how would you scale a database").split()
    corpus = work / "corpus.txt"
    corpus.write_text("\n".join(" ".join(words[i % len(words):] + words[: i % len(words)]) for i in range(300)))
    spm.SentencePieceTrainer.train(
        input=str(corpus), model_prefix=str(tok_dir / "tokenizer"), vocab_size=64, model_type="bpe",
        user_defined_symbols=["<EOU>", "<EOB>"], character_coverage=1.0, minloglevel=2,
    )
    sp = spm.SentencePieceProcessor(model_file=str(tok_dir / "tokenizer.model"))
    (tok_dir / "vocab.txt").write_text("\n".join(sp.id_to_piece(i) for i in range(sp.get_piece_size())) + "\n")

    torch.manual_seed(0)
    model = nemo_asr.models.EncDecRNNTBPEModel(cfg=_tiny_model_config(str(tok_dir)))
    path = work / "tiny_eou.nemo"
    model.save_to(str(path))

    eng = ParakeetEOUEngine(model_name=str(path), device="cpu")
    eng.load()
    assert eng.is_ready, eng.load_error
    return eng


def _test_audio(n_chunks: int, chunk: int) -> np.ndarray:
    t = np.arange(n_chunks * chunk) / 16000
    rng = np.random.default_rng(1)
    sig = 0.3 * np.sin(2 * np.pi * 180 * t) * (0.5 + 0.5 * np.sin(2 * np.pi * 2.5 * t))
    return (sig + 0.05 * rng.standard_normal(t.shape)).astype(np.float32)


def test_streaming_features_are_exact(engine):
    n, C, F = 30, engine.chunk_samples, engine._chunk_frames
    audio = _test_audio(n, C)
    state = engine.create_stream_state()
    cols = []
    for i in range(n):
        engine._update_features(state, torch.from_numpy(audio[i * C:(i + 1) * C]))
        cols.append(state.feature_buffer[:, -F:].clone())
    streamed = torch.cat(cols, 1)
    with torch.no_grad():
        offline, _ = engine._preprocessor(input_signal=torch.from_numpy(audio)[None], length=torch.tensor([len(audio)]))
    lag = engine._lag_frames
    # global frame 0 is skipped: offline STFT pads the signal edge differently
    torch.testing.assert_close(streamed[:, lag + 1:], offline[0][:, 1:streamed.shape[1] - lag], rtol=0, atol=1e-5)


def test_engine_matches_nemo_cache_aware_loop(engine):
    from nemo.collections.asr.parts.utils.rnnt_utils import Hypothesis

    m = engine._model
    n, C, F = 30, engine.chunk_samples, engine._chunk_frames
    audio = _test_audio(n, C)

    # Engine run, capturing encoder outputs and features
    captured, feats = [], []
    orig = m.encoder.cache_aware_stream_step

    def recorder(*args, **kwargs):
        out = orig(*args, **kwargs)
        captured.append(out[0].clone())
        return out

    m.encoder.cache_aware_stream_step = recorder
    try:
        state = engine.create_stream_state()
        for i in range(n):
            engine.step(state, audio[i * C:(i + 1) * C])
            feats.append(state.feature_buffer[:, -F:].clone())
    finally:
        m.encoder.cache_aware_stream_step = orig
    engine_tokens = [int(x) for x in state.previous_hypotheses[0].y_sequence]

    # Reference: NeMo cache-aware loop (pre-encode cache + chunk, shift = 1 token) over the same features
    cfg = m.encoder.streaming_cfg
    pre = cfg.pre_encode_cache_size[1] if isinstance(cfg.pre_encode_cache_size, list) else cfg.pre_encode_cache_size
    chunk = cfg.chunk_size[1] if isinstance(cfg.chunk_size, list) else cfg.chunk_size
    seq = torch.cat([torch.full((feats[0].shape[0], F), LOG_MEL_ZERO)] + feats, 1)
    c1, c2, c3 = m.encoder.get_initial_cache_state(batch_size=1)
    hyps = [Hypothesis(score=0.0, y_sequence=[], dec_state=None, timestamp=[], last_token=None)]
    reference = []
    with torch.no_grad():
        for j in range(n):
            lo = F * j - pre
            seg = seq[:, max(lo, 0):F * j + chunk]
            if lo < 0:
                seg = torch.cat([torch.full((seq.shape[0], -lo), LOG_MEL_ZERO), seg], 1)
            enc, enc_len, c1, c2, c3 = m.encoder.cache_aware_stream_step(
                processed_signal=seg[None], processed_signal_length=torch.tensor([seg.shape[1]]),
                cache_last_channel=c1, cache_last_time=c2, cache_last_channel_len=c3,
                keep_all_outputs=False, drop_extra_pre_encoded=cfg.drop_extra_pre_encoded,
            )
            reference.append(enc.clone())
            hyps = m.decoding.rnnt_decoder_predictions_tensor(
                enc, enc_len, return_hypotheses=True, partial_hypotheses=hyps
            )
            if isinstance(hyps, tuple):
                hyps = hyps[0]

    assert torch.cat(captured, -1).shape[-1] == n  # one encoder frame (80 ms) per step
    torch.testing.assert_close(torch.cat(captured, -1), torch.cat(reference, -1), rtol=0, atol=1e-5)
    assert engine_tokens == [int(x) for x in hyps[0].y_sequence]


def test_eou_token_is_reported(engine):
    m = engine._model
    eou_id = m.tokenizer.token_to_id("<EOU>")
    last = [mod for mod in m.joint.joint_net.modules() if isinstance(mod, torch.nn.Linear)][-1]
    with torch.no_grad():
        last.bias[eou_id] += 50.0
    try:
        state = engine.create_stream_state()
        result = engine.step(state, np.zeros(engine.chunk_samples, dtype=np.float32))
    finally:
        with torch.no_grad():
            last.bias[eou_id] -= 50.0
    assert result.is_eou
    assert "<EOU>" not in result.text


def test_streams_are_isolated(engine):
    C = engine.chunk_samples
    audio = _test_audio(10, C)
    a, b = engine.create_stream_state(), engine.create_stream_state()
    solo = engine.create_stream_state()
    for i in range(10):
        chunk = audio[i * C:(i + 1) * C]
        engine.step(a, chunk)
        engine.step(b, np.zeros(C, dtype=np.float32))  # interleaved unrelated stream
        engine.step(solo, chunk)
    assert [int(x) for x in a.previous_hypotheses[0].y_sequence] == [
        int(x) for x in solo.previous_hypotheses[0].y_sequence
    ]
    torch.testing.assert_close(a.cache_last_channel, solo.cache_last_channel)
