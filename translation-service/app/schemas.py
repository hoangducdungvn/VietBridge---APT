from typing import Literal

from pydantic import BaseModel, Field


class ContextTurnSchema(BaseModel):
    sourceLanguage: Literal["vi", "en"]
    sourceText: str
    translatedText: str


class TranslateRequest(BaseModel):
    sourceText: str = Field(..., description="The source text to translate")
    sourceLanguage: Literal["vi", "en"]
    targetLanguage: Literal["vi", "en"]
    context: list[ContextTurnSchema] = []
    glossary: dict[str, str] = {}


class TranslateResponse(BaseModel):
    translatedText: str
    providerLatencyMs: int
