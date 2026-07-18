from __future__ import annotations

import unittest

import numpy as np

from stt_service import config
from stt_service.eou import detect_eou
from stt_service.service import _is_repetitive_hallucination


def tone(ms: int, amplitude: float = 0.08) -> np.ndarray:
    n = int(config.SAMPLE_RATE * ms / 1000)
    t = np.arange(n, dtype=np.float32) / config.SAMPLE_RATE
    return (amplitude * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


def silence(ms: int) -> np.ndarray:
    return np.zeros(int(config.SAMPLE_RATE * ms / 1000), dtype=np.float32)


class EOUDetectionTest(unittest.TestCase):
    def test_detects_trailing_silence_endpoint(self) -> None:
        result = detect_eou(np.concatenate([tone(500), silence(config.EOU_END_SILENCE_MS)]))

        self.assertTrue(result.is_endpoint)
        self.assertEqual(result.reason, "trailing_silence")

    def test_reports_speaking_before_silence_threshold(self) -> None:
        result = detect_eou(np.concatenate([tone(500), silence(config.EOU_END_SILENCE_MS - 100)]))

        self.assertFalse(result.is_endpoint)
        self.assertEqual(result.reason, "speaking")

    def test_final_audio_is_endpoint(self) -> None:
        result = detect_eou(tone(100), is_final=True)

        self.assertTrue(result.is_endpoint)
        self.assertEqual(result.reason, "client_final")

    def test_max_duration_endpoint(self) -> None:
        result = detect_eou(tone(config.EOU_MAX_UTTERANCE_MS + 20))

        self.assertTrue(result.is_endpoint)
        self.assertEqual(result.reason, "max_duration")

    def test_detects_repeated_filler_hallucination(self) -> None:
        self.assertTrue(_is_repetitive_hallucination("Đấy. " * 20))
        self.assertFalse(
            _is_repetitive_hallucination(
                "Đây là một câu nói bình thường không bị lặp vô hạn."
            )
        )


if __name__ == "__main__":
    unittest.main()
