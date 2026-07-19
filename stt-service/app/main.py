import os
import time
import wave
from io import BytesIO
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, UploadFile

from .model import get_model, transcribe_bytes
from .schemas import HealthResponse, TranscriptionResponse
from .websocket import router as websocket_router

load_dotenv()


@asynccontextmanager
async def lifespan(_: FastAPI):
    get_model()
    yield


app = FastAPI(title="STT Service (faster-whisper)", lifespan=lifespan)
app.include_router(websocket_router)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    device = os.getenv("WHISPER_DEVICE", "auto")
    return HealthResponse(
        status="ok",
        model=os.getenv("WHISPER_MODEL", "small"),
        device=device,
    )


@app.post("/transcribe", response_model=TranscriptionResponse)
async def transcribe(
    file: UploadFile = File(...),
    language: str | None = Form(default=None),
) -> TranscriptionResponse:
    suffix = os.path.splitext(file.filename or "audio.wav")[1] or ".wav"
    return transcribe_bytes(await file.read(), suffix=suffix, language=language)


@app.post("/v1/transcribe")
async def transcribe_v1(
    file: UploadFile = File(...),
    utterance_id: str = Form(...),
    language_hint: str = Form(default="vi"),
    is_final: bool = Form(default=True),
) -> dict[str, object]:
    started_at = time.perf_counter()
    raw = await file.read()
    filename = file.filename or "audio.pcm"
    suffix = os.path.splitext(filename)[1].lower()
    audio_bytes = raw

    if suffix in {"", ".pcm", ".raw"}:
        audio_bytes = pcm16_mono_to_wav(raw)
        suffix = ".wav"

    result = transcribe_bytes(
        audio_bytes,
        suffix=suffix or ".wav",
        language=normalize_language(language_hint),
    )
    text = result.text.strip()
    return {
        "utterance_id": utterance_id,
        "type": "final" if is_final else "partial",
        "text": text,
        "language": result.language or normalize_language(language_hint),
        "asr_latency_ms": round((time.perf_counter() - started_at) * 1000),
        "backend": "faster-whisper",
        "low_confidence": False,
        "eou": {
            "is_endpoint": is_final,
            "reason": "client_final" if is_final else "partial",
            "speech_ms": int((result.duration or 0) * 1000),
            "trailing_silence_ms": 0,
            "duration_ms": int((result.duration or 0) * 1000),
        },
    }


def normalize_language(language: str | None) -> str | None:
    if language in {"vi", "en"}:
        return language
    return None


def pcm16_mono_to_wav(raw: bytes, sample_rate: int = 16_000) -> bytes:
    wav_buffer = BytesIO()
    with wave.open(wav_buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(raw)
    return wav_buffer.getvalue()
