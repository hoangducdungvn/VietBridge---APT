"""Team-facing transcribe() contract.

Model: "periodic re-decode + final" — the gateway calls is_final=False roughly
every 1s on the FULL accumulated audio of the utterance (speed-first), then
is_final=True once (accuracy-first). Audio is never stitched across utterances
here; continuation_id is passed through untouched.
"""

from __future__ import annotations

import logging
import time
from typing import Optional

import numpy as np

import os
from stt_service import config
from stt_service.engine import ASREngine, EngineError, create_engine

logger = logging.getLogger("stt_service.service")

_engines: dict[str, ASREngine] = {}


def resolve_backend(language_hint: str) -> str:
    """Resolve which backend engine to use based on language hint and available keys."""
    if config.BACKEND != "auto":
        return config.BACKEND

    hint_clean = (language_hint or "").strip().lower().split("-")[0]
    if hint_clean == "vi":
        if os.environ.get(config.FPT_API_KEY_ENV):
            return "fpt"
        if os.environ.get(config.GROQ_API_KEY_ENV):
            return "groq"
        return "local"

    # For 'en', 'auto', or any other language hint:
    if os.environ.get(config.GROQ_API_KEY_ENV):
        return "groq"
    if os.environ.get(config.FPT_API_KEY_ENV):
        return "fpt"
    return "local"


def get_engine(backend_name: Optional[str] = None) -> ASREngine:
    global _engines
    target = backend_name or resolve_backend("")
    if target not in _engines:
        _engines[target] = create_engine(target)
        logger.info("STT engine initialized: %s (backend=%r)", type(_engines[target]).__name__, target)
    return _engines[target]


def _is_silence(audio: np.ndarray) -> bool:
    if audio.size == 0:
        return True
    rms = float(np.sqrt(np.mean(np.square(audio))))
    peak = float(np.max(np.abs(audio)))
    return rms < config.SILENCE_RMS and peak < config.SILENCE_PEAK


def _resolve_language(hint: str, result) -> str:
    """hint is a prior; the backend's detection wins only at high confidence
    (code-switch case). Backends that don't report confidence can't override."""
    detected = result.language
    if not detected or detected == hint:
        return detected or hint
    prob = result.language_probability
    if prob is not None and prob >= config.LANG_OVERRIDE_CONFIDENCE:
        logger.info("language override: hint=%s detected=%s (p=%.2f)", hint, detected, prob)
        return detected
    return hint


def transcribe(
    utterance_id: str,
    audio: np.ndarray,
    language_hint: str,
    is_final: bool,
    continuation_id: Optional[str] = None,
) -> dict:
    """audio: float32 mono 16 kHz in [-1,1] — the full accumulated utterance.

    Returns {utterance_id, type: "partial"|"final", text, language, backend,
    asr_latency_ms, low_confidence}; plus continuation_id if given, network_ms
    for the API backend, and error {code, message, status} on failure (the
    worker never crashes on API errors).
    """
    t0 = time.perf_counter()
    backend_name = resolve_backend(language_hint)
    out = {
        "utterance_id": utterance_id,
        "type": "final" if is_final else "partial",
        "text": "",
        "language": language_hint,
        "backend": backend_name,
        "asr_latency_ms": 0.0,
        "low_confidence": False,
    }
    if continuation_id is not None:
        out["continuation_id"] = continuation_id

    audio = np.asarray(audio, dtype=np.float32).reshape(-1)

    if _is_silence(audio):
        # Hallucination guard: whisper invents text on silence — skip the API.
        out["asr_latency_ms"] = round((time.perf_counter() - t0) * 1000, 1)
        logger.debug("utt=%s %s: silence, skipped ASR", utterance_id, out["type"])
        return out

    timeout_s = config.TIMEOUT_FINAL_S if is_final else config.TIMEOUT_PARTIAL_S
    try:
        result = get_engine(backend_name).transcribe(
            audio, language_hint=language_hint, fast=not is_final, timeout_s=timeout_s
        )
    except EngineError as e:
        # If in 'auto' mode and primary backend fails, attempt resilient automatic fallback
        if config.BACKEND == "auto":
            fallback_name = None
            if backend_name == "fpt" and e.code in ("http_5xx", "timeout", "network", "http_4xx"):
                fallback_name = "groq" if os.environ.get(config.GROQ_API_KEY_ENV) else "local"
            elif backend_name == "groq" and e.code in ("rate_limit", "http_5xx", "timeout", "network"):
                fallback_name = "fpt" if (language_hint == "vi" and os.environ.get(config.FPT_API_KEY_ENV)) else "local"

            if fallback_name and fallback_name != backend_name:
                logger.warning(
                    "utt=%s %s: primary backend %r failed (%s: %s), falling back to %r",
                    utterance_id, out["type"], backend_name, e.code, e.message[:60], fallback_name,
                )
                backend_name = fallback_name
                out["backend"] = backend_name
                try:
                    result = get_engine(backend_name).transcribe(
                        audio, language_hint=language_hint, fast=not is_final, timeout_s=timeout_s
                    )
                except EngineError as fallback_e:
                    out["asr_latency_ms"] = round((time.perf_counter() - t0) * 1000, 1)
                    out["error"] = fallback_e.to_dict()
                    out["low_confidence"] = True
                    logger.warning(
                        "utt=%s %s [%s]: fallback ASR error %s after %.0fms",
                        utterance_id, out["type"], backend_name, fallback_e.code, out["asr_latency_ms"],
                    )
                    return out
            else:
                out["asr_latency_ms"] = round((time.perf_counter() - t0) * 1000, 1)
                out["error"] = e.to_dict()
                out["low_confidence"] = True
                logger.warning(
                    "utt=%s %s [%s]: ASR error %s after %.0fms",
                    utterance_id, out["type"], backend_name, e.code, out["asr_latency_ms"],
                )
                return out
        else:
            out["asr_latency_ms"] = round((time.perf_counter() - t0) * 1000, 1)
            out["error"] = e.to_dict()
            out["low_confidence"] = True
            logger.warning(
                "utt=%s %s [%s]: ASR error %s after %.0fms",
                utterance_id, out["type"], backend_name, e.code, out["asr_latency_ms"],
            )
            return out

    out["text"] = result.text
    out["language"] = _resolve_language(language_hint, result)
    out["low_confidence"] = bool(
        (result.avg_logprob is not None and result.avg_logprob < config.LOW_CONF_AVG_LOGPROB)
        or (result.no_speech_prob is not None and result.no_speech_prob > config.LOW_CONF_NO_SPEECH)
    )
    out["asr_latency_ms"] = round((time.perf_counter() - t0) * 1000, 1)
    if "network_ms" in result.timings_ms:
        out["network_ms"] = result.timings_ms["network_ms"]

    logger.info(
        "utt=%s %s [%s]: audio=%.1fs latency=%.0fms network=%s lang=%s low_conf=%s",
        utterance_id, out["type"], backend_name, audio.size / config.SAMPLE_RATE,
        out["asr_latency_ms"], out.get("network_ms", "-"),
        out["language"], out["low_confidence"],
    )
    return out
