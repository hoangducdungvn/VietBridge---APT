from __future__ import annotations

import os
import tempfile
from functools import lru_cache
from pathlib import Path

from faster_whisper import WhisperModel

from .schemas import TranscriptionResponse, TranscriptionSegment


def _device() -> str:
    configured = os.getenv("WHISPER_DEVICE", "auto")
    return configured if configured != "auto" else "cuda"


@lru_cache(maxsize=1)
def get_model() -> WhisperModel:
    device = _device()
    compute_type = os.getenv("WHISPER_COMPUTE_TYPE", "default")
    try:
        return WhisperModel(
            os.getenv("WHISPER_MODEL", "small"),
            device=device,
            compute_type=compute_type,
        )
    except Exception:
        if os.getenv("WHISPER_DEVICE", "auto") != "auto":
            raise
        return WhisperModel(
            os.getenv("WHISPER_MODEL", "small"),
            device="cpu",
            compute_type="int8",
        )


def transcribe_file(path: str | Path, language: str | None = None) -> TranscriptionResponse:
    segments_iter, info = get_model().transcribe(
        str(path),
        language=language or os.getenv("WHISPER_LANGUAGE") or None,
        beam_size=int(os.getenv("WHISPER_BEAM_SIZE", "5")),
        vad_filter=True,
    )
    segments = [
        TranscriptionSegment(start=item.start, end=item.end, text=item.text.strip())
        for item in segments_iter
    ]
    return TranscriptionResponse(
        text=" ".join(item.text for item in segments).strip(),
        language=info.language,
        language_probability=info.language_probability,
        duration=info.duration,
        segments=segments,
    )


def transcribe_bytes(data: bytes, suffix: str = ".wav", language: str | None = None) -> TranscriptionResponse:
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as audio_file:
        audio_file.write(data)
        path = Path(audio_file.name)
    try:
        return transcribe_file(path, language)
    finally:
        path.unlink(missing_ok=True)

