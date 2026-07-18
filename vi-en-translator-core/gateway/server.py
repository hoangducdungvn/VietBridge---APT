"""Real WebSocket ingestion gateway for audio-streaming-contract.md v1.3."""

from __future__ import annotations

import asyncio
import inspect
import json
import logging
import os
from pathlib import Path
from typing import Any, Awaitable, Callable

from websockets.exceptions import ConnectionClosed

from .output_events import final_event, partial_event, serialize_event
from .protocol import (
    AUDIO_CHUNK,
    ERROR,
    HEARTBEAT_PING,
    PROTOCOL_VERSION,
    ProtocolError,
    SESSION_ACCEPTED,
    SESSION_START,
    SOURCE_ACCEPTED,
    SOURCE_REGISTER,
    STREAM_RESUME,
    UTTERANCE_END,
    UTTERANCE_START,
    decode_binary_audio_frame,
    parse_control_json,
)
from .session_manager import SessionManager

LOGGER = logging.getLogger(__name__)
ROOT_DIR = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT_DIR / "config" / "config.yaml"


async def maybe_await(value: Any) -> Any:
    if inspect.isawaitable(value):
        return await value
    return value


async def run_engine_call(callback: Callable[[], Any]) -> Any:
    """Run possibly CPU-bound engine work without blocking the WebSocket loop."""

    result = await asyncio.to_thread(callback)
    return await maybe_await(result)


def load_config(path: str | Path | None = None) -> dict[str, Any]:
    """Load config.yaml if PyYAML is available; otherwise use safe defaults."""

    config_path = Path(path or CONFIG_PATH)
    defaults = {
        "gateway": {"host": "0.0.0.0", "port": 8765},
        "asr": {"partial_interval_ms": 1000},
        "vad": {"server_side_revalidation": False},
    }
    if not config_path.exists():
        return defaults
    try:
        import yaml
    except ImportError:
        LOGGER.warning("PyYAML is not installed; using gateway defaults")
        return defaults
    loaded = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    for section, values in defaults.items():
        loaded.setdefault(section, values)
        if isinstance(loaded[section], dict):
            for key, value in values.items():
                loaded[section].setdefault(key, value)
    return loaded


