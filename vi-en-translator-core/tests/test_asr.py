from __future__ import annotations

from types import SimpleNamespace

import numpy as np

from src.asr import WhisperASR


class Segment:
    text = " xin chao "
    avg_logprob = -0.2


class FakeWhisper:
    def __init__(self) -> None:
        self.calls: list[int] = []

    def transcribe(self, audio_np, **kwargs):
        self.calls.append(kwargs["beam_size"])
        return [Segment()], SimpleNamespace(language="vi")


def test_partial_and_final_use_different_beam_sizes() -> None:
    model = FakeWhisper()
    asr = WhisperASR("unused", model=model)

    partial = asr.transcribe_partial(np.zeros(160, dtype=np.float32), "vi")
    final = asr.transcribe_final(np.zeros(160, dtype=np.float32), "vi")

    assert model.calls == [1, 5]
    assert partial["text"] == "xin chao"
    assert final["language"] == "vi"
