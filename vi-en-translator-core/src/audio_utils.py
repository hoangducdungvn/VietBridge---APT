"""Tiện ích chuyển đổi PCM dùng chung cho gateway và engine."""

from __future__ import annotations

import wave
from pathlib import Path

import numpy as np


def pcm_s16le_to_float32(pcm_bytes: bytes) -> np.ndarray:
    """Đổi PCM signed 16-bit little-endian thành float32 trong [-1, 1]."""
    if len(pcm_bytes) % 2:
        raise ValueError("PCM s16le payload phải có số byte chẵn")
    return np.frombuffer(pcm_bytes, dtype="<i2").astype(np.float32) / 32768.0


def read_wav_pcm16_mono(path: str | Path) -> tuple[bytes, int]:
    """Đọc WAV PCM16 mono; từ chối profile không đúng contract."""
    with wave.open(str(path), "rb") as wav_file:
        if wav_file.getnchannels() != 1 or wav_file.getsampwidth() != 2:
            raise ValueError("WAV phải là PCM16 mono")
        return wav_file.readframes(wav_file.getnframes()), wav_file.getframerate()