def create_engine_from_config(config: dict[str, Any]) -> Any | None:
    """Create the heavy ASR/MT engine only when explicitly enabled."""

    if os.getenv("GATEWAY_FAKE_ENGINE", "").lower() in {"1", "true", "yes"}:
        class FakeEngine:
            def __init__(self) -> None:
                self.audio: dict[str, bytearray] = {}

            def on_session_start(self, session_id: str, source_id: str, **metadata: Any) -> None:
                return None

            def on_source_register(self, source_id: str, speaker_id: str | None, language_hint: str, **metadata: Any) -> None:
                return None

            def on_utterance_start(self, utterance_id: str, source_id: str, start_time_ms: int = 0, **metadata: Any) -> None:
                self.audio[utterance_id] = bytearray()

            def on_audio_chunk(self, utterance_id: str, pcm_bytes: bytes, sequence: int) -> None:
                self.audio.setdefault(utterance_id, bytearray()).extend(pcm_bytes)

            def transcribe_partial(self, utterance_id: str) -> dict[str, Any]:
                seconds = len(self.audio.get(utterance_id, b"")) / 32000.0
                return {"partial_transcript": f"demo audio {seconds:.1f}s", "confidence": 0.5}

            def transcribe_final(self, utterance_id: str) -> dict[str, Any]:
                seconds = len(self.audio.pop(utterance_id, b"")) / 32000.0
                return {
                    "final_transcript": f"demo audio {seconds:.1f}s",
                    "translation": f"[demo translation] {seconds:.1f}s audio received",
                    "confidence": 0.5,
                    "low_confidence": True,
                    "latency_ms": {"asr_final": 0.0, "mt": 0.0, "total_since_utterance_end": 0.0},
                }

        return FakeEngine()

    if os.getenv("GATEWAY_ENABLE_ASR_ONLY", "").lower() in {"1", "true", "yes"}:
        from src.asr import LazyWhisperASR, WhisperASR
        from src.engine import TranslationEngine
        from src.mt import TransformersTranslator
        from src.terminology import TerminologyManager

        class NoOpTranslator:
            def translate(
                self,
                text: str,
                source_language: str,
                target_language: str,
                forced_terms: list[str] | None = None,
            ) -> str:
                return ""

        model_cfg = config.get("models", {})
        asr_cfg = config.get("asr", {})
        asr_model = os.getenv("ASR_MODEL") or model_cfg.get("asr_path") or "tiny"
        local_files_only = os.getenv("ASR_LOCAL_FILES_ONLY", "1").lower() not in {"0", "false", "no"}
        enable_mt = os.getenv("GATEWAY_ENABLE_MT", "").lower() in {"1", "true", "yes"}
        mt_local_files_only = os.getenv("MT_LOCAL_FILES_ONLY", "1").lower() not in {"0", "false", "no"}
        mt_preload = os.getenv("MT_PRELOAD", "").lower() in {"1", "true", "yes"}
        preload = os.getenv("ASR_PRELOAD", "").lower() in {"1", "true", "yes"}
        partial_beam_size = int(os.getenv("ASR_PARTIAL_BEAM_SIZE", str(asr_cfg.get("partial_beam_size", 1))))
        final_beam_size = int(os.getenv("ASR_FINAL_BEAM_SIZE", str(asr_cfg.get("final_beam_size", 5))))
        LOGGER.info(
            "%s real ASR model %s (local_files_only=%s, partial_beam=%s, final_beam=%s)",
            "Preloading" if preload else "Will lazy-load",
            asr_model,
            local_files_only,
            partial_beam_size,
            final_beam_size,
        )
        glossary_path = ROOT_DIR / "data" / "glossary_vi_en.csv"
        asr = (
            WhisperASR(asr_model, local_files_only=local_files_only)
            if preload
            else LazyWhisperASR(
                asr_model,
                local_files_only=local_files_only,
                partial_beam_size=partial_beam_size,
                final_beam_size=final_beam_size,
            )
        )
        if preload:
            asr.partial_beam_size = partial_beam_size
            asr.final_beam_size = final_beam_size
        mt = TransformersTranslator(local_files_only=mt_local_files_only) if enable_mt else NoOpTranslator()
        if enable_mt and mt_preload:
            LOGGER.info("Preloading local MT model vi->en (local_files_only=%s)", mt_local_files_only)
            mt._load("vi", "en")
        return TranslationEngine(
            asr=asr,
            mt=mt,
            terminology=TerminologyManager(glossary_path),
            vad_revalidation=bool(config.get("vad", {}).get("server_side_revalidation", False)),
        )

    if os.getenv("GATEWAY_ENABLE_MODELS", "").lower() not in {"1", "true", "yes"}:
        return None

    model_cfg = config.get("models", {})
    asr_path = model_cfg.get("asr_path")
    mt_path = model_cfg.get("mt_path")
    tokenizer_path = model_cfg.get("tokenizer_path")
    if not asr_path or not mt_path:
        LOGGER.warning("GATEWAY_ENABLE_MODELS is set, but model paths are missing in config")
        return None

    from src.asr import WhisperASR
    from src.engine import TranslationEngine
    from src.mt import NLLBTranslator
    from src.terminology import TerminologyManager

    glossary_path = ROOT_DIR / "data" / "glossary_vi_en.csv"
    return TranslationEngine(
        asr=WhisperASR(asr_path),
        mt=NLLBTranslator(mt_path, tokenizer_path),
        terminology=TerminologyManager(glossary_path),
        vad_revalidation=bool(config.get("vad", {}).get("server_side_revalidation", False)),
    )


