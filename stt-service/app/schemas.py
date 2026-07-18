from pydantic import BaseModel, Field


class TranscriptionSegment(BaseModel):
    start: float
    end: float
    text: str


class TranscriptionResponse(BaseModel):
    text: str
    language: str | None = None
    language_probability: float | None = None
    duration: float | None = None
    segments: list[TranscriptionSegment] = Field(default_factory=list)


class HealthResponse(BaseModel):
    status: str
    model: str
    device: str

