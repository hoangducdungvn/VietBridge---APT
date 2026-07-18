"""Session/source/stream state machine for client-owned utterance boundaries."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from .protocol import HEARTBEAT_PONG, PROTOCOL_VERSION, STREAM_ACK


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


@dataclass
class ChunkResult:
    accepted: bool
    should_emit_partial: bool = False
    pcm_snapshot: bytes = b""
    highest_contiguous_sequence: int = -1
    error: str | None = None


@dataclass
class StreamState:
    session_id: str | None = None
    source_id: str | None = None
    speaker_id: str | None = None
    participant_id: str | None = None
    language_hint: str = "auto"
    expected_sequence: int | None = None
    highest_contiguous_sequence: int = -1
    current_utterance_id: str | None = None
    utterance_buffer: bytearray = field(default_factory=bytearray)
    last_frame_at: float = field(default_factory=time.monotonic)
    last_partial_at: float = field(default_factory=time.monotonic)


class SessionManager:
    """Track one logical stream per WebSocket, with cumulative ACK semantics."""

    def __init__(self, partial_interval_s: float = 1.0) -> None:
        self.streams: dict[str, StreamState] = {}
        self.partial_interval_s = partial_interval_s

    def register_stream(
        self,
        stream_id: str,
        *,
        session_id: str | None = None,
        source_id: str | None = None,
    ) -> StreamState:
        state = self.streams.setdefault(stream_id, StreamState())
        if session_id is not None:
            state.session_id = session_id
        if source_id is not None:
            state.source_id = source_id
        return state

    def register_source(
        self,
        stream_id: str,
        *,
        source_id: str,
        speaker_id: str | None,
        participant_id: str | None = None,
        language_hint: str = "auto",
    ) -> StreamState:
        state = self.register_stream(stream_id, source_id=source_id)
        state.speaker_id = speaker_id
        state.participant_id = participant_id
        state.language_hint = language_hint or "auto"
        return state

    def start_utterance(
        self,
        stream_id: str,
        utterance_id: str,
        *,
        language_hint: str | None = None,
    ) -> StreamState:
        state = self.register_stream(stream_id)
        state.current_utterance_id = utterance_id
        state.utterance_buffer.clear()
        state.last_partial_at = time.monotonic()
        if language_hint:
            state.language_hint = language_hint
        return state

    def handle_audio_chunk(
        self,
        stream_id: str,
        utterance_id: str,
        sequence: int,
        pcm: bytes,
    ) -> ChunkResult:
        state = self.register_stream(stream_id)
        if state.current_utterance_id != utterance_id:
            return ChunkResult(False, error="audio.chunk does not match the open utterance")
        if state.expected_sequence is not None and sequence != state.expected_sequence:
            return ChunkResult(False, error=f"expected sequence {state.expected_sequence}, got {sequence}")

        state.utterance_buffer.extend(pcm)
        state.highest_contiguous_sequence = sequence
        state.expected_sequence = sequence + 1
        state.last_frame_at = time.monotonic()

        now = time.monotonic()
        should_emit_partial = now - state.last_partial_at >= self.partial_interval_s
        if should_emit_partial:
            state.last_partial_at = now
        return ChunkResult(
            True,
            should_emit_partial=should_emit_partial,
            pcm_snapshot=bytes(state.utterance_buffer),
            highest_contiguous_sequence=state.highest_contiguous_sequence,
        )

    def handle_utterance_end(self, stream_id: str, utterance_id: str) -> tuple[bytes, int]:
        state = self.register_stream(stream_id)
        if state.current_utterance_id != utterance_id:
            return b"", state.highest_contiguous_sequence
        data = bytes(state.utterance_buffer)
        state.current_utterance_id = None
        state.utterance_buffer.clear()
        return data, state.highest_contiguous_sequence

    def resume(self, stream_id: str, next_sequence: int) -> StreamState:
        state = self.register_stream(stream_id)
        state.expected_sequence = next_sequence
        state.highest_contiguous_sequence = next_sequence - 1
        state.last_frame_at = time.monotonic()
        return state

    def stream_ack(self, session_id: str, stream_id: str) -> dict[str, Any]:
        state = self.register_stream(stream_id, session_id=session_id)
        return {
            "protocol_version": PROTOCOL_VERSION,
            "type": STREAM_ACK,
            "session_id": session_id,
            "stream_id": stream_id,
            "highest_contiguous_sequence": state.highest_contiguous_sequence,
            "missing_sequences": [],
            "server_time": utc_now(),
        }

    def heartbeat_pong(self, event: dict[str, Any]) -> dict[str, Any]:
        return {
            "protocol_version": PROTOCOL_VERSION,
            "type": HEARTBEAT_PONG,
            "event_id": f"{event.get('event_id', 'heartbeat')}-pong",
            "session_id": event.get("session_id"),
            "stream_id": event.get("stream_id"),
            "in_reply_to": event.get("event_id", event.get("sent_at")),
            "server_time": utc_now(),
        }
