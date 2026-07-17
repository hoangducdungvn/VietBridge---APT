"""ASR engine abstraction with two swappable backends.

- FPTCloudEngine: FPT Cloud Model-as-a-Service, OpenAI-compatible
  POST /v1/audio/transcriptions (multipart form, Bearer auth).
  Reference: https://github.com/fpt-corp/ai-marketplace
- LocalWhisperEngine: faster-whisper running locally (day-1 stub, interface
  is final but the backend is unpolished/untested).

Engines never see utterance ids or partial/final semantics — they take raw
audio and knobs, and either return an EngineResult or raise EngineError.
The API key is read from the environment only and never logged.
"""

from __future__ import annotations

import io
import logging
import os
import time
import wave
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from stt_service import config

logger = logging.getLogger("stt_service.engine")


class EngineError(Exception):
    """Structured ASR failure. code is one of:
    timeout | rate_limit | http_4xx | http_5xx | network | bad_audio | backend
    """

    def __init__(self, code: str, message: str, status: Optional[int] = None):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.status = status

    def to_dict(self) -> dict:
        return {"code": self.code, "message": self.message, "status": self.status}


@dataclass
class EngineResult:
    text: str
    language: Optional[str] = None              # backend-detected language, if reported
    language_probability: Optional[float] = None
    avg_logprob: Optional[float] = None         # mean over segments, if reported
    no_speech_prob: Optional[float] = None      # max over segments, if reported
    timings_ms: dict = field(default_factory=dict)  # encode_ms / network_ms / total_ms


def float32_to_wav_bytes(audio: np.ndarray, sample_rate: int = config.SAMPLE_RATE) -> bytes:
    """float32 mono [-1,1] -> in-memory 16-bit PCM WAV."""
    pcm = (np.clip(audio, -1.0, 1.0) * 32767.0).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm.tobytes())
    return buf.getvalue()


class ASREngine(ABC):
    @abstractmethod
    def transcribe(
        self,
        audio: np.ndarray,
        language_hint: Optional[str],
        fast: bool,
        timeout_s: float,
    ) -> EngineResult:
        """audio: float32 mono 16 kHz in [-1,1]. fast=True for partial re-decodes
        (favor speed), fast=False for the final decode (favor accuracy)."""


class FPTCloudEngine(ASREngine):
    def __init__(
        self,
        base_url: str = config.FPT_BASE_URL,
        model: str = config.FPT_MODEL,
    ):
        import requests  # local import: keep numpy-only paths importable without it

        api_key = os.environ.get(config.FPT_API_KEY_ENV, "").strip()
        if not api_key:
            raise RuntimeError(
                f"Environment variable {config.FPT_API_KEY_ENV} is not set. "
                "See stt_service/README.md."
            )
        self._url = base_url.rstrip("/") + "/v1/audio/transcriptions"
        self._model = model
        self._session = requests.Session()
        self._session.headers["Authorization"] = f"Bearer {api_key}"
        self._requests = requests
        # Verified 2026-07-17: the FPT endpoint rejects verbose_json (returns
        # 503, not 400), so no segment-level confidence is available from it.
        # Response shape: {"text": ..., "usage": {"input_duration", "output_tokens"}}
        self._response_format = "json"

    def transcribe(self, audio, language_hint, fast, timeout_s) -> EngineResult:
        t0 = time.perf_counter()
        wav_bytes = float32_to_wav_bytes(audio)
        encode_ms = (time.perf_counter() - t0) * 1000

        data = self._post(wav_bytes, language_hint, timeout_s)

        total_ms = (time.perf_counter() - t0) * 1000
        network_ms = total_ms - encode_ms

        segments = data.get("segments") or []
        avg_logprob = None
        no_speech = None
        if segments:
            lps = [s["avg_logprob"] for s in segments if "avg_logprob" in s]
            nss = [s["no_speech_prob"] for s in segments if "no_speech_prob" in s]
            avg_logprob = float(np.mean(lps)) if lps else None
            no_speech = float(max(nss)) if nss else None

        return EngineResult(
            text=(data.get("text") or "").strip(),
            language=data.get("language"),
            language_probability=None,  # API does not report detection confidence
            avg_logprob=avg_logprob,
            no_speech_prob=no_speech,
            timings_ms={
                "encode_ms": round(encode_ms, 1),
                "network_ms": round(network_ms, 1),
                "total_ms": round(total_ms, 1),
            },
        )

    def _post(self, wav_bytes: bytes, language_hint, timeout_s: float) -> dict:
        form = {"model": self._model, "response_format": self._response_format}
        if language_hint:
            form["language"] = language_hint
        files = {"file": ("utterance.wav", wav_bytes, "audio/wav")}
        try:
            resp = self._session.post(
                self._url, data=form, files=files, timeout=timeout_s
            )
        except self._requests.exceptions.Timeout:
            raise EngineError("timeout", f"request exceeded {timeout_s}s")
        except self._requests.exceptions.RequestException as e:
            raise EngineError("network", type(e).__name__)

        if resp.status_code == 200:
            try:
                return resp.json()
            except ValueError:
                raise EngineError("http_5xx", "non-JSON 200 response", 200)

        body = resp.text[:200]  # truncated; never contains our key
        if resp.status_code == 429:
            raise EngineError("rate_limit", body, 429)
        if 400 <= resp.status_code < 500:
            raise EngineError("http_4xx", body, resp.status_code)
        raise EngineError("http_5xx", body, resp.status_code)


