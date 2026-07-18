"""Fake ingestion gateway: test the STT service without waiting for teammates.

Reads a 16 kHz mono WAV, slices it into 2s chunks, calls
transcribe(is_final=False) on the accumulated audio after each chunk
(periodic re-decode), then transcribe(is_final=True) once at the end.

Partial interval is 2s (benchmark showed FPT p95≈2.9s — 1s caused queue backlog).

Usage:
    python mock_gateway.py tests/sample_vi.wav [--lang vi] [--realtime] [--use-queue]
    python mock_gateway.py --synth 5          # no WAV handy: 5s of synthetic audio
"""

if __package__ in (None, ""):  # allow `python mock_gateway.py` from inside stt_service/
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import argparse
import logging
import time
import uuid

import numpy as np

from stt_service import config, service
from stt_service.queue_worker import STTJob, STTQueueWorker

CHUNK_S = 2.0  # 2s partial interval — 1s caused queue backlog (FPT p95≈2.9s, avg=1.7s)


def print_result(r: dict) -> None:
    tag = r["type"].upper()
    if "error" in r:
        print(f"[{tag:>7} {r['asr_latency_ms']:>6.0f}ms] ERROR "
              f"{r['error']['code']} ({r['error'].get('status')})")
        return
    conf = " (low_confidence)" if r["low_confidence"] else ""
    print(f"[{tag:>7} {r['asr_latency_ms']:>6.0f}ms {r['language']}]{conf} {r['text']!r}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("wav", nargs="?", help="16 kHz mono WAV file")
    ap.add_argument("--lang", default="vi", choices=["vi", "en"])
    ap.add_argument("--realtime", action="store_true",
                    help="sleep 2s between chunks like a live stream")
    ap.add_argument("--use-queue", action="store_true",
                    help="route jobs through STTQueueWorker instead of calling directly")
    ap.add_argument("--synth", type=float, metavar="SECONDS",
                    help="use synthetic audio instead of a WAV (latency smoke test)")
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(name)s %(levelname)s %(message)s")

    if args.synth:
        from stt_service.benchmark import synth_audio
        audio = synth_audio(args.synth)
        print(f"Synthetic audio {args.synth:.0f}s (text will be garbage)\n")
    elif args.wav:
        from stt_service.benchmark import load_wav
        audio = load_wav(args.wav)
        print(f"{args.wav}: {audio.size / config.SAMPLE_RATE:.1f}s\n")
    else:
        ap.error("give a WAV path or --synth SECONDS")

    utterance_id = uuid.uuid4().hex[:8]
    chunk = int(CHUNK_S * config.SAMPLE_RATE)
    worker = STTQueueWorker() if args.use_queue else None

    def run(accumulated: np.ndarray, is_final: bool) -> None:
        if worker:
            worker.submit(STTJob(utterance_id, accumulated.copy(), args.lang,
                                 is_final, callback=print_result))
        else:
            print_result(service.transcribe(utterance_id, accumulated, args.lang, is_final))

    n_chunks = int(np.ceil(audio.size / chunk))
    for i in range(n_chunks):
        accumulated = audio[: (i + 1) * chunk]
        if i < n_chunks - 1:  # last chunk goes out as the final decode below
            run(accumulated, is_final=False)
            if args.realtime:
                time.sleep(CHUNK_S)
    run(audio, is_final=True)

    if worker:
        worker.close(wait=True)


if __name__ == "__main__":
    main()
