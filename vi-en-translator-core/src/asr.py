"""Whisper ASR wrapper with separate partial and final decode modes."""

from __future__ import annotations

from typing import Any

import numpy as np


class WhisperASR:
    """Load faster-whisper only at instance creation, never at module import."""

    def __init__(
        self,
        model_path: str = "tiny",
        *,
        model: Any | None = None,
        local_files_only: bool = True,
        device: str = "cpu",
        compute_type: str = "int8",
        partial_beam_size: int = 1,
        final_beam_size: int = 5,
    ) -> None:
        self.partial_beam_size = partial_beam_size
        self.final_beam_size = final_beam_size
        if model is not None:
            self.model = model
            return
        try:
            from faster_whisper import WhisperModel
        except ImportError as exc:
            raise RuntimeError("faster-whisper is not installed; run pip install -r requirements.txt") from exc
        self.model = WhisperModel(
            model_path,
            device=device,
            compute_type=compute_type,
            local_files_only=local_files_only,
        )

    def _transcribe(
        self,
        audio_np: np.ndarray,
        language: str | None,
        beam_size: int,
        initial_prompt: str | None,
    ) -> dict[str, Any]:
        segments, info = self.model.transcribe(
            audio_np,
            language=None if language == "auto" else language,
            beam_size=beam_size,
            vad_filter=False,
            condition_on_previous_text=False,
            initial_prompt=initial_prompt,
        )
        segment_list = list(segments)
        text = " ".join(segment.text.strip() for segment in segment_list if segment.text.strip()).strip()
        probabilities = [float(getattr(segment, "avg_logprob", -1.0)) for segment in segment_list]
        confidence = 0.0
        if probabilities:
            confidence = max(0.0, min(1.0, 1.0 + (sum(probabilities) / len(probabilities))))
        return {
            "text": text,
            "confidence": round(confidence, 4),
            "language": getattr(info, "language", language),
        }

    def transcribe_partial(
        self,
        audio_np: np.ndarray,
        language: str | None,
        initial_prompt: str | None = None,
    ) -> dict[str, Any]:
        """Decode all accumulated audio quickly with the configured partial beam."""

        return self._transcribe(audio_np, language, self.partial_beam_size, initial_prompt)

    def transcribe_final(
        self,
        audio_np: np.ndarray,
        language: str | None,
        initial_prompt: str | None = None,
    ) -> dict[str, Any]:
        """Decode final utterance audio with the configured final beam."""

        return self._transcribe(audio_np, language, self.final_beam_size, initial_prompt)

class LazyWhisperASR:
    """Defer loading faster-whisper until the first decode call."""

    def __init__(
        self,
        model_path: str = "tiny",
        *,
        local_files_only: bool = True,
        device: str = "cpu",
        compute_type: str = "int8",
        partial_beam_size: int = 1,
        final_beam_size: int = 5,
    ) -> None:
        self.model_path = model_path
        self.local_files_only = local_files_only
        self.device = device
        self.compute_type = compute_type
        self.partial_beam_size = partial_beam_size
        self.final_beam_size = final_beam_size
        self._delegate: WhisperASR | None = None

    def _ensure_delegate(self) -> WhisperASR:
        if self._delegate is None:
            self._delegate = WhisperASR(
                self.model_path,
                local_files_only=self.local_files_only,
                device=self.device,
                compute_type=self.compute_type,
                partial_beam_size=self.partial_beam_size,
                final_beam_size=self.final_beam_size,
            )
        return self._delegate

    def transcribe_partial(
        self,
        audio_np: np.ndarray,
        language: str | None,
        initial_prompt: str | None = None,
    ) -> dict[str, Any]:
        return self._ensure_delegate().transcribe_partial(audio_np, language, initial_prompt)

    def transcribe_final(
        self,
        audio_np: np.ndarray,
        language: str | None,
        initial_prompt: str | None = None,
    ) -> dict[str, Any]:
        return self._ensure_delegate().transcribe_final(audio_np, language, initial_prompt)
