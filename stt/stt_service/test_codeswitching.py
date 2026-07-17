from __future__ import annotations

# -*- coding: utf-8 -*-
"""
Code-switching test: FPT Cloud vs Local Whisper on VI<->EN mixed sentences.

Usage (run from the stt/ folder):
  pip install gtts scipy

  python stt_service/test_codeswitching.py              # both backends
  python stt_service/test_codeswitching.py --backend fpt
  python stt_service/test_codeswitching.py --backend local
  python stt_service/test_codeswitching.py --cases cs_01 cs_10
  python stt_service/test_codeswitching.py --output results/cs_result.json
  python stt_service/test_codeswitching.py --wav tests/sample_en.wav
"""

import sys
import io
import json
import logging
import os
import time
import wave
import argparse
import subprocess
import shutil
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

import numpy as np

# Fix Windows console encoding
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf-16"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Allow running as: python stt_service/test_codeswitching.py
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from stt_service import config
from stt_service.engine import create_engine, EngineError

# ---------------------------------------------------------------------------
# Test corpus — 12 sentences covering business meeting VI<->SG code-switching
# (case_id, label, text, language_hint, note)
# ---------------------------------------------------------------------------
CODE_SWITCHING_CASES = [
    # Group 1: Nguoi Viet noi + thuật ngữ Anh
    ("cs_01", "VI+EN_term",
     "Chung toi de xuat partnership model voi dieu kien fifty-fifty revenue sharing.",
     "vi",
     "VI sentence with EN business terms — most common in meetings"),

    ("cs_02", "VI+EN_acronym",
     "Phia chung toi can xem lai MOU truoc khi ky NDA voi Singapore.",
     "vi",
     "EN acronyms in VI sentence — MOU, NDA must stay unchanged"),

    ("cs_03", "VI+EN_number",
     "Ngan sach du kien khoang two million dollars, tra theo milestone hang quy.",
     "vi",
     "EN number in VI sentence — can model read 'two million'?"),

    ("cs_04", "VI+EN_tech",
     "Chung toi se deploy solution nay tren AWS, khong phai on-premise.",
     "vi",
     "Tech terms: deploy, AWS, on-premise — must NOT be phonetically transcribed"),

    ("cs_05", "VI+EN_end",
     "Cam on anh Alex, thank you for your time hom nay.",
     "vi",
     "Sentence ends in English — common when wrapping up a speech turn"),

    # Group 2: Singapore speaker + Vietnamese words
    ("cs_06", "EN+VI_phrase",
     "We propose a joint venture, similar to the previous model from last meetings.",
     "en",
     "Pure EN — baseline for EN accuracy"),

    ("cs_07", "EN+VI_name",
     "I discussed this with Anh Dung yesterday, and he agreed to the terms.",
     "en",
     "Vietnamese honorific 'Anh' before a name in EN sentence"),

    ("cs_08", "EN+VI_city",
     "The pilot will run in Ho Chi Minh City, then expand to Ha Noi and Da Nang.",
     "en",
     "Vietnamese place names inside an English sentence"),

    # Group 3: Pure baseline
    ("cs_09", "PURE_VI",
     "Chung toi muon bat dau hop tac vao thang chin nam nay.",
     "vi",
     "Baseline: pure Vietnamese — both engines should do well"),

    ("cs_10", "PURE_EN",
     "We would like to begin the collaboration in September this year.",
     "en",
     "Baseline: pure English — FPT will likely FAIL, Local Whisper should PASS"),

    # Group 4: Edge cases
    ("cs_11", "VI+filler+EN",
     "Um, basically chung toi can the deliverables by end of Q3.",
     "vi",
     "Starts with filler 'Um' then heavy EN — how does model handle it?"),

    ("cs_12", "NUMBERS_MIXED",
     "Revenue tang twenty percent, tuong duong khoang 50 ty dong.",
     "vi",
     "Mixed numerals: EN 'twenty percent' and VI '50 ty' in same sentence"),
]

BACKENDS = ["fpt", "local"]


# ---------------------------------------------------------------------------
# Result data classes
# ---------------------------------------------------------------------------

@dataclass
class EngineRunResult:
    backend: str
    text: str
    language_detected: Optional[str]
    latency_ms: float
    network_ms: Optional[float]
    low_confidence: bool
    error: Optional[dict] = None


