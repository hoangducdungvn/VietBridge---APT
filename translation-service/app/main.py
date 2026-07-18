import logging

from fastapi import FastAPI, HTTPException, status

from app.model import translator
from app.schemas import TranslateRequest, TranslateResponse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("translation-service")

app = FastAPI(title="NLLB-200 Translation Service")


@app.on_event("startup")
def startup_event() -> None:
    logger.info("Starting up translation service and pre-loading NLLB-200 model...")
    try:
        translator.load_model()
        logger.info("Model loaded successfully.")
    except Exception as exc:
        logger.error("Failed to load NLLB-200 model: %s", exc)


@app.post("/translate", response_model=TranslateResponse)
def translate_endpoint(request: TranslateRequest) -> TranslateResponse:
    try:
        translated_text = translator.translate(
            text=request.sourceText,
            source_lang=request.sourceLanguage,
            target_lang=request.targetLanguage,
            context=request.context,
            glossary=request.glossary,
        )
        return TranslateResponse(
            translatedText=translated_text,
            providerLatencyMs=translator.last_latency_ms,
        )
    except ValueError as exc:
        logger.warning("Validation error in translate request: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        logger.error("Translation failed: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred during translation processing.",
        ) from exc


@app.get("/health")
def health_endpoint() -> dict[str, str | bool]:
    return {
        "status": "ok",
        "modelLoaded": translator.loaded,
    }
