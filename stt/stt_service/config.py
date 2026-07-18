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

# "auto"  -> Dynamic routing: 'vi' -> FPTCloudEngine, 'en'/auto -> GroqEngine
# "fpt"   -> FPTCloudEngine (FPT Cloud Model-as-a-Service API, VI only)
# "groq"  -> GroqEngine (Groq Cloud API, multi-language)
BACKEND = os.environ.get("STT_BACKEND", "auto")

# Code-switching support (VI + EN mixed speech):
# When True and BACKEND="auto", final decodes for language_hint="vi" are routed
# to Groq instead of FPT.  Groq uses the original Whisper (50+ languages) and
# handles EN words embedded in Vietnamese speech correctly.
# Partials still go to FPT for speed (live preview quality is acceptable).
# Set to False to force FPT for all VI decodes (pure-VI scenarios only).
CODE_SWITCH_FINAL_GROQ = os.environ.get("CODE_SWITCH_FINAL_GROQ", "true").lower() != "false"

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


# --- Audio ---
SAMPLE_RATE = 16000

# --- Timeouts (seconds), per contract with the team ---
TIMEOUT_PARTIAL_S = 5.0
TIMEOUT_FINAL_S = 10.0

# --- Partial decode sliding window ---
# On partial calls, only the last PARTIAL_WINDOW_S seconds of accumulated audio
# are sent to the API.  Keeps partial latency O(1) regardless of utterance length.
# Rule of thumb: ≥ 2× the partial interval (CHUNK_S in mock_gateway = 2s).
PARTIAL_WINDOW_S = 6.0           # seconds of context sent per partial
PARTIAL_WINDOW_SAMPLES = int(PARTIAL_WINDOW_S * SAMPLE_RATE)   # 96 000 samples

# --- Silence / hallucination guard ---
# Audio below BOTH thresholds is treated as silence: return empty text,
# never hit the API (whisper hallucinates on silence).
SILENCE_RMS = 5e-3    # ~ -46 dBFS (raised from 1e-3: safe after peak normalization)
SILENCE_PEAK = 1.5e-2  # ~ -36 dBFS

# --- Language handling ---
# language_hint is a prior; a detected language different from the hint wins
# only when the backend reports detection confidence >= this value.
LANG_OVERRIDE_CONFIDENCE = 0.80

# --- Confidence flagging ---
LOW_CONF_AVG_LOGPROB = -1.0   # mean segment avg_logprob below this => low_confidence
LOW_CONF_NO_SPEECH = 0.6      # no_speech_prob above this => low_confidence

# --- Hallucination suppression ---
# no_speech_prob threshold for post-decode hallucination guard.
# Whisper sometimes emits ghost phrases even when its own no_speech_prob is very high.
# Groq's verbose_json exposes this — FPT does not.
HALLUCINATION_NO_SPEECH_THRESHOLD = 0.50

# --- Audio preprocessing (applied before sending to ASR API) ---
# Peak normalization: scale audio to a target peak level so that Whisper always
# receives an optimal input level regardless of mic gain or speaker distance.
# Applied only when current peak is in the 'too quiet' range (< NORMALIZE_MIN_PEAK).
NORMALIZE_AUDIO = True
NORMALIZE_TARGET = 0.707        # -3 dBFS  (headroom before sending to API)
NORMALIZE_MIN_PEAK = 0.50       # only normalize if peak < this (quiet audio)

# High-pass filter: remove DC bias and low-frequency rumble (HVAC, fans) < cutoff.
# First-order IIR at 80 Hz adds ~0.5 ms CPU per 10s utterance — negligible.
HIGHPASS_CUTOFF_HZ = 80.0

# --- Server Gateway (P4 -> STT) ---
STT_HOST = os.environ.get("STT_HOST", "0.0.0.0")
STT_PORT = int(os.environ.get("STT_PORT", "8001"))