@dataclass
class CaseResult:
    case_id: str
    label: str
    expected_text: str
    language_hint: str
    note: str
    audio_duration_s: float
    results: dict[str, EngineRunResult] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Audio helpers
# ---------------------------------------------------------------------------

def synthesize_tts(text: str, lang: str) -> np.ndarray:
    """gTTS -> float32 16kHz mono PCM. Uses ffmpeg if available, else temp file."""
    try:
        from gtts import gTTS
    except ImportError:
        raise SystemExit("ERROR: gtts not installed. Run: pip install gtts")

    tts_lang = lang.split("-")[0] if lang else "vi"
    tts = gTTS(text=text, lang=tts_lang, slow=False)
    mp3_buf = io.BytesIO()
    tts.write_to_fp(mp3_buf)
    mp3_bytes = mp3_buf.getvalue()

    # Try ffmpeg directly (fastest, no pydub needed)
    if shutil.which("ffmpeg"):
        proc = subprocess.run(
            ["ffmpeg", "-i", "pipe:0",
             "-f", "s16le", "-ar", "16000", "-ac", "1", "pipe:1",
             "-loglevel", "quiet"],
            input=mp3_bytes, capture_output=True,
        )
        if proc.returncode == 0 and proc.stdout:
            pcm = np.frombuffer(proc.stdout, dtype=np.int16)
            return pcm.astype(np.float32) / 32768.0

    # Fallback: write MP3 to temp file, convert with ffmpeg
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
        f.write(mp3_bytes)
        mp3_path = f.name
    wav_path = mp3_path.replace(".mp3", ".wav")
    try:
        if shutil.which("ffmpeg"):
            subprocess.run(
                ["ffmpeg", "-i", mp3_path, "-ar", "16000", "-ac", "1",
                 wav_path, "-y", "-loglevel", "quiet"],
                check=True,
            )
            return load_wav(wav_path)
        raise SystemExit(
            "ERROR: ffmpeg not found. Install ffmpeg OR use --wav with a pre-existing WAV.\n"
            "  Windows: winget install ffmpeg   OR   choco install ffmpeg\n"
            "  Then restart terminal."
        )
    finally:
        for p in [mp3_path, wav_path]:
            try:
                os.unlink(p)
            except OSError:
                pass


def load_wav(path: str) -> np.ndarray:
    """Load 16kHz mono WAV -> float32."""
    with wave.open(path, "rb") as wf:
        if wf.getframerate() != 16000 or wf.getnchannels() != 1:
            raise SystemExit(
                f"ERROR: {path}: need 16kHz mono WAV, "
                f"got {wf.getframerate()}Hz / {wf.getnchannels()}ch"
            )
        pcm = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16)
    return pcm.astype(np.float32) / 32768.0


# ---------------------------------------------------------------------------
# Engine runner
# ---------------------------------------------------------------------------

def run_engine(backend: str, audio: np.ndarray, language_hint: str) -> EngineRunResult:
    """Call engine.transcribe() directly with final-quality decode."""
    try:
        engine = create_engine(backend)
    except RuntimeError as e:
        return EngineRunResult(
            backend=backend, text="", language_detected=None,
            latency_ms=0.0, network_ms=None, low_confidence=True,
            error={"code": "init_error", "message": str(e), "status": None},
        )

    t0 = time.perf_counter()
    try:
        result = engine.transcribe(
            audio=audio,
            language_hint=language_hint,
            fast=False,        # final-quality decode (beam=5 for local)
            timeout_s=15.0,
        )
    except EngineError as e:
        return EngineRunResult(
            backend=backend, text="", language_detected=None,
            latency_ms=round((time.perf_counter() - t0) * 1000, 1),
            network_ms=None, low_confidence=True, error=e.to_dict(),
        )

    latency_ms = round((time.perf_counter() - t0) * 1000, 1)
    low_conf = bool(
        (result.avg_logprob is not None and result.avg_logprob < config.LOW_CONF_AVG_LOGPROB)
        or (result.no_speech_prob is not None and result.no_speech_prob > config.LOW_CONF_NO_SPEECH)
    )
    return EngineRunResult(
        backend=backend,
        text=result.text,
        language_detected=result.language,
        latency_ms=latency_ms,
        network_ms=result.timings_ms.get("network_ms"),
        low_confidence=low_conf,
    )


