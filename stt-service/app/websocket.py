import asyncio
import io
import json
import logging
import wave

import numpy as np
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .preprocessing import transcribe as stt_transcribe

logger = logging.getLogger("stt_service.websocket")
router = APIRouter()

def _bytes_to_float32_audio(raw: bytes) -> np.ndarray:
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


@router.websocket("/ws")
async def transcribe_websocket(websocket: WebSocket) -> None:
    await websocket.accept()
    logger.info("WebSocket connected")

    turn_id = None
    language_hint = "vi"
    audio_buffer = bytearray()
    partial_task = None
    turn_active = False

    async def periodic_partial():
        try:
            while turn_active:
                start_tick = asyncio.get_event_loop().time()
                
                if audio_buffer and turn_id:
                    # Snapshot buffer
                    raw_bytes = bytes(audio_buffer)
                    audio = _bytes_to_float32_audio(raw_bytes)
                    if len(audio) > 0:
                        # Run transcription (run_in_executor to not block event loop)
                        try:
                            loop = asyncio.get_running_loop()
                            res = await loop.run_in_executor(
                                None,
                                stt_transcribe,
                                turn_id,
                                audio,
                                language_hint,
                                False,  # is_final = False
                                None    # continuation_id
                            )
                            
                            if res:
                                await websocket.send_json({
                                    "type": "stt.partial",
                                    "turnId": turn_id,
                                    "text": res.get("text", ""),
                                    "language": res.get("language", language_hint),
                                    "backend": res.get("backend", "unknown"),
                                    "asr_latency_ms": res.get("asr_latency_ms", 0)
                                })
                        except Exception as e:
                            logger.error(f"Error in periodic partial: {e}")
                
                # Ensure exactly 1s cadence
                elapsed = asyncio.get_event_loop().time() - start_tick
                sleep_time = max(0.1, 1.0 - elapsed)
                await asyncio.sleep(sleep_time)
        except asyncio.CancelledError:
            pass

    try:
        while True:
            message = await websocket.receive()
            if "text" in message and message["text"]:
                try:
                    data = json.loads(message["text"])
                    msg_type = data.get("type")
                    
                    if msg_type == "start_turn":
                        turn_id = data.get("turnId")
                        language_hint = data.get("language", "vi")
                        audio_buffer.clear()
                        turn_active = True
                        if partial_task:
                            partial_task.cancel()
                        partial_task = asyncio.create_task(periodic_partial())
                        logger.info(f"Started turn {turn_id}")
                        
                    elif msg_type == "finish_turn":
                        turn_active = False
                        if partial_task:
                            partial_task.cancel()
                            
                        # Final transcription
                        raw_bytes = bytes(audio_buffer)
                        audio = _bytes_to_float32_audio(raw_bytes)
                        try:
                            loop = asyncio.get_running_loop()
                            res = await loop.run_in_executor(
                                None,
                                stt_transcribe,
                                turn_id,
                                audio,
                                language_hint,
                                True,  # is_final = True
                                None   # continuation_id
                            )
                            if res:
                                await websocket.send_json({
                                    "type": "stt.final",
                                    "turnId": turn_id,
                                    "text": res.get("text", ""),
                                    "language": res.get("language", language_hint),
                                    "backend": res.get("backend", "unknown"),
                                    "asr_latency_ms": res.get("asr_latency_ms", 0)
                                })
                        except Exception as e:
                            logger.error(f"Error in final transcribe: {e}")
                            await websocket.send_json({"type": "stt.error", "error": str(e)})
                        
                        logger.info(f"Finished turn {turn_id}")
                        
                except Exception as e:
                    logger.error(f"Invalid JSON: {e}")
                    
            elif "bytes" in message and message["bytes"]:
                if turn_active:
                    audio_buffer.extend(message["bytes"])

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
        turn_active = False
        if partial_task:
            partial_task.cancel()
    except Exception as exc:
        logger.error(f"WebSocket error: {exc}")
        await websocket.close(code=1011)
