import unittest

import numpy as np

from stt_service import config, service
from stt_service.engine import EngineResult


class StubEngine:
    def __init__(self, text: str) -> None:
        self.calls = 0
        self.text = text

    def transcribe(self, audio, language_hint, fast, timeout_s):
        self.calls += 1
        return EngineResult(text=self.text)


def speech_audio(duration_s: float = 1.0) -> np.ndarray:
    samples = np.arange(int(config.SAMPLE_RATE * duration_s), dtype=np.float32)
    return (0.2 * np.sin(2 * np.pi * 220 * samples / config.SAMPLE_RATE)).astype(
        np.float32
    )


class VietnameseFinalFallbackTest(unittest.TestCase):
    def setUp(self) -> None:
        self.original_backend = config.BACKEND
        self.original_engines = service._engines
        config.BACKEND = "auto"

    def tearDown(self) -> None:
        config.BACKEND = self.original_backend
        service._engines = self.original_engines

    def test_empty_vietnamese_final_retries_on_vi_model(self) -> None:
        final_engine = StubEngine("")
        vi_engine = StubEngine("Day la cau tieng Viet day du.")
        service._engines = {"fpt_final": final_engine, "fpt": vi_engine}

        with self.assertLogs("stt_service.service", level="WARNING"):
            result = service.transcribe(
                "utt-vi-empty",
                speech_audio(),
                language_hint="vi",
                is_final=True,
            )

        self.assertEqual(result["text"], "Day la cau tieng Viet day du.")
        self.assertEqual(result["backend"], "fpt")
        self.assertEqual(final_engine.calls, 1)
        self.assertEqual(vi_engine.calls, 1)

    def test_nonempty_vietnamese_final_keeps_original_result(self) -> None:
        final_engine = StubEngine("Cau tieng Viet tu model final.")
        vi_engine = StubEngine("Khong duoc goi.")
        service._engines = {"fpt_final": final_engine, "fpt": vi_engine}

        result = service.transcribe(
            "utt-vi-ok",
            speech_audio(),
            language_hint="vi",
            is_final=True,
        )

        self.assertEqual(result["text"], "Cau tieng Viet tu model final.")
        self.assertEqual(result["backend"], "fpt_final")
        self.assertEqual(final_engine.calls, 1)
        self.assertEqual(vi_engine.calls, 0)

    def test_empty_english_final_does_not_use_vi_model(self) -> None:
        final_engine = StubEngine("")
        vi_engine = StubEngine("Khong duoc goi.")
        service._engines = {"fpt_final": final_engine, "fpt": vi_engine}

        result = service.transcribe(
            "utt-en-empty",
            speech_audio(),
            language_hint="en",
            is_final=True,
        )

        self.assertEqual(result["text"], "")
        self.assertEqual(result["backend"], "fpt_final")
        self.assertEqual(final_engine.calls, 1)
        self.assertEqual(vi_engine.calls, 0)


if __name__ == "__main__":
    unittest.main()
