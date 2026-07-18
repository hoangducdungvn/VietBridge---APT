"""Output events sent from STT/MT back over the same WebSocket."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from .protocol import PROTOCOL_VERSION, STT_PARTIAL, TRANSLATION_FINAL, validate_event


def sent_at_utc() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def partial_event(
    session_id: str,
    stream_id: str,
    utterance_id: str,
    result: dict[str, Any],
) -> dict[str, Any]:
    """Build a stt.partial event as documented in docs/stt-mt-output-contract.md."""

    event = {
        "protocol_version": PROTOCOL_VERSION,
        "type": STT_PARTIAL,
        "session_id": session_id,
        "stream_id": stream_id,
        "utterance_id": utterance_id,
        "sent_at": sent_at_utc(),
        "partial_transcript": result.get("partial_transcript", result.get("text", "")),
        "confidence": float(result.get("confidence", 0.0)),
    }
    validate_event(event, STT_PARTIAL, allow_server_events=True)
    return event


def final_event(
    session_id: str,
    stream_id: str,
    utterance_id: str,
    result: dict[str, Any],
) -> dict[str, Any]:
    """Build a translation.final event that carries final STT plus MT output."""

    event = {
        "protocol_version": PROTOCOL_VERSION,
        "type": TRANSLATION_FINAL,
        "session_id": session_id,
        "stream_id": stream_id,
        "utterance_id": utterance_id,
        "sent_at": sent_at_utc(),
        "final_transcript": result.get("final_transcript", result.get("text", "")),
        "translation": result.get("translation", ""),
        "confidence": float(result.get("confidence", 0.0)),
        "low_confidence": bool(result.get("low_confidence", False)),
        "latency_ms": dict(result.get("latency_ms", {})),
    }
    validate_event(event, TRANSLATION_FINAL, allow_server_events=True)
    return event


def serialize_event(event: dict[str, Any]) -> str:
    """Serialize an output/control event as compact UTF-8 JSON text."""

    validate_event(event, allow_server_events=True)
    return json.dumps(event, ensure_ascii=False, separators=(",", ":"))


# Backward-compatible names used by the first scaffold.
partial = partial_event
final = final_event
