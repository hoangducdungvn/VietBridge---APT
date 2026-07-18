from __future__ import annotations

import numpy as np

from src.vad import SpeechChunker, revalidate_utterance


def test_vad_revalidation_uses_injected_detector() -> None:
    audio = np.zeros(160, dtype=np.float32)

    assert revalidate_utterance(audio, SpeechChunker(detector=lambda _: True))