# ---------------------------------------------------------------------------
# Terminal output
# ---------------------------------------------------------------------------

def _trunc(s: str, n: int = 75) -> str:
    return s if len(s) <= n else s[:n - 3] + "..."


def print_case(case: CaseResult, backends: list[str]) -> None:
    print(f"\n{'-' * 90}")
    print(f"  [{case.case_id}] {case.label}   ({case.audio_duration_s:.1f}s audio)")
    print(f"  hint={case.language_hint}  | {case.note}")
    print(f"  Input : {_trunc(case.expected_text)}")
    print()
    for backend in backends:
        r = case.results.get(backend)
        if r is None:
            print(f"  [{backend:>6}]  (not run)")
            continue
        if r.error:
            code = r.error.get("code", "?")
            msg  = r.error.get("message", "")[:60]
            stat = r.error.get("status")
            print(f"  [{backend:>6}]  ERROR {code} (HTTP {stat}): {msg}")
            continue
        lat = f"{r.latency_ms:.0f}ms"
        if r.network_ms is not None:
            lat += f" (net {r.network_ms:.0f}ms)"
        conf_flag = " [low_conf]" if r.low_confidence else ""
        lang_flag = ""
        if r.language_detected and r.language_detected != case.language_hint:
            lang_flag = f"  [lang: {case.language_hint}->{r.language_detected}]"
        print(f"  [{backend:>6}]  {lat:<24} {_trunc(r.text, 60)}{conf_flag}{lang_flag}")
    print()


