"""Demo client that mimics voice/ and sends contract v1.3 frames."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
import uuid
import wave
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from gateway.protocol import (  # noqa: E402
    AUDIO_CHUNK,
    HEARTBEAT_PING,
    PROTOCOL_VERSION,
    SESSION_START,
    SOURCE_REGISTER,
    UTTERANCE_END,
    UTTERANCE_START,
    encode_binary_audio_frame,
)


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())


def read_pcm16_wav(path: Path) -> tuple[bytes, int]:
    with wave.open(str(path), "rb") as wav_file:
        if wav_file.getnchannels() != 1 or wav_file.getsampwidth() != 2 or wav_file.getframerate() != 16000:
            raise ValueError("Input WAV must be PCM16 mono 16 kHz")
        return wav_file.readframes(wav_file.getnframes()), wav_file.getframerate()


def control_event(event_type: str, **fields: Any) -> dict[str, Any]:
    return {
        "protocol_version": PROTOCOL_VERSION,
        "type": event_type,
        "event_id": f"evt-{uuid.uuid4()}",
        "sent_at": now_iso(),
        **fields,
    }


async def receive_printer(websocket: Any) -> None:
    async for message in websocket:
        event = json.loads(message)
        event_type = event.get("type")
        if event_type in {"stt.partial", "translation.final"}:
            print(json.dumps(event, ensure_ascii=False, indent=2))
        else:
            print(f"< {event_type}: {json.dumps(event, ensure_ascii=False)}")


async def run(args: argparse.Namespace) -> None:
    import websockets

    pcm, sample_rate = read_pcm16_wav(Path(args.input_file))
    session_id = args.session_id or f"meeting-{uuid.uuid4()}"
    stream_id = args.stream_id or f"stream-{args.source_id}"
    utterance_id = args.utterance_id or f"utt-{uuid.uuid4()}"
    participant_id = args.participant_id or f"participant-{args.source_id}"

    async with websockets.connect(args.url) as websocket:
        printer = asyncio.create_task(receive_printer(websocket))

        await websocket.send(
            json.dumps(
                control_event(
                    SESSION_START,
                    session_id=session_id,
                    stream_id=stream_id,
                    source_id=args.source_id,
                    client={"platform": "python-demo", "app_version": "0.1.0"},
                    audio={"codec": "pcm_s16le", "sample_rate_hz": 16000, "channels": 1, "chunk_duration_ms": args.chunk_ms},
                    capabilities={"vad": True, "resend": True},
                )
            )
        )
        await asyncio.sleep(0.05)
        await websocket.send(
            json.dumps(
                control_event(
                    SOURCE_REGISTER,
                    session_id=session_id,
                    stream_id=stream_id,
                    source_id=args.source_id,
                    participant_id=participant_id,
                    speaker_id=args.speaker_id,
                    speaker_state="assigned",
                    language_hint=args.language_hint,
                )
            )
        )
        await asyncio.sleep(0.05)
        await websocket.send(
            json.dumps(
                control_event(
                    UTTERANCE_START,
                    session_id=session_id,
                    stream_id=stream_id,
                    source_id=args.source_id,
                    utterance_id=utterance_id,
                    participant_id=participant_id,
                    speaker_id=args.speaker_id,
                    speaker_state="assigned",
                    language_hint=args.language_hint,
                    start_time_ms=0,
                    vad={"engine": "demo", "speech_probability": 1.0, "pre_roll_ms": 0},
                )
            )
        )

        bytes_per_chunk = int(sample_rate * args.chunk_ms / 1000) * 2
        for sequence, offset in enumerate(range(0, len(pcm), bytes_per_chunk)):
            chunk = pcm[offset : offset + bytes_per_chunk]
            metadata = {
                "protocol_version": PROTOCOL_VERSION,
                "type": AUDIO_CHUNK,
                "session_id": session_id,
                "stream_id": stream_id,
                "connection_id": "demo-connection",
                "source_id": args.source_id,
                "participant_id": participant_id,
                "speaker_id": args.speaker_id,
                "speaker_state": "assigned",
                "utterance_id": utterance_id,
                "sequence": sequence,
                "utterance_sequence": sequence,
                "capture_start_ms": sequence * args.chunk_ms,
                "duration_ms": args.chunk_ms,
                "audio": {"codec": "pcm_s16le", "sample_rate_hz": 16000, "channels": 1},
            }
            await websocket.send(encode_binary_audio_frame(metadata, chunk))
            if args.realtime:
                await asyncio.sleep(args.chunk_ms / 1000)

        last_sequence = max(0, (len(pcm) + bytes_per_chunk - 1) // bytes_per_chunk - 1)
        await websocket.send(
            json.dumps(
                control_event(
                    UTTERANCE_END,
                    session_id=session_id,
                    stream_id=stream_id,
                    source_id=args.source_id,
                    utterance_id=utterance_id,
                    speaker_id=args.speaker_id,
                    end_time_ms=len(pcm) // 32,
                    last_sequence=last_sequence,
                    reason="vad_silence",
                    trailing_silence_ms=600,
                    audio_duration_ms=len(pcm) // 32,
                )
            )
        )
        await websocket.send(
            json.dumps(
                control_event(
                    HEARTBEAT_PING,
                    session_id=session_id,
                    stream_id=stream_id,
                    source_id=args.source_id,
                )
            )
        )
        await asyncio.sleep(args.wait_seconds)
        printer.cancel()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Send one WAV utterance to the VietBridge gateway.")
    parser.add_argument("--url", default="ws://localhost:8765")
    parser.add_argument("--input-file", required=True, help="PCM16 mono 16 kHz WAV file")
    parser.add_argument("--source-id", default="mic-a")
    parser.add_argument("--speaker-id", default="speaker-a")
    parser.add_argument("--participant-id")
    parser.add_argument("--language-hint", choices=["vi", "en", "auto"], default="vi")
    parser.add_argument("--session-id")
    parser.add_argument("--stream-id")
    parser.add_argument("--utterance-id")
    parser.add_argument("--chunk-ms", type=int, default=40)
    parser.add_argument("--realtime", action="store_true", help="Sleep between chunks to mimic live capture")
    parser.add_argument("--wait-seconds", type=float, default=2.0)
    return parser.parse_args()


if __name__ == "__main__":
    asyncio.run(run(parse_args()))
