"""Team-facing transcribe() contract.

Model: "periodic re-decode + final" — the gateway calls is_final=False roughly
every 1s on the FULL accumulated audio of the utterance (speed-first), then
is_final=True once (accuracy-first). Audio is never stitched across utterances
here; continuation_id is passed through untouched.
"""

from __future__ import annotations

import logging
import time
import re
from typing import Optional

import numpy as np

import os
from stt_service import config
from stt_service.eou import detect_eou
from stt_service.engine import ASREngine, EngineError, create_engine
from stt_service.request_gate import SttRequestGate

logger = logging.getLogger("stt_service.service")

_engines: dict[str, ASREngine] = {}
_request_gate = SttRequestGate(config.STT_MAX_CONCURRENT_REQUESTS)


def normalize_hint(language_hint: str) -> str:
    """Collapse the hint to a concrete 'vi' or 'en' — never 'auto'.

    The 2-mic MVP has static per-source hints, and fpt_final (original whisper)
    silently TRANSLATES instead of transcribing when no concrete language is
    given (verified 2026-07-18: VI audio without language= came back in English).
    Anything that isn't explicitly English is treated as Vietnamese.
    """
    return "en" if (language_hint or "").strip().lower().split("-")[0] == "en" else "vi"


def resolve_backend(language_hint: str, is_final: bool = False) -> str:
    """Resolve which backend engine to use.

    Split strategy for FPT Cloud:
      - VI partial: fpt (FPT.AI-whisper-large-v3-turbo — fast, VI fine-tune)
      - VI final:   fpt_final (original whisper-large-v3-turbo — code-switching)
      - EN (both):  fpt_final — the VI fine-tune outputs Vietnamese phonetic
        garbage for English speech, so EN partials must not use it.
    """
    if config.BACKEND != "auto":
        return config.BACKEND

    # Groq is currently throwing 403 blocks on VN IPs — FPT only.
    if normalize_hint(language_hint) == "en":
        return "fpt_final"
    return "fpt_final" if is_final else "fpt"



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


def _trim_trailing_silence(audio: np.ndarray) -> np.ndarray:
    """Trim trailing silence/noise from the audio array.
    If VAD on the client hangs open (sending 2s speech + 10s silence),
    Whisper will hallucinate on the long silence and overwrite the short speech.
    Trimming ensures Whisper only sees the actual spoken segment.
    """
    chunk_size = int(config.SAMPLE_RATE * 0.1)  # 100ms chunks
    for i in range(len(audio), 0, -chunk_size):
        start = max(0, i - chunk_size)
        chunk = audio[start:i]
        if not _is_silence(chunk):
            # Found speech! Keep up to this point + 400ms padding
            pad = int(config.SAMPLE_RATE * 0.4)
            return audio[:min(len(audio), i + pad)]
    return audio


def _highpass_filter(audio: np.ndarray) -> np.ndarray:
    """High-pass at ~HIGHPASS_CUTOFF_HZ: subtract a moving-average baseline.

    Removes DC offset and low-frequency rumble (HVAC, fans, desk vibrations)
    that pollutes Whisper's spectrogram without carrying speech information.

    A moving-average lowpass has its -3 dB point at ~0.443·fs/win, so
    win = 0.443·fs/cutoff. Computed with one cumsum — true O(N) numpy,
    no Python loop (the previous IIR version looped per sample: ~400k
    iterations for 25s audio, 100ms+ CPU per call).
    """
    win = max(3, int(0.443 * config.SAMPLE_RATE / config.HIGHPASS_CUTOFF_HZ))
    if audio.size <= win:
        return (audio - audio.mean()).astype(np.float32)

    c = np.cumsum(np.concatenate(([0.0], audio.astype(np.float64))))
    ma = (c[win:] - c[:-win]) / win  # length: N - win + 1, centered below

    baseline = np.empty(audio.size, dtype=np.float64)
    half = win // 2
    baseline[half : half + ma.size] = ma
    baseline[:half] = ma[0]
    baseline[half + ma.size :] = ma[-1]
    return (audio - baseline).astype(np.float32)


