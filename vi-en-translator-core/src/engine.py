"""Event-driven STT/MT engine used by the ingestion gateway."""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from .audio_utils import pcm_s16le_to_float32
from .logging_utils import latency_timer
from .terminology import TerminologyManager


@dataclass
class UtteranceState:
    source_id: str
    language_hint: str
    pcm: bytearray = field(default_factory=bytearray)
    started_at: float = field(default_factory=time.monotonic)
    last_sequence: int = -1


class TranslationEngine:
    """Coordinate ASR, terminology and MT without owning WebSocket transport."""

    def __init__(
        self,
        asr: Any,
        mt: Any,
        terminology: TerminologyManager | None = None,
        *,
        vad_revalidation: bool = False,
    ) -> None:
        self.asr = asr
        self.mt = mt
        self.terminology = terminology or TerminologyManager()
        self.vad_revalidation = vad_revalidation
        self.sessions: dict[str, dict[str, Any]] = {}
        self.sources: dict[str, dict[str, Any]] = {}
        self.utterances: dict[str, UtteranceState] = {}

    def on_session_start(self, session_id: str, source_id: str, **metadata: Any) -> None:
        """Register session metadata. This never loads or duplicates models."""

        self.sessions[session_id] = {"source_id": source_id, **metadata}

    def on_source_register(
        self,
        source_id: str,
        speaker_id: str | None,
        language_hint: str,
        **metadata: Any,
    ) -> None:
        """Store static source-to-speaker/language mapping from source.register."""

        self.sources[source_id] = {
            "speaker_id": speaker_id,
            "language_hint": language_hint or "auto",
            **metadata,
        }

    def on_utterance_start(
        self,
        utterance_id: str,
        source_id: str,
        start_time_ms: int = 0,
        **metadata: Any,
    ) -> None:
        """Open a new client-bounded utterance buffer; server VAD does not segment."""

        language = metadata.get("language_hint") or self.sources.get(source_id, {}).get("language_hint", "auto")
        self.utterances[utterance_id] = UtteranceState(source_id=source_id, language_hint=language)

    def on_audio_chunk(self, utterance_id: str, pcm_bytes: bytes, sequence: int) -> None:
        """Append PCM bytes. The gateway decides when to call partial/final decode."""

        state = self.utterances[utterance_id]
        state.pcm.extend(pcm_bytes)
        state.last_sequence = sequence

    def transcribe_partial(self, utterance_id: str) -> dict[str, Any]:
        """Decode all accumulated utterance audio with ASR partial mode."""

        state = self.utterances[utterance_id]
        metrics: dict[str, float] = {}
        with latency_timer(metrics, "t_partial"):
            result = self.asr.transcribe_partial(pcm_s16le_to_float32(bytes(state.pcm)), state.language_hint)
        return {
            "partial_transcript": result.get("text", ""),
            "confidence": float(result.get("confidence", 0.0)),
            "latency_ms": metrics,
        }

    def transcribe_final(self, utterance_id: str) -> dict[str, Any]:
        """Run final ASR, terminology lookup, then one MT pass."""

        state = self.utterances[utterance_id]
        audio = pcm_s16le_to_float32(bytes(state.pcm))
        metrics: dict[str, float] = {}
        with latency_timer(metrics, "asr_final"):
            asr_result = self.asr.transcribe_final(audio, state.language_hint)

        detected = asr_result.get("language") or state.language_hint
        source_language = detected if detected in {"vi", "en"} else ("vi" if state.language_hint == "auto" else state.language_hint)
        target_language = "en" if source_language == "vi" else "vi"
        forced_terms = self.terminology.term_pairs(asr_result.get("text", ""), source_language)

        with latency_timer(metrics, "mt"):
            translation = self.mt.translate(asr_result.get("text", ""), source_language, target_language, forced_terms)

        metrics["total_since_utterance_end"] = round(metrics["asr_final"] + metrics["mt"], 2)
        confidence = float(asr_result.get("confidence", 0.0))
        self.utterances.pop(utterance_id, None)
        return {
            "final_transcript": asr_result.get("text", ""),
            "translation": translation,
            "confidence": confidence,
            "low_confidence": confidence < 0.5,
            "latency_ms": metrics,
        }

    def process_chunk(self, audio_bytes: bytes, speaker_role: str, session_id: str) -> dict[str, Any]:
        """CLI wrapper for demos that do not pass through browser VAD/gateway."""

        utterance_id = f"cli-{uuid.uuid4()}"
        source_id = f"cli-{speaker_role}"
        language = "vi" if speaker_role.lower() in {"vi", "speaker-a", "a"} else "en"
        self.on_session_start(session_id, source_id)
        self.on_source_register(source_id, speaker_role, language)
        self.on_utterance_start(utterance_id, source_id, language_hint=language)
        self.on_audio_chunk(utterance_id, audio_bytes, 0)
        return self.transcribe_final(utterance_id)
