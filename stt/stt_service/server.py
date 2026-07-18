"""STT Service Gateway (HTTP REST & WebSocket entry points for P4 Ingestion Gateway).

Implements the contract specified in docs/audio-streaming-contract.md (§20.3):
  transcribe(utterance_id, audio, language_hint, is_final, continuation_id)
Where P4 calls periodically (~1s) with is_final=False (partial) and once when
utterance ends with is_final=True (final).

Run server:
    python -m stt_service.server
    # or
    uvicorn stt_service.server:app --host 0.0.0.0 --port 8001
"""

import base64
import io
import json
import logging
import struct
import wave
from typing import Optional

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from stt_service import config, service

logger = logging.getLogger("stt_service.server")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

app = FastAPI(
    title="VietBridge STT Service Gateway",
    description="Real-time multi-engine STT processing for VietBridge P4 Ingestion Gateway",
    version="1.3.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _bytes_to_float32_audio(raw: bytes) -> np.ndarray:
    """Convert raw WAV or PCM_S16LE 16kHz mono bytes to float32 array in [-1, 1]."""
    if not raw:
        return np.zeros(0, dtype=np.float32)
    # Check for RIFF/WAVE header
    if len(raw) >= 44 and raw[:4] == b"RIFF" and raw[8:12] == b"WAVE":
        try:
            with wave.open(io.BytesIO(raw), "rb") as wf:
                pcm = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16)
                return pcm.astype(np.float32) / 32768.0
        except Exception as e:
            logger.warning("Failed to parse WAV header, falling back to raw PCM: %s", e)
    # Assume raw 16-bit little endian PCM
    pcm = np.frombuffer(raw, dtype=np.int16)
    return pcm.astype(np.float32) / 32768.0


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "backend": config.BACKEND,
        "engines_initialized": list(service._engines.keys()),
        "sample_rate_hz": config.SAMPLE_RATE,
    }


@app.post("/v1/transcribe")
@app.post("/transcribe")
async def transcribe_http(
    file: UploadFile = File(...),
    utterance_id: str = Form(...),
    language_hint: str = Form("vi"),
    is_final: bool = Form(True),
    continuation_id: Optional[str] = Form(None),
):
    """HTTP endpoint for P4 Ingestion Gateway `transcribe()` calls.

    service.transcribe() is synchronous (requests + numpy) — it MUST run in the
    threadpool. Calling it inline here froze the event loop for 1–3s per request,
    serializing concurrent speakers and starving /health and the WS endpoint.
    """
    try:
        raw_bytes = await file.read()
        audio = _bytes_to_float32_audio(raw_bytes)
        result = await run_in_threadpool(
            service.transcribe,
            utterance_id=utterance_id,
            audio=audio,
            language_hint=language_hint,
            is_final=is_final,
            continuation_id=continuation_id,
        )
        return result
    except Exception as e:
        logger.exception("HTTP transcribe failed for utt=%s", utterance_id)
        raise HTTPException(status_code=500, detail=str(e))


@app.websocket("/v1/ws/transcribe")
@app.websocket("/ws/transcribe")
async def transcribe_ws(websocket: WebSocket):
    """WebSocket endpoint for high-throughput / low-latency P4 streaming connections.

    Supports two wire formats:
    1. Binary frame mirroring contract §6.2:
       [uint32_be metadata_length][JSON metadata][raw PCM_S16LE payload]
       JSON metadata schema: {"utterance_id": "utt-1", "language_hint": "en", "is_final": false, "continuation_id": null}
    2. Text frame (JSON):
       {"utterance_id": "utt-1", "language_hint": "en", "is_final": false, "continuation_id": null, "audio_b64": "..."}
    """
    await websocket.accept()
    logger.info("P4 Gateway connected via WebSocket: %s", websocket.client)
    try:
        while True:
            message = await websocket.receive()
            if "bytes" in message and message["bytes"]:
                data = message["bytes"]
                if len(data) < 4:
                    await websocket.send_json({"error": "Binary frame too short (< 4 bytes)"})
                    continue
                meta_len = struct.unpack(">I", data[:4])[0]
                if len(data) < 4 + meta_len:
                    await websocket.send_json({"error": "Binary frame shorter than metadata_length"})
                    continue
                try:
                    meta_json = data[4 : 4 + meta_len].decode("utf-8")
                    meta = json.loads(meta_json)
                except Exception as e:
                    await websocket.send_json({"error": f"Invalid JSON metadata in binary frame: {e}"})
                    continue
                pcm_bytes = data[4 + meta_len :]
                audio = _bytes_to_float32_audio(pcm_bytes)
                utt_id = meta.get("utterance_id", "unknown_utt")
                hint = meta.get("language_hint", "vi")
                is_final = bool(meta.get("is_final", True))
                cont_id = meta.get("continuation_id")

                res = await run_in_threadpool(service.transcribe, utt_id, audio, hint, is_final, cont_id)
                await websocket.send_json(res)

            elif "text" in message and message["text"]:
                try:
                    meta = json.loads(message["text"])
                except Exception as e:
                    await websocket.send_json({"error": f"Invalid JSON text frame: {e}"})
                    continue
                utt_id = meta.get("utterance_id", "unknown_utt")
                hint = meta.get("language_hint", "vi")
                is_final = bool(meta.get("is_final", True))
                cont_id = meta.get("continuation_id")
                audio_b64 = meta.get("audio_b64", "")
                if audio_b64:
                    audio = _bytes_to_float32_audio(base64.b64decode(audio_b64))
                else:
                    audio = np.zeros(0, dtype=np.float32)

                res = await run_in_threadpool(service.transcribe, utt_id, audio, hint, is_final, cont_id)
                await websocket.send_json(res)

    except WebSocketDisconnect:
        logger.info("P4 Gateway WebSocket disconnected: %s", websocket.client)
    except Exception as e:
        logger.exception("Error in WS session with P4 Gateway: %s", e)
        try:
            await websocket.close()
        except Exception:
            pass


def main():
    import uvicorn
    logger.info("Starting STT Service Gateway on http://%s:%d", config.STT_HOST, config.STT_PORT)
    uvicorn.run("stt_service.server:app", host=config.STT_HOST, port=config.STT_PORT, reload=False)


if __name__ == "__main__":
    main()
