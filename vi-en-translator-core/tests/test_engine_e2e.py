from __future__ import annotations

from src.engine import TranslationEngine


class FakeASR:
    def transcribe_partial(self, audio_np, language):
        return {"text": "xin", "confidence": 0.6, "language": language}

    def transcribe_final(self, audio_np, language):
        return {"text": "xin chao", "confidence": 0.9, "language": "vi"}


class FakeMT:
    def translate(self, text, source_language, target_language, forced_terms=None):
        return "hello"


def test_engine_event_driven_pipeline_with_mocks() -> None:
    engine = TranslationEngine(FakeASR(), FakeMT())
    engine.on_session_start("meeting-1", "mic-a")
    engine.on_source_register("mic-a", "speaker-a", "vi")
    engine.on_utterance_start("utt-1", "mic-a")
    engine.on_audio_chunk("utt-1", b"\x00\x00" * 160, 0)

    partial = engine.transcribe_partial("utt-1")
    final = engine.transcribe_final("utt-1")

    assert partial["partial_transcript"] == "xin"
    assert final["final_transcript"] == "xin chao"
    assert final["translation"] == "hello"
    assert "utt-1" not in engine.utterances