class GroqEngine(ASREngine):
    """Groq Cloud API — hosts the original openai/whisper-large-v3-turbo (open-source,
    NOT fine-tuned). Supports 50+ languages with real language detection.

    Free tier limits (as of 2026):
      - 20 requests/minute (RPM)
      - 2,000 requests/day (RPD)
      - 7,200 audio-seconds/hour (~2hrs audio per clock-hour)
    API key: https://console.groq.com/keys  (free, no credit card needed)
    """

    def __init__(
        self,
        base_url: str = config.GROQ_BASE_URL,
        model: str = config.GROQ_MODEL,
    ):
        import requests

        api_key = os.environ.get(config.GROQ_API_KEY_ENV, "").strip()
        if not api_key:
            raise RuntimeError(
                f"Environment variable {config.GROQ_API_KEY_ENV} is not set. "
                "Get a free key at https://console.groq.com/keys"
            )
        self._url = base_url.rstrip("/") + "/v1/audio/transcriptions"
        self._model = model
        self._session = requests.Session()
        self._session.headers["Authorization"] = f"Bearer {api_key}"
        self._requests = requests
        # Groq supports verbose_json → we get language + segment-level confidence
        self._response_format = "verbose_json"

    def transcribe(self, audio, language_hint, fast, timeout_s) -> EngineResult:
        t0 = time.perf_counter()
        wav_bytes = float32_to_wav_bytes(audio)
        encode_ms = (time.perf_counter() - t0) * 1000

        data = self._post(wav_bytes, language_hint, timeout_s)

        total_ms = (time.perf_counter() - t0) * 1000
        network_ms = total_ms - encode_ms

        segments = data.get("segments") or []
        avg_logprob = None
        no_speech = None
        if segments:
            lps = [s["avg_logprob"] for s in segments if "avg_logprob" in s]
            nss = [s["no_speech_prob"] for s in segments if "no_speech_prob" in s]
            avg_logprob = float(np.mean(lps)) if lps else None
            no_speech = float(max(nss)) if nss else None

        detected_lang = data.get("language")  # Groq returns this in verbose_json
        lang_prob = data.get("language_probability")  # may or may not be present

        return EngineResult(
            text=(data.get("text") or "").strip(),
            language=detected_lang,
            language_probability=lang_prob,
            avg_logprob=avg_logprob,
            no_speech_prob=no_speech,
            timings_ms={
                "encode_ms": round(encode_ms, 1),
                "network_ms": round(network_ms, 1),
                "total_ms": round(total_ms, 1),
            },
        )

    def _post(self, wav_bytes: bytes, language_hint, timeout_s: float) -> dict:
        form: dict = {
            "model": self._model,
            "response_format": self._response_format,
        }
        # Only send language hint for final decode (fast=False means final);
        # for auto-detect during partial, omit to let Groq detect freely.
        if language_hint and language_hint != "auto":
            form["language"] = language_hint
        files = {"file": ("utterance.wav", wav_bytes, "audio/wav")}
        try:
            resp = self._session.post(
                self._url, data=form, files=files, timeout=timeout_s
            )
        except self._requests.exceptions.Timeout:
            raise EngineError("timeout", f"request exceeded {timeout_s}s")
        except self._requests.exceptions.RequestException as e:
            raise EngineError("network", type(e).__name__)

        if resp.status_code == 200:
            try:
                return resp.json()
            except ValueError:
                raise EngineError("http_5xx", "non-JSON 200 response", 200)

        body = resp.text[:300]
        if resp.status_code == 429:
            raise EngineError("rate_limit", "Groq free tier limit hit — wait 60s or upgrade", 429)
        if 400 <= resp.status_code < 500:
            raise EngineError("http_4xx", body, resp.status_code)
        raise EngineError("http_5xx", body, resp.status_code)


class LocalWhisperEngine(ASREngine):
    """Day-1 stub for offline demos. Interface is final; quality/latency tuning TBD."""

    def __init__(self, model_size: str = config.LOCAL_MODEL_SIZE):
        try:
            from faster_whisper import WhisperModel
        except ImportError:
            raise RuntimeError(
                "faster-whisper is not installed (pip install faster-whisper) — "
                "required only for BACKEND='local'."
            )
        self._model = WhisperModel(
            model_size, device=config.LOCAL_DEVICE, compute_type=config.LOCAL_COMPUTE_TYPE
        )

    def transcribe(self, audio, language_hint, fast, timeout_s) -> EngineResult:
        t0 = time.perf_counter()
        try:
            segments, info = self._model.transcribe(
                audio,
                language=language_hint if fast else None,  # final: let it auto-detect
                beam_size=1 if fast else 5,
                vad_filter=False,  # gateway already ran VAD
            )
            segs = list(segments)
        except Exception as e:  # CTranslate2 raises plain RuntimeErrors
            raise EngineError("backend", f"faster-whisper: {e}")
        total_ms = (time.perf_counter() - t0) * 1000
        return EngineResult(
            text=" ".join(s.text.strip() for s in segs).strip(),
            language=info.language,
            language_probability=info.language_probability,
            avg_logprob=float(np.mean([s.avg_logprob for s in segs])) if segs else None,
            no_speech_prob=float(max(s.no_speech_prob for s in segs)) if segs else None,
            timings_ms={"total_ms": round(total_ms, 1)},
        )


def create_engine(backend: Optional[str] = None) -> ASREngine:
    backend = backend or config.BACKEND
    if backend == "auto":
        if os.environ.get(config.FPT_API_KEY_ENV):
            backend = "fpt"
        elif os.environ.get(config.GROQ_API_KEY_ENV):
            backend = "groq"
        else:
            backend = "local"
    if backend == "fpt":
        return FPTCloudEngine()
    if backend == "groq":
        return GroqEngine()
    if backend == "local":
        return LocalWhisperEngine()
    raise ValueError(f"Unknown STT backend {backend!r} (expected 'fpt', 'groq', 'local', or 'auto')")
