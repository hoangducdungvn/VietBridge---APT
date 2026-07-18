"""Protocol helpers for audio-streaming-contract.md v1.3."""

from __future__ import annotations

import json
import struct
from typing import Any

PROTOCOL_VERSION = "1.3"

SESSION_START = "session.start"
SESSION_ACCEPTED = "session.accepted"
SESSION_END = "session.end"
SOURCE_REGISTER = "source.register"
SOURCE_ACCEPTED = "source.accepted"
UTTERANCE_START = "utterance.start"
AUDIO_CHUNK = "audio.chunk"
UTTERANCE_END = "utterance.end"
STREAM_ACK = "stream.ack"
STREAM_RESUME = "stream.resume"
STREAM_THROTTLE = "stream.throttle"
HEARTBEAT_PING = "heartbeat.ping"
HEARTBEAT_PONG = "heartbeat.pong"
ERROR = "error"

STT_PARTIAL = "stt.partial"
TRANSLATION_FINAL = "translation.final"

CONTROL_EVENT_TYPES = {
    SESSION_START,
    SESSION_END,
    SOURCE_REGISTER,
    UTTERANCE_START,
    UTTERANCE_END,
    STREAM_RESUME,
    HEARTBEAT_PING,
}

SERVER_EVENT_TYPES = {
    SESSION_ACCEPTED,
    SOURCE_ACCEPTED,
    STREAM_ACK,
    STREAM_THROTTLE,
    HEARTBEAT_PONG,
    ERROR,
    STT_PARTIAL,
    TRANSLATION_FINAL,
}

REQUIRED_AUDIO_METADATA = (
    "session_id",
    "stream_id",
    "source_id",
    "utterance_id",
    "sequence",
    "capture_start_ms",
    "duration_ms",
)


class ProtocolError(ValueError):
    """Stable protocol error that can be serialized into an error event."""

    def __init__(self, message: str, code: str = "INVALID_EVENT") -> None:
        super().__init__(message)
        self.code = code


def validate_event(
    event: dict[str, Any],
    expected_type: str | None = None,
    *,
    allow_server_events: bool = False,
) -> dict[str, Any]:
    """Validate the shared JSON envelope and optional event type."""

    if event.get("protocol_version") != PROTOCOL_VERSION:
        raise ProtocolError(
            f"Only protocol_version={PROTOCOL_VERSION} is supported",
            "PROTOCOL_VERSION_UNSUPPORTED",
        )
    event_type = event.get("type")
    if not isinstance(event_type, str):
        raise ProtocolError("Missing string field: type")
    if expected_type is not None and event_type != expected_type:
        raise ProtocolError(f"Expected event type {expected_type}, got {event_type}")
    allowed = CONTROL_EVENT_TYPES | ({AUDIO_CHUNK} if expected_type == AUDIO_CHUNK else set())
    if allow_server_events:
        allowed |= SERVER_EVENT_TYPES
    if expected_type is None and event_type not in allowed:
        raise ProtocolError(f"Unsupported event type: {event_type}", "UNSUPPORTED_EVENT_TYPE")
    return event


def parse_control_json(raw_text: str | bytes) -> dict[str, Any]:
    """Parse a text WebSocket control frame and validate its v1.3 envelope."""

    if isinstance(raw_text, bytes):
        try:
            raw_text = raw_text.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ProtocolError("Control frame is not UTF-8") from exc
    try:
        event = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise ProtocolError("Control frame is not valid JSON") from exc
    if not isinstance(event, dict):
        raise ProtocolError("Control event must be a JSON object")
    return validate_event(event)


def validate_audio_metadata(metadata: dict[str, Any], payload_size: int) -> dict[str, Any]:
    """Validate the MVP-required metadata for a binary audio.chunk frame."""

    validate_event(metadata, AUDIO_CHUNK)
    for field_name in REQUIRED_AUDIO_METADATA:
        if field_name not in metadata:
            raise ProtocolError(f"Missing audio.chunk field: {field_name}")
    if not isinstance(metadata["sequence"], int) or metadata["sequence"] < 0:
        raise ProtocolError("audio.chunk sequence must be a non-negative integer")
    audio = metadata.get("audio")
    if not isinstance(audio, dict):
        raise ProtocolError("Missing audio object")
    if audio.get("codec") != "pcm_s16le":
        raise ProtocolError("Only pcm_s16le audio is supported", "UNSUPPORTED_AUDIO_FORMAT")
    if audio.get("sample_rate_hz") != 16000 or audio.get("channels") != 1:
        raise ProtocolError("Only 16 kHz mono audio is supported", "UNSUPPORTED_AUDIO_FORMAT")
    if audio.get("payload_bytes") != payload_size:
        raise ProtocolError("audio.payload_bytes does not match binary payload")
    if payload_size % 2:
        raise ProtocolError("PCM s16le payload must contain an even number of bytes")
    return metadata


def decode_binary_audio_frame(raw_bytes: bytes) -> tuple[dict[str, Any], bytes]:
    """Decode uint32-BE metadata length + metadata JSON + raw PCM payload."""

    if len(raw_bytes) < 4:
        raise ProtocolError("Binary frame is shorter than the 4-byte metadata prefix")
    metadata_length = struct.unpack(">I", raw_bytes[:4])[0]
    if metadata_length <= 0:
        raise ProtocolError("metadata_length must be positive")
    metadata_end = 4 + metadata_length
    if metadata_end > len(raw_bytes):
        raise ProtocolError("metadata_length exceeds frame size")
    try:
        metadata = json.loads(raw_bytes[4:metadata_end].decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ProtocolError("Binary frame metadata is not valid UTF-8 JSON") from exc
    if not isinstance(metadata, dict):
        raise ProtocolError("Binary frame metadata must be a JSON object")
    payload = raw_bytes[metadata_end:]
    validate_audio_metadata(metadata, len(payload))
    return metadata, payload


def encode_binary_audio_frame(metadata: dict[str, Any], pcm_payload: bytes) -> bytes:
    """Encode metadata and PCM payload using the contract's binary wire format."""

    metadata_copy = dict(metadata)
    metadata_copy["audio"] = dict(metadata_copy.get("audio", {}))
    metadata_copy["audio"]["payload_bytes"] = len(pcm_payload)
    validate_audio_metadata(metadata_copy, len(pcm_payload))
    metadata_bytes = json.dumps(metadata_copy, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return struct.pack(">I", len(metadata_bytes)) + metadata_bytes + pcm_payload