class GatewayConnection:
    """Own per-WebSocket state and bridge protocol events into TranslationEngine."""

    def __init__(self, websocket: Any, *, engine: Any | None, config: dict[str, Any]) -> None:
        partial_interval_s = float(config.get("asr", {}).get("partial_interval_ms", 1000)) / 1000.0
        self.websocket = websocket
        self.engine = engine
        self.manager = SessionManager(partial_interval_s=partial_interval_s)
        self.session_id: str | None = None
        self.stream_id: str | None = None
        self.source_id: str | None = None
        self.background_tasks: set[asyncio.Task[None]] = set()
        self.partial_inflight: set[str] = set()

    async def send_event(self, event: dict[str, Any]) -> None:
        await self.websocket.send(serialize_event(event))

    async def send_error(self, exc: Exception, code: str = "INTERNAL_ERROR") -> None:
        if isinstance(exc, ProtocolError):
            code = exc.code
        try:
            await self.send_event(
                {
                    "protocol_version": PROTOCOL_VERSION,
                    "type": ERROR,
                    "session_id": self.session_id,
                    "stream_id": self.stream_id,
                    "code": code,
                    "message": str(exc),
                    "recoverable": code not in {"PROTOCOL_VERSION_UNSUPPORTED", "UNSUPPORTED_AUDIO_FORMAT"},
                }
            )
        except ConnectionClosed:
            LOGGER.info("Could not send error because WebSocket is already closed: %s", exc)

    def create_background_task(self, coroutine: Awaitable[None]) -> None:
        task = asyncio.create_task(coroutine)
        self.background_tasks.add(task)
        task.add_done_callback(self.background_tasks.discard)

    async def close(self) -> None:
        if not self.background_tasks:
            return
        for task in list(self.background_tasks):
            task.cancel()
        await asyncio.gather(*self.background_tasks, return_exceptions=True)

    async def emit_partial(self, session_id: str, stream_id: str, utterance_id: str) -> None:
        try:
            partial_result = await run_engine_call(lambda: self.engine.transcribe_partial(utterance_id))
            await self.send_event(partial_event(session_id, stream_id, utterance_id, partial_result))
        except ConnectionClosed:
            LOGGER.info("WebSocket closed before stt.partial could be sent")
        except Exception as exc:
            LOGGER.exception("Partial transcription failed")
            await self.send_error(exc)
        finally:
            self.partial_inflight.discard(utterance_id)

    async def emit_final(self, session_id: str, stream_id: str, utterance_id: str) -> None:
        try:
            final_result = await run_engine_call(lambda: self.engine.transcribe_final(utterance_id))
            await self.send_event(final_event(session_id, stream_id, utterance_id, final_result))
        except ConnectionClosed:
            LOGGER.info("WebSocket closed before translation.final could be sent")
        except Exception as exc:
            LOGGER.exception("Final transcription/translation failed")
            await self.send_error(exc)

    async def handle_binary(self, raw: bytes) -> None:
        metadata, pcm = decode_binary_audio_frame(raw)
        stream_id = metadata["stream_id"]
        utterance_id = metadata["utterance_id"]
        sequence = int(metadata["sequence"])
        self.session_id = metadata.get("session_id", self.session_id)
        self.stream_id = stream_id
        self.source_id = metadata.get("source_id", self.source_id)

        result = self.manager.handle_audio_chunk(stream_id, utterance_id, sequence, pcm)
        if not result.accepted:
            raise ProtocolError(result.error or "Invalid sequence or utterance", "SEQUENCE_ERROR")

        if self.engine is not None:
            await maybe_await(self.engine.on_audio_chunk(utterance_id, pcm, sequence))
            if result.should_emit_partial and utterance_id not in self.partial_inflight:
                self.partial_inflight.add(utterance_id)
                self.create_background_task(self.emit_partial(self.session_id or "", stream_id, utterance_id))

    async def handle_text(self, raw: str) -> None:
        event = parse_control_json(raw)
        event_type = event["type"]
        self.session_id = event.get("session_id", self.session_id)
        self.stream_id = event.get("stream_id", self.stream_id)
        self.source_id = event.get("source_id", self.source_id)

        if event_type == SESSION_START:
            await self.on_session_start(event)
        elif event_type == SOURCE_REGISTER:
            await self.on_source_register(event)
        elif event_type == UTTERANCE_START:
            await self.on_utterance_start(event)
        elif event_type == UTTERANCE_END:
            await self.on_utterance_end(event)
        elif event_type == HEARTBEAT_PING:
            await self.send_event(self.manager.heartbeat_pong(event))
        elif event_type == STREAM_RESUME:
            await self.on_stream_resume(event)
        else:
            raise ProtocolError(f"Unsupported control event: {event_type}", "UNSUPPORTED_EVENT_TYPE")

    async def on_session_start(self, event: dict[str, Any]) -> None:
        stream_id = event["stream_id"]
        source_id = event.get("source_id")
        self.manager.register_stream(stream_id, session_id=event["session_id"], source_id=source_id)
        if self.engine is not None:
            metadata = {key: value for key, value in event.items() if key not in {"session_id", "source_id"}}
            await maybe_await(self.engine.on_session_start(event["session_id"], source_id or "", **metadata))
        await self.send_event(
            {
                "protocol_version": PROTOCOL_VERSION,
                "type": SESSION_ACCEPTED,
                "session_id": event["session_id"],
                "stream_id": stream_id,
                "source_id": source_id,
            }
        )

    async def on_source_register(self, event: dict[str, Any]) -> None:
        stream_id = event["stream_id"]
        self.manager.register_source(
            stream_id,
            source_id=event["source_id"],
            speaker_id=event.get("speaker_id"),
            participant_id=event.get("participant_id"),
            language_hint=event.get("language_hint", "auto"),
        )
        if self.engine is not None:
            metadata = {
                key: value
                for key, value in event.items()
                if key not in {"source_id", "speaker_id", "language_hint"}
            }
            await maybe_await(
                self.engine.on_source_register(
                    event["source_id"],
                    event.get("speaker_id"),
                    event.get("language_hint", "auto"),
                    **metadata,
                )
            )
        await self.send_event(
            {
                "protocol_version": PROTOCOL_VERSION,
                "type": SOURCE_ACCEPTED,
                "session_id": event["session_id"],
                "stream_id": stream_id,
                "source_id": event["source_id"],
            }
        )

    async def on_utterance_start(self, event: dict[str, Any]) -> None:
        self.manager.start_utterance(
            event["stream_id"],
            event["utterance_id"],
            language_hint=event.get("language_hint"),
        )
        if self.engine is not None:
            metadata = {
                key: value
                for key, value in event.items()
                if key not in {"utterance_id", "source_id", "start_time_ms"}
            }
            await maybe_await(
                self.engine.on_utterance_start(
                    event["utterance_id"],
                    event["source_id"],
                    int(event.get("start_time_ms", 0)),
                    **metadata,
                )
            )

    async def on_utterance_end(self, event: dict[str, Any]) -> None:
        stream_id = event["stream_id"]
        utterance_id = event["utterance_id"]
        self.manager.handle_utterance_end(stream_id, utterance_id)
        await self.send_event(self.manager.stream_ack(event["session_id"], stream_id))
        if self.engine is not None:
            self.create_background_task(self.emit_final(event["session_id"], stream_id, utterance_id))

    async def on_stream_resume(self, event: dict[str, Any]) -> None:
        next_sequence = int(event.get("next_sequence", event.get("last_acknowledged_sequence", -1) + 1))
        self.manager.resume(event["stream_id"], next_sequence)
        await self.send_event(self.manager.stream_ack(event["session_id"], event["stream_id"]))