def _normalize_audio(audio: np.ndarray) -> np.ndarray:
    """Peak-normalize quiet audio to NORMALIZE_TARGET (-3 dBFS).

    Solves the 'speaking from far away / quiet mic' problem: Whisper performs
    best when peak amplitude is near full scale. Only normalizes audio whose
    peak is below NORMALIZE_MIN_PEAK (0.50) to avoid boosting noise floors of
    already-loud audio or introducing inter-channel gain artefacts.
    """
    if not config.NORMALIZE_AUDIO:
        return audio
    peak = float(np.max(np.abs(audio)))
    if peak < 1e-6:          # truly silent — don't amplify to infinity
        return audio
    if peak >= config.NORMALIZE_MIN_PEAK:  # already loud enough
        return audio
    # Gain cap: a near-dead mic (peak ~0.001) would otherwise get x700 gain,
    # boosting its noise floor into a screech. Capped audio stays quiet and is
    # then correctly rejected by the silence gate downstream.
    scale = min(config.NORMALIZE_TARGET / peak, config.NORMALIZE_MAX_GAIN)
    return np.clip(audio * scale, -1.0, 1.0).astype(np.float32)



# Known Whisper hallucination phrases and keywords.
# Whisper hallucinates YouTube/social-media language on silence/noise — infinite variety
# so we use BOTH an exact-phrase list AND a keyword set.
# Source: https://github.com/openai/whisper/discussions/928

# Exact substring patterns (case-insensitive)
_HALLUCINATION_PATTERNS = [
    # Vietnamese closing phrases
    "cảm ơn các bạn đã theo dõi",
    "cảm ơn quý vị đã theo dõi",
    "cảm ơn bạn đã xem",
    "đừng quên đăng ký",
    "đăng ký kênh",
    "hẹn gặp lại",
    "xin chào các bạn",
    "chúc các bạn",
    "không bỏ lỡ",
    "video hấp dẫn",
    "like và subscribe",
    # English closing phrases
    "thank you for watching",
    "thanks for watching",
    "please subscribe",
    "like and subscribe",
    "don't forget to subscribe",
    "see you next time",
    "leave a comment",
    "hit the subscribe",
    "click the bell",
    "subtitles by",
    "transcribed by",
    # Groq-specific hallucinations on silence/noise (observed in production)
    "obrigado",       # Portuguese "thank you" — Groq hallucinates this on VI silence
    "e aí",           # Brazilian Portuguese filler
    "merci",          # French filler
    "gracias",        # Spanish filler
]

# Standalone exact-match phrases (entire text, stripped) — too short to be real speech
# but common Groq hallucinations that don't fit as substrings above.
_HALLUCINATION_EXACT = {
    "thank you.", "thank you",
    "thanks.", "thanks",
    "okay.", "okay",
    "hmm.", "hmm",
    "yes.", "yes",
    "no.",
    # Ellipsis-only output on dead air. EXACT match on purpose — as a substring
    # pattern this used to blank any legit sentence containing "..." mid-text.
    "...", ". . .",
}

# Single keywords that NEVER appear in real conversation but always in Whisper hallucinations.
# Any text containing these standalone tokens is almost certainly hallucinated.
_HALLUCINATION_KEYWORDS = {
    "subscribe",   # "hãy subscribe", "please subscribe", "don't forget to subscribe"
    "kênh",        # "kênh Ghiền Mì Gõ", "đăng ký kênh" — too generic alone, used with others
}

# Keyword PAIRS — flag only when BOTH appear in the same text (reduces false positives)
_HALLUCINATION_KEYWORD_PAIRS = [
    {"subscribe", "kênh"},
    {"subscribe", "video"},
    {"subscribe", "theo dõi"},
    {"kênh", "video"},
    {"kênh", "theo dõi"},
    {"like", "subscribe"},
    {"bell", "subscribe"},
]


