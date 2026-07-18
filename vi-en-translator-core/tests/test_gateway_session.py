from __future__ import annotations

from gateway.protocol import HEARTBEAT_PONG, STREAM_ACK
from gateway.session_manager import SessionManager


def test_sequence_is_monotonic_across_stream_not_reset_per_utterance() -> None:
    manager = SessionManager(partial_interval_s=999)
    manager.register_stream("stream-a", session_id="meeting-1", source_id="mic-a")
    manager.start_utterance("stream-a", "utt-1")

    first = manager.handle_audio_chunk("stream-a", "utt-1", 95, b"\x00\x00")
    second = manager.handle_audio_chunk("stream-a", "utt-1", 96, b"\x00\x00")
    data, ack = manager.handle_utterance_end("stream-a", "utt-1")

    manager.start_utterance("stream-a", "utt-2")
    third = manager.handle_audio_chunk("stream-a", "utt-2", 97, b"\x00\x00")

    assert first.accepted
    assert second.accepted
    assert third.accepted
    assert data == b"\x00\x00\x00\x00"
    assert ack == 96


def test_out_of_order_sequence_is_rejected() -> None:
    manager = SessionManager()
    manager.start_utterance("stream-a", "utt-1")

    assert manager.handle_audio_chunk("stream-a", "utt-1", 0, b"\x00\x00").accepted
    rejected = manager.handle_audio_chunk("stream-a", "utt-1", 2, b"\x00\x00")

    assert not rejected.accepted
    assert "expected sequence 1" in (rejected.error or "")


def test_partial_interval_returns_snapshot() -> None:
    manager = SessionManager(partial_interval_s=0)
    manager.start_utterance("stream-a", "utt-1")

    result = manager.handle_audio_chunk("stream-a", "utt-1", 0, b"\x01\x00")

    assert result.accepted
    assert result.should_emit_partial
    assert result.pcm_snapshot == b"\x01\x00"


def test_stream_ack_and_heartbeat_pong_shapes() -> None:
    manager = SessionManager()
    manager.start_utterance("stream-a", "utt-1")
    manager.handle_audio_chunk("stream-a", "utt-1", 3, b"\x00\x00")

    ack = manager.stream_ack("meeting-1", "stream-a")
    pong = manager.heartbeat_pong(
        {"protocol_version": "1.3", "type": "heartbeat.ping", "event_id": "evt-hb", "session_id": "meeting-1", "stream_id": "stream-a"}
    )

    assert ack["type"] == STREAM_ACK
    assert ack["highest_contiguous_sequence"] == 3
    assert ack["missing_sequences"] == []
    assert pong["type"] == HEARTBEAT_PONG
    assert pong["in_reply_to"] == "evt-hb"