def print_summary(cases: list[CaseResult], backends: list[str]) -> None:
    print(f"\n{'=' * 90}")
    print("  SUMMARY")
    print(f"{'=' * 90}")
    print(f"  {'Case':<10} {'Hint':<5} {'Label':<22}", end="")
    for b in backends:
        print(f"  {b:>10}", end="")
    print()
    for case in cases:
        print(f"  {case.case_id:<10} {case.language_hint:<5} {case.label:<22}", end="")
        for b in backends:
            r = case.results.get(b)
            if r is None:
                cell = "skip"
            elif r.error:
                cell = "ERROR"
            elif r.low_confidence:
                cell = f"{r.latency_ms:.0f}ms*"
            else:
                cell = f"{r.latency_ms:.0f}ms"
            print(f"  {cell:>10}", end="")
        print()
    print()

    # FPT English gap analysis
    fpt_en_fails = [
        c for c in cases
        if c.language_hint == "en" and "fpt" in c.results
        and c.results["fpt"].error
    ]
    if fpt_en_fails:
        print(f"  [CONCLUSION] FPT failed on {len(fpt_en_fails)} EN case(s) "
              "=> FPT is VI-only. Use Local Whisper for EN stream.")

    # Code-switch distortion check
    cs_vi = [c for c in cases if c.language_hint == "vi" and "VI+EN" in c.label]
    if cs_vi and "fpt" in backends:
        ok  = sum(1 for c in cs_vi if "fpt" in c.results and not c.results["fpt"].error)
        print(f"  [INFO] {len(cs_vi)} VI+EN code-switch cases run on FPT ({ok} returned text). "
              "Check transcripts above for phonetic distortion of EN terms.")

    # Local lang detect
    if "local" in backends:
        override = [
            c for c in cases
            if "local" in c.results
            and c.results["local"].language_detected
            and c.results["local"].language_detected != c.language_hint
        ]
        if override:
            print(f"  [INFO] Local Whisper overrode language hint on {len(override)} case(s): "
                  + ", ".join(c.case_id for c in override))

    print(f"{'=' * 90}\n")
    print("  * = low_confidence flag set by engine")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--backend", choices=["fpt", "local", "groq", "both"], default="both")
    ap.add_argument("--wav", help="Use this 16kHz mono WAV for all cases (skip TTS)")
    ap.add_argument("--cases", nargs="+", metavar="ID",
                    help="Only run specific case IDs, e.g. cs_01 cs_10")
    ap.add_argument("--output", metavar="FILE",
                    help="Write JSON results to this file")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.WARNING,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )

    backends_to_test: list[str] = [args.backend] if args.backend != "both" else list(BACKENDS)

    cases_to_run = CODE_SWITCHING_CASES
    if args.cases:
        cases_to_run = [c for c in CODE_SWITCHING_CASES if c[0] in args.cases]
        if not cases_to_run:
            raise SystemExit(f"No cases found matching: {args.cases}")

    # Check FPT key
    if "fpt" in backends_to_test:
        config._load_dotenv()
        if not os.environ.get("FPT_API_KEY"):
            print("[WARN] FPT_API_KEY not set -- skipping FPT backend.")
            print("  Set: $env:FPT_API_KEY = 'sk-...'")
            backends_to_test = [b for b in backends_to_test if b != "fpt"]

    if not backends_to_test:
        raise SystemExit("No backends available to test.")

    # Check TTS deps
    static_audio: Optional[np.ndarray] = None
    if args.wav:
        static_audio = load_wav(args.wav)
        print(f"[INFO] Using WAV: {args.wav} ({static_audio.size/16000:.1f}s) for all cases.")
        print("       Note: transcripts will NOT match expected_text.\n")
    else:
        # Quick check gtts available
        try:
            import gtts  # noqa: F401
        except ImportError:
            raise SystemExit("ERROR: gtts not installed. Run: pip install gtts")
        # Check ffmpeg
        if not shutil.which("ffmpeg"):
            print("[WARN] ffmpeg not found in PATH.")
            print("  TTS synthesis requires ffmpeg to decode MP3.")
            print("  Install: winget install ffmpeg  OR  choco install ffmpeg")
            print("  Then restart terminal and re-run.")
            print("  Alternative: use --wav tests/sample_en.wav (from the stt/ folder)\n")
            raise SystemExit(1)

    print(f"[START] Code-Switching Test -- {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(f"  Backends : {', '.join(backends_to_test)}")
    print(f"  Cases    : {len(cases_to_run)}")
    print(f"  Audio    : {'WAV: ' + str(args.wav) if args.wav else 'gTTS + ffmpeg'}\n")

    # Warmup each engine
    warmup_audio = (
        static_audio[:16000] if static_audio is not None
        else np.full(16000, 1e-4, dtype=np.float32)
    )
    active_backends: list[str] = []
    for backend in backends_to_test:
        print(f"  [warmup] {backend}...", end=" ", flush=True)
        r = run_engine(backend, warmup_audio, "vi")
        if r.error and r.error.get("code") == "init_error":
            print(f"FAILED: {r.error['message'][:80]}")
        else:
            print(f"OK ({r.latency_ms:.0f}ms)")
            active_backends.append(backend)

    if not active_backends:
        raise SystemExit("All backends failed to initialize.")
    print()

    # Run cases
    all_results: list[CaseResult] = []

    for case_id, label, text, lang_hint, note in cases_to_run:
        print(f">> [{case_id}] {label}...", end=" ", flush=True)

        # Get audio for this case
        if static_audio is not None:
            est_secs = min(max(len(text.split()) * 0.35, 2.0), 25.0)
            n = int(est_secs * 16000)
            audio = np.tile(static_audio, int(np.ceil(n / static_audio.size)))[:n]
        else:
            try:
                audio = synthesize_tts(text, lang_hint)
            except SystemExit:
                raise
            except Exception as e:
                print(f"TTS ERROR: {e}")
                continue

        dur = audio.size / 16000
        print(f"{dur:.1f}s")

        case_result = CaseResult(
            case_id=case_id, label=label, expected_text=text,
            language_hint=lang_hint, note=note, audio_duration_s=dur,
        )

        for backend in active_backends:
            r = run_engine(backend, audio, lang_hint)
            case_result.results[backend] = r

        print_case(case_result, active_backends)
        all_results.append(case_result)

    print_summary(all_results, active_backends)

    # Optional JSON output
    if args.output:
        out_path = Path(args.output)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "timestamp": datetime.now().isoformat(),
            "backends": active_backends,
            "audio_source": args.wav or "gtts+ffmpeg",
            "cases": [
                {
                    "case_id": c.case_id,
                    "label": c.label,
                    "expected_text": c.expected_text,
                    "language_hint": c.language_hint,
                    "note": c.note,
                    "audio_duration_s": c.audio_duration_s,
                    "results": {b: asdict(r) for b, r in c.results.items()},
                }
                for c in all_results
            ],
        }
        out_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"[SAVED] Results written to: {out_path}")


if __name__ == "__main__":
    main()