def create_handler(engine: Any | None = None, config: dict[str, Any] | None = None) -> Callable[[Any], Awaitable[None]]:
    resolved_config = config or load_config()
    resolved_engine = engine if engine is not None else create_engine_from_config(resolved_config)

    async def handler(websocket: Any) -> None:
        connection = GatewayConnection(websocket, engine=resolved_engine, config=resolved_config)
        try:
            async for raw in websocket:
                try:
                    if isinstance(raw, bytes):
                        await connection.handle_binary(raw)
                    else:
                        await connection.handle_text(raw)
                except Exception as exc:  # The gateway must answer errors without killing the socket.
                    LOGGER.exception("Gateway frame handling failed")
                    await connection.send_error(exc)
        finally:
            await connection.close()

    return handler


def optional_float_env(name: str, default: float | None) -> float | None:
    raw = os.getenv(name)
    if raw is None:
        return default
    if raw.lower() in {"", "none", "null", "off", "false", "no"}:
        return None
    return float(raw)


async def main() -> None:
    import websockets

    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
    config = load_config()
    host = os.getenv("GATEWAY_HOST", str(config.get("gateway", {}).get("host", "0.0.0.0")))
    port = int(os.getenv("GATEWAY_PORT", str(config.get("gateway", {}).get("port", 8765))))
    ping_interval = optional_float_env("GATEWAY_PING_INTERVAL", 20.0)
    ping_timeout = optional_float_env("GATEWAY_PING_TIMEOUT", 120.0)
    async with websockets.serve(
        create_handler(config=config),
        host,
        port,
        ping_interval=ping_interval,
        ping_timeout=ping_timeout,
    ):
        LOGGER.info("Gateway listening on ws://%s:%s (protocol %s)", host, port, PROTOCOL_VERSION)
        print(f"Gateway listening on ws://{host}:{port} (protocol {PROTOCOL_VERSION})", flush=True)
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
