"""Latency helpers for gateway JSONL output and local ASR/MT model smoke benchmarks."""

from __future__ import annotations

import argparse
import json
import sys
import time
import wave
from pathlib import Path
from statistics import mean
from typing import Any

import numpy as np

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))


def summarize(path: Path) -> dict[str, float]:
    totals: dict[str, list[float]] = {}
    with path.open(encoding="utf-8") as file:
        for line in file:
            if not line.strip():
                continue
            event = json.loads(line)
            for key, value in event.get("latency_ms", {}).items():
                totals.setdefault(key, []).append(float(value))
    return {key: round(sum(values) / len(values), 2) for key, values in totals.items() if values}


def read_pcm16_wav(path: Path) -> tuple[np.ndarray, float]:
    with wave.open(str(path), "rb") as wav_file:
        if wav_file.getnchannels() != 1 or wav_file.getsampwidth() != 2 or wav_file.getframerate() != 16000:
            raise ValueError("Input WAV must be PCM16 mono 16 kHz")
        pcm = wav_file.readframes(wav_file.getnframes())
        audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
        return audio, wav_file.getnframes() / 16000.0


def time_call(callback: Any) -> tuple[float, Any]:
    started = time.perf_counter()
    result = callback()
    return (time.perf_counter() - started) * 1000, result


def benchmark_asr(args: argparse.Namespace) -> dict[str, Any]:
    from src.asr import WhisperASR

    audio, audio_seconds = read_pcm16_wav(Path(args.wav))
    asr = WhisperASR(
        args.asr_model,
        local_files_only=not args.download,
        partial_beam_size=args.partial_beam_size,
        final_beam_size=args.final_beam_size,
    )

    partial_ms: list[float] = []
    final_ms: list[float] = []
    partial_result: dict[str, Any] = {}
    final_result: dict[str, Any] = {}
    for _ in range(args.runs):
        elapsed, partial_result = time_call(lambda: asr.transcribe_partial(audio, args.language))
        partial_ms.append(elapsed)
        elapsed, final_result = time_call(lambda: asr.transcribe_final(audio, args.language))
        final_ms.append(elapsed)

    return {
        "kind": "asr",
        "model": args.asr_model,
        "audio_seconds": round(audio_seconds, 3),
        "runs": args.runs,
        "partial_beam_size": args.partial_beam_size,
        "final_beam_size": args.final_beam_size,
        "partial_ms_avg": round(mean(partial_ms), 2),
        "final_ms_avg": round(mean(final_ms), 2),
        "partial_text": partial_result.get("text", ""),
        "final_text": final_result.get("text", ""),
        "confidence": final_result.get("confidence", 0.0),
    }


def benchmark_mt(args: argparse.Namespace) -> dict[str, Any]:
    from src.mt import TransformersTranslator

    translator = TransformersTranslator(local_files_only=not args.download)
    elapsed_values: list[float] = []
    translation = ""
    for _ in range(args.runs):
        elapsed, translation = time_call(
            lambda: translator.translate(
                args.mt_text,
                args.mt_source_language,
                args.mt_target_language,
                args.forced_term,
            )
        )
        elapsed_values.append(elapsed)
    return {
        "kind": "mt",
        "source_language": args.mt_source_language,
        "target_language": args.mt_target_language,
        "runs": args.runs,
        "mt_ms_avg": round(mean(elapsed_values), 2),
        "text": args.mt_text,
        "translation": translation,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("jsonl", nargs="?", help="Optional newline-delimited gateway output events to summarize")
    parser.add_argument("--wav", help="Benchmark ASR on a PCM16 mono 16 kHz WAV")
    parser.add_argument("--asr-model", default="tiny", help="faster-whisper model name or local CTranslate2 path")
    parser.add_argument("--language", default="vi", choices=["vi", "en", "auto"])
    parser.add_argument("--partial-beam-size", type=int, default=1)
    parser.add_argument("--final-beam-size", type=int, default=5)
    parser.add_argument("--mt-text", help="Benchmark MT on this text")
    parser.add_argument("--mt-source-language", default="vi", choices=["vi", "en"])
    parser.add_argument("--mt-target-language", default="en", choices=["vi", "en"])
    parser.add_argument("--forced-term", action="append", default=[], help="Forced target term for MT post-check")
    parser.add_argument("--runs", type=int, default=1)
    parser.add_argument("--download", action="store_true", help="Allow downloading model files into local caches")
    args = parser.parse_args()

    outputs = []
    if args.jsonl:
        outputs.append({"kind": "jsonl", "summary": summarize(Path(args.jsonl))})
    if args.wav:
        outputs.append(benchmark_asr(args))
    if args.mt_text:
        outputs.append(benchmark_mt(args))
    if not outputs:
        parser.error("provide a JSONL file, --wav, or --mt-text")
    print(json.dumps(outputs[0] if len(outputs) == 1 else outputs, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
