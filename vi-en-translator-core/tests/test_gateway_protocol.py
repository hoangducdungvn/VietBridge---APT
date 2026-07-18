from __future__ import annotations

import pytest

from gateway.protocol import (
    AUDIO_CHUNK,
    PROTOCOL_VERSION,
    ProtocolError,
    decode_binary_audio_frame,
    encode_binary_audio_frame,
    parse_control_json,
)


def metadata(sequence: int = 0) -> dict:
    return {
        "protocol_version": PROTOCOL_VERSION,
        "type": AUDIO_CHUNK,
        "session_id": "meeting-001",
        "stream_id": "stream-speaker-a",
        "source_id": "mic-a",
        "utterance_id": "utt-a-0001",
        "sequence": sequence,
        "capture_start_ms": sequence * 40,
        "duration_ms": 40,
        "audio": {"codec": "pcm_s16le", "sample_rate_hz": 16000, "channels": 1},
    }


def test_binary_audio_frame_roundtrip_sets_payload_bytes() -> None:
    payload = b"\x00\x00" * 640
    frame = encode_binary_audio_frame(metadata(95), payload)

    decoded_metadata, decoded_payload = decode_binary_audio_frame(frame)

    assert decoded_payload == payload
    assert decoded_metadata["sequence"] == 95
    assert decoded_metadata["audio"]["payload_bytes"] == len(payload)


def test_binary_audio_frame_rejects_wrong_protocol_version() -> None:
    bad = metadata()
    bad["protocol_version"] = "1.2"

    with pytest.raises(ProtocolError, match="protocol_version"):
        encode_binary_audio_frame(bad, b"\x00\x00")


def test_binary_audio_frame_rejects_unsupported_audio_profile() -> None:
    bad = metadata()
    bad["audio"]["sample_rate_hz"] = 48000

    with pytest.raises(ProtocolError) as excinfo:
        encode_binary_audio_frame(bad, b"\x00\x00")

    assert excinfo.value.code == "UNSUPPORTED_AUDIO_FORMAT"


def test_parse_control_json_validates_event_type() -> None:
    event = parse_control_json('{"protocol_version":"1.3","type":"heartbeat.ping"}')

    assert event["type"] == "heartbeat.ping"


def test_parse_control_json_rejects_unknown_event_type() -> None:
    with pytest.raises(ProtocolError):
        parse_control_json('{"protocol_version":"1.3","type":"unknown.event"}')
