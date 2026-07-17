"""Central config for the STT service.

Switching backend = change BACKEND below (or set env STT_BACKEND). Nothing else
needs to change anywhere in the codebase.
"""

import os
from pathlib import Path


def _load_dotenv() -> None:
    """Load KEY=VALUE lines from the nearest .env (gitignored) into os.environ.
    Walks up from this file so it finds repo-root .env regardless of how deep
    the package lives (stt/stt_service/...). Real env vars win over .env values."""
    for parent in Path(__file__).resolve().parents:
        env_file = parent / ".env"
        if env_file.is_file():
            break
    else:
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv()

# "auto"  -> Dynamic routing: 'vi' -> FPTCloudEngine, 'en'/auto -> GroqEngine (or local fallback)
# "fpt"   -> FPTCloudEngine (FPT Cloud Model-as-a-Service API, VI only)
# "groq"  -> GroqEngine (Groq Cloud API, multi-language)
# "local" -> LocalWhisperEngine (faster-whisper, offline)
BACKEND = os.environ.get("STT_BACKEND", "auto")

# --- FPT Cloud (https://github.com/fpt-corp/ai-marketplace) ---
# Endpoint is OpenAI-compatible: POST {base_url}/v1/audio/transcriptions
# NOTE: FPT has fine-tuned this model for VI only — EN audio gets phonetically
# transcribed to Vietnamese regardless of the 'language' parameter (verified 2026-07-17).
FPT_BASE_URL = os.environ.get("FPT_BASE_URL", "https://mkp-api.fptcloud.com")
FPT_MODEL = "FPT.AI-whisper-large-v3-turbo"
FPT_API_KEY_ENV = "FPT_API_KEY"  # key is ONLY ever read from this env var

# --- Groq Cloud (https://console.groq.com) ---
# Hosts the ORIGINAL openai/whisper-large-v3-turbo (open-source, 50+ languages).
# Free tier: 20 RPM, 2000 RPD, 7200 audio-seconds/hour. No credit card needed.
# Interface is 100% OpenAI-compatible (same endpoint, same multipart form).
# verbose_json IS supported → language detection + segment confidence available.
GROQ_BASE_URL = os.environ.get("GROQ_BASE_URL", "https://api.groq.com/openai")
GROQ_MODEL = "whisper-large-v3-turbo"
GROQ_API_KEY_ENV = "GROQ_API_KEY"  # key is ONLY ever read from this env var

# --- Local faster-whisper stub ---
LOCAL_MODEL_SIZE = "small"      # tiny/base/small/medium/large-v3
LOCAL_DEVICE = "auto"
LOCAL_COMPUTE_TYPE = "int8"

# --- Audio ---
SAMPLE_RATE = 16000

# --- Timeouts (seconds), per contract with the team ---
TIMEOUT_PARTIAL_S = 5.0
TIMEOUT_FINAL_S = 10.0

# --- Silence / hallucination guard ---
# Audio below BOTH thresholds is treated as silence: return empty text,
# never hit the API (whisper hallucinates on silence).
SILENCE_RMS = 1e-3    # ~ -60 dBFS
SILENCE_PEAK = 5e-3

# --- Language handling ---
# language_hint is a prior; a detected language different from the hint wins
# only when the backend reports detection confidence >= this value.
LANG_OVERRIDE_CONFIDENCE = 0.80

# --- Confidence flagging ---
LOW_CONF_AVG_LOGPROB = -1.0   # mean segment avg_logprob below this => low_confidence
LOW_CONF_NO_SPEECH = 0.6      # no_speech_prob above this => low_confidence

# --- Server Gateway (P4 -> STT) ---
STT_HOST = os.environ.get("STT_HOST", "0.0.0.0")
STT_PORT = int(os.environ.get("STT_PORT", "8001"))
