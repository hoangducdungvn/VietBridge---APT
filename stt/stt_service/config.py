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
# Previously used Groq, but Groq is throwing 403 blocks on VN IPs.
# Now using FPT's hosted original whisper model (FPT_FINAL_MODEL) for final decodes.
CODE_SWITCH_FINAL_GROQ = False

# --- FPT Cloud (https://github.com/fpt-corp/ai-marketplace) ---
# Endpoint is OpenAI-compatible: POST {base_url}/v1/audio/transcriptions
# NOTE: FPT has fine-tuned this model for VI only — EN audio gets phonetically
# transcribed to Vietnamese regardless of the 'language' parameter.
FPT_BASE_URL = os.environ.get("FPT_BASE_URL", "https://mkp-api.fptcloud.com")
FPT_MODEL = "FPT.AI-whisper-large-v3-turbo" # Super fast, VI only (for partial)
FPT_FINAL_MODEL = "whisper-large-v3-turbo"  # Original base model, code-switching (for final)
FPT_API_KEY_ENV = "FPT_API_KEY"  # key is ONLY ever read from this env var

# --- Groq Cloud (https://console.groq.com) ---
# Hosts the ORIGINAL openai/whisper-large-v3-turbo (open-source, 50+ languages).
# Interface is 100% OpenAI-compatible (same endpoint, same multipart form).
GROQ_BASE_URL = os.environ.get("GROQ_BASE_URL", "https://api.groq.com/openai")
GROQ_MODEL = "whisper-large-v3-turbo"
GROQ_API_KEY_ENV = "GROQ_API_KEY"



# --- Audio ---
SAMPLE_RATE = 16000

# --- Timeouts (seconds), per contract with the team ---
TIMEOUT_PARTIAL_S = 5.0
TIMEOUT_FINAL_S = 10.0

# Limit concurrent upstream transcription calls. FPT intermittently returns
# HTTP 500 when partial/final requests overlap heavily, so final requests are
# queued with priority and production defaults to one upstream call at a time.
STT_MAX_CONCURRENT_REQUESTS = max(
    1, int(os.environ.get("STT_MAX_CONCURRENT_REQUESTS", "1"))
)

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
NORMALIZE_MAX_GAIN = 20.0       # ~26 dB cap: never boost a near-dead mic's
                                # noise floor into a screech (x100 gain)

# High-pass filter: remove DC bias and low-frequency rumble (HVAC, fans) < cutoff.
# First-order IIR at 80 Hz adds ~0.5 ms CPU per 10s utterance — negligible.
HIGHPASS_CUTOFF_HZ = 80.0

# --- End Of Utterance detection (server-side advisory fallback) ---
# The primary EOU signal is still produced by voice/ client VAD. These settings
# let STT responses expose an extra `eou` metadata block for callers that want a
# backend-side safety signal while keeping the old transcribe contract intact.
EOU_ENABLED = os.environ.get("STT_EOU_ENABLED", "true").strip().lower() not in ("0", "false", "no", "off")
EOU_FRAME_MS = int(os.environ.get("STT_EOU_FRAME_MS", "20"))
EOU_END_SILENCE_MS = int(os.environ.get("STT_EOU_END_SILENCE_MS", "1500"))
EOU_MIN_SPEECH_MS = int(os.environ.get("STT_EOU_MIN_SPEECH_MS", "160"))
EOU_MAX_UTTERANCE_MS = int(os.environ.get("STT_EOU_MAX_UTTERANCE_MS", "25000"))
EOU_SPEECH_RMS = float(os.environ.get("STT_EOU_SPEECH_RMS", str(SILENCE_RMS)))
EOU_SPEECH_PEAK = float(os.environ.get("STT_EOU_SPEECH_PEAK", str(SILENCE_PEAK)))

# --- Server Gateway (P4 -> STT) ---
STT_HOST = os.environ.get("STT_HOST", "0.0.0.0")
# Hosted platforms commonly inject PORT and require that exact value. Local/LAN
# deployments fall back to the STT-specific setting.
STT_PORT = int(os.environ.get("PORT") or os.environ.get("STT_PORT", "8001"))