def _is_repetitive_hallucination(text: str) -> bool:
    """Suppress repeated filler loops often produced from trailing silence/noise."""
    text_lower = text.lower().strip()
    if not text_lower:
        return False

    tokens = re.findall(r"\w+", text_lower, flags=re.UNICODE)
    if len(tokens) < 8:
        return False

    counts: dict[str, int] = {}
    for token in tokens:
        counts[token] = counts.get(token, 0) + 1
    # 0.25 catches 3-word and 4-word loops (e.g. "to ask him" -> 33%).
    # The >= 8 requirement protects real speech (saying "the" 8 times takes a very long sentence).
    if max(counts.values()) >= 8 and max(counts.values()) / len(tokens) >= 0.25:
        return True

    sentences = [s.strip() for s in re.split(r"[.!?。]+", text_lower) if s.strip()]
    if len(sentences) >= 6:
        sentence_counts: dict[str, int] = {}
        for sentence in sentences:
            sentence_counts[sentence] = sentence_counts.get(sentence, 0) + 1
        if max(sentence_counts.values()) >= 4:
            return True

    return False


def _is_hallucination(text: str, result, speech_ratio: Optional[float] = None) -> bool:
    """Detect Whisper hallucinations using three signals:
    1. Exact-phrase blocklist match (substrings).
    2. Standalone exact-match for very short filler words.
    3. Keyword-pair match — social-media language never appears in real speech.

    NOTE: no_speech_prob is NOT used — Groq always returns 0.00 for this field,
    making it unreliable as a hallucination signal.
    """
    if not text:
        return False

    text_lower = text.lower().strip()
    words = set(text_lower.split())

    # Signal 1: exact phrase match (substring)
    for phrase in _HALLUCINATION_PATTERNS:
        if phrase in text_lower:
            return True

    # Signal 2: standalone short hallucination (exact full-text match)
    if text_lower in _HALLUCINATION_EXACT:
        return True

    # Signal 3: keyword-pair match (both words present anywhere in text)
    for pair in _HALLUCINATION_KEYWORD_PAIRS:
        if pair.issubset(words) or all(kw in text_lower for kw in pair):
            return True

    # Signal 4: repeated filler loop (e.g. "Đấy. Đấy. Đấy..." on silence).
    # Only trusted when the audio was mostly NON-speech: a speaker genuinely
    # repeating a sentence produces the same text pattern as a Whisper loop,
    # but with real speech energy throughout — blanking that loses a good final.
    if (speech_ratio is None or speech_ratio < 0.5) and _is_repetitive_hallucination(text):
        return True

    return False


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
    language_hint = normalize_hint(language_hint)  # never 'auto' past this point
    backend_name = resolve_backend(language_hint, is_final=is_final)
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

    # Sliding window FIRST: partials only re-decode the last N seconds, so all
    # preprocessing below runs on O(window) samples, not the full growing
    # utterance — keeps partial cost O(1) regardless of utterance length.
    decode_audio = audio
    if not is_final and audio.size > config.PARTIAL_WINDOW_SAMPLES:
        decode_audio = audio[-config.PARTIAL_WINDOW_SAMPLES:]
        logger.debug(
            "utt=%s partial: sliding window %.1fs→%.1fs",
            utterance_id, audio.size / config.SAMPLE_RATE, config.PARTIAL_WINDOW_S,
        )

    if decode_audio.size == 0:
        out["asr_latency_ms"] = round((time.perf_counter() - t0) * 1000, 1)
        logger.debug("utt=%s %s: empty audio, skipped ASR", utterance_id, out["type"])
        return out

    # Preprocessing BEFORE the silence gate — order matters:
    # highpass → normalize → trim → gate. The silence thresholds (SILENCE_RMS/
    # SILENCE_PEAK) assume normalized audio; gating first would throw away whole
    # utterances from quiet mics (worst with browser AGC off in Studio Mode).
    # A truly dead signal survives normalization un-boosted past the ~20x gain
    # cap and is still rejected by the gate below.
    decode_audio = _highpass_filter(decode_audio)
    decode_audio = _normalize_audio(decode_audio)

    # Trim dead-air from the end to prevent Whisper hallucinations on trailing
    # noise (runs on normalized audio — same scale as the gate thresholds).
    decode_audio = _trim_trailing_silence(decode_audio)
    # Frame-level speech stats; also reused to gate the repetition filter below
    # (is_final=True short-circuits with speech_ms=duration, useless as a ratio).
    _speech_probe = detect_eou(decode_audio, is_final=False)
    out["eou"] = (
        detect_eou(decode_audio, is_final=True).to_dict() if is_final else _speech_probe.to_dict()
    )

    if _is_silence(decode_audio):
        # Hallucination guard: whisper invents text on silence — skip the API.
        out["asr_latency_ms"] = round((time.perf_counter() - t0) * 1000, 1)
        logger.debug("utt=%s %s: silence, skipped ASR", utterance_id, out["type"])
        return out

    timeout_s = config.TIMEOUT_FINAL_S if is_final else config.TIMEOUT_PARTIAL_S

    try:
        with _request_gate.acquire(is_final=is_final):
            result = get_engine(backend_name).transcribe(
                decode_audio,
                language_hint=language_hint,
                fast=not is_final,
                timeout_s=timeout_s,
            )
    except EngineError as e:
        # Partial results are best-effort. Retrying them immediately doubles
        # upstream pressure and can delay the authoritative final request.
        if config.BACKEND == "auto" and is_final:
            fallback_name = None
            if backend_name == "fpt" and e.code in ("http_5xx", "timeout", "network", "http_4xx"):
                # FPT fast model failed — fall back to base whisper on FPT
                fallback_name = "fpt_final"
            elif backend_name == "fpt_final" and e.code in ("http_5xx", "timeout", "network", "http_4xx"):
                # Base whisper on FPT also failed — fall back to fast FPT model as last resort
                fallback_name = "fpt"

            if fallback_name and fallback_name != backend_name:
                logger.warning(
                    "utt=%s %s: primary backend %r failed (%s: %s), falling back to %r",
                    utterance_id, out["type"], backend_name, e.code, e.message[:60], fallback_name,
                )
                backend_name = fallback_name
                out["backend"] = backend_name
                try:
                    with _request_gate.acquire(is_final=True):
                        result = get_engine(backend_name).transcribe(
                            decode_audio,
                            language_hint=language_hint,
                            fast=False,
                            timeout_s=timeout_s,
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

    # Hallucination guard (post-decode): Whisper emits ghost phrases on silence/noise.
    # Suppress the text and mark low_confidence so the caller can handle it gracefully.
    speech_ratio = (
        _speech_probe.speech_ms / _speech_probe.duration_ms
        if config.EOU_ENABLED and _speech_probe.duration_ms > 0
        else None
    )
    if _is_hallucination(out["text"], result, speech_ratio=speech_ratio):
        logger.warning(
            "utt=%s %s [%s]: hallucination suppressed %r",
            utterance_id, out["type"], backend_name, out["text"][:60],
        )
        out["text"] = ""
        out["low_confidence"] = True
    out["asr_latency_ms"] = round((time.perf_counter() - t0) * 1000, 1)
    if "network_ms" in result.timings_ms:
        out["network_ms"] = result.timings_ms["network_ms"]

    logger.info(
        "utt=%s %s [%s]: audio=%.1fs latency=%.0fms lang=%s "
        "no_speech=%.2f avg_logprob=%s low_conf=%s text=%r",
        utterance_id, out["type"], backend_name, audio.size / config.SAMPLE_RATE,
        out["asr_latency_ms"], out["language"],
        result.no_speech_prob if result.no_speech_prob is not None else -1,
        f"{result.avg_logprob:.2f}" if result.avg_logprob is not None else "n/a",
        out["low_confidence"],
        out["text"][:60],
    )
    return out
