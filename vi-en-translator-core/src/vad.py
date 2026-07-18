"""VAD chỉ dành cho CLI hoặc revalidation tùy chọn; gateway tin boundary client."""

from __future__ import annotations

import logging
from typing import Any

import numpy as np

LOGGER = logging.getLogger(__name__)


class SpeechChunker:
    """Adapter VAD nhẹ, có thể tiêm detector để test mà không tải model."""

    def __init__(self, detector: Any | None = None, threshold: float = 0.5) -> None:
        self.detector = detector
        self.threshold = threshold

    def contains_speech(self, audio_np: np.ndarray) -> bool:
        """Kiểm tra speech; fallback RMS chỉ phục vụ demo độc lập."""
        if self.detector is not None:
            return bool(self.detector(audio_np))
        return bool(audio_np.size and float(np.sqrt(np.mean(np.square(audio_np)))) > 0.01)


def revalidate_utterance(audio_np: np.ndarray, chunker: SpeechChunker | None = None) -> bool:
    """Revalidate tùy chọn trước ASR; mặc định bị tắt trong config theo D5."""
    # TODO: Nếu bật, gateway gọi hàm này trên audio đã tích lũy; không re-segment.
    found = (chunker or SpeechChunker()).contains_speech(audio_np)
    if not found:
        LOGGER.warning("Server-side VAD revalidation không tìm thấy speech")
    return found
