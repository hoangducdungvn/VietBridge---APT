import os
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

