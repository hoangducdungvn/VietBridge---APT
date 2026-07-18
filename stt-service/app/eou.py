"""Lightweight server-side End Of Utterance detection.

This is an advisory fallback for STT callers. The primary realtime EOU path
still lives in the browser VAD pipeline, but the STT service can now report
whether the accumulated audio appears to have reached an endpoint.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from . import config


@dataclass(frozen=True)
class EOUResult:
    is_endpoint: bool
    reason: str
    speech_ms: int
    trailing_silence_ms: int
    duration_ms: int

    def to_dict(self) -> dict:
        return {
            "is_endpoint": self.is_endpoint,
            "reason": self.reason,
            "speech_ms": self.speech_ms,
            "trailing_silence_ms": self.trailing_silence_ms,
            "duration_ms": self.duration_ms,
        }


def _frame_is_speech(frame: np.ndarray) -> bool:
    if frame.size == 0:
        return False
    rms = float(np.sqrt(np.mean(np.square(frame))))
    peak = float(np.max(np.abs(frame)))
    return rms >= config.EOU_SPEECH_RMS or peak >= config.EOU_SPEECH_PEAK


def detect_eou(audio: np.ndarray, is_final: bool = False) -> EOUResult:
    """Detect whether an accumulated utterance has ended.

    The algorithm is intentionally simple and deterministic: split audio into
    fixed frames, estimate speech frames by RMS/peak, then require enough speech
    followed by enough trailing silence. It is meant as server-side metadata,
    not a replacement for client VAD.
    """
    audio = np.asarray(audio, dtype=np.float32).reshape(-1)
    duration_ms = int(round(audio.size / config.SAMPLE_RATE * 1000))

    if is_final:
        return EOUResult(True, "client_final", duration_ms, 0, duration_ms)
    if not config.EOU_ENABLED:
        return EOUResult(False, "disabled", 0, 0, duration_ms)
    if audio.size == 0:
        return EOUResult(False, "empty", 0, duration_ms, duration_ms)

    frame_size = max(1, int(config.SAMPLE_RATE * config.EOU_FRAME_MS / 1000))
    speech_frames: list[bool] = []
    for start in range(0, audio.size, frame_size):
        speech_frames.append(_frame_is_speech(audio[start : start + frame_size]))

    speech_count = sum(1 for is_speech in speech_frames if is_speech)
    speech_ms = speech_count * config.EOU_FRAME_MS
    if speech_ms < config.EOU_MIN_SPEECH_MS:
        return EOUResult(False, "insufficient_speech", speech_ms, duration_ms, duration_ms)

    trailing_silence_frames = 0
    for is_speech in reversed(speech_frames):
        if is_speech:
            break
        trailing_silence_frames += 1
    trailing_silence_ms = trailing_silence_frames * config.EOU_FRAME_MS

    if duration_ms >= config.EOU_MAX_UTTERANCE_MS:
        return EOUResult(True, "max_duration", speech_ms, trailing_silence_ms, duration_ms)
    if trailing_silence_ms >= config.EOU_END_SILENCE_MS:
        return EOUResult(True, "trailing_silence", speech_ms, trailing_silence_ms, duration_ms)
    return EOUResult(False, "speaking", speech_ms, trailing_silence_ms, duration_ms)
