"""Giao diện TTS ngoài phạm vi MVP hiện tại."""

from __future__ import annotations

from typing import Protocol


class TextToSpeech(Protocol):
    """Hợp đồng tối thiểu để bổ sung TTS sau hackathon."""

    def synthesize(self, text: str, language: str) -> bytes: ...
