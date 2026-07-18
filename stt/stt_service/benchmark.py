"""Latency benchmark: 3s/10s/25s audio, 5 runs each, partial vs final mode.

Usage:
    python benchmark.py [--wav path/to/16k_mono.wav] [--backend fpt|local] [--runs 5]

Without --wav, synthetic speech-band audio is used: latency numbers are real,
transcribed text is meaningless. For FPTCloudEngine the table separates network
round-trip from total time (total = WAV encode + network + parse).
"""

if __package__ in (None, ""):  # allow `python benchmark.py` from inside stt_service/
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import argparse
import logging
import statistics
import wave

import numpy as np

from stt_service import config, service
from stt_service.engine import create_engine

DURATIONS_S = [3, 10, 25]


def synth_audio(seconds: float, sr: int = config.SAMPLE_RATE) -> np.ndarray:
    """Speech-band noise + AM tone: passes the silence guard, sized like speech."""
    rng = np.random.default_rng(42)
    n = int(seconds * sr)
    t = np.arange(n) / sr
    tone = 0.15 * np.sin(2 * np.pi * 180 * t) * (0.5 + 0.5 * np.sin(2 * np.pi * 3 * t))
    noise = 0.05 * rng.standard_normal(n)
    return (tone + noise).astype(np.float32)


def load_wav(path: str) -> np.ndarray:
    with wave.open(path, "rb") as wf:
        if wf.getframerate() != config.SAMPLE_RATE or wf.getnchannels() != 1:
            raise SystemExit(f"{path}: need 16 kHz mono WAV, got "
                             f"{wf.getframerate()} Hz / {wf.getnchannels()} ch")
        pcm = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16)
    return (pcm.astype(np.float32) / 32768.0)


def fit_duration(audio: np.ndarray, seconds: float) -> np.ndarray:
    n = int(seconds * config.SAMPLE_RATE)
    reps = int(np.ceil(n / max(audio.size, 1)))
    return np.tile(audio, reps)[:n]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--wav", help="16 kHz mono WAV to use as source audio")
    ap.add_argument("--backend", choices=["fpt", "local"], help="override config.BACKEND")
    ap.add_argument("--runs", type=int, default=5)
    args = ap.parse_args()

    logging.basicConfig(level=logging.WARNING)  # keep the table readable
    if args.backend:
        config.BACKEND = args.backend
        service._engine = None
    backend_name = args.backend or config.BACKEND

    source = load_wav(args.wav) if args.wav else synth_audio(max(DURATIONS_S))
    if not args.wav:
        print("NOTE: synthetic audio — latency is real, text output is garbage.\n")

    # Warmup: opens the TLS connection (fpt) / loads the model (local) so run 1
    # isn't polluted by one-time setup cost.
    service.transcribe("warmup", fit_duration(source, 2), "vi", is_final=False)

    rows = []
    for dur in DURATIONS_S:
        audio = fit_duration(source, dur)
        for is_final in (False, True):
            mode = "final" if is_final else "partial"
            totals, networks, errors = [], [], 0
            for i in range(args.runs):
                r = service.transcribe(f"bench-{dur}s-{mode}-{i}", audio, "vi", is_final)
                if "error" in r:
                    errors += 1
                    print(f"  ! {dur}s {mode} run {i}: {r['error']['code']} "
                          f"({r['error'].get('status')})")
                    continue
                totals.append(r["asr_latency_ms"])
                if "network_ms" in r:
                    networks.append(r["network_ms"])
            row = {"dur": dur, "mode": mode, "errors": errors}
            if totals:
                row["mean"] = statistics.fmean(totals)
                row["p95"] = float(np.percentile(totals, 95))
                row["net_mean"] = statistics.fmean(networks) if networks else None
            rows.append(row)

    print(f"\nBackend: {backend_name}   runs/cell: {args.runs}")
    print(f"{'audio':>6} {'mode':>8} {'mean_ms':>9} {'p95_ms':>9} {'net_mean_ms':>12} {'errors':>7}")
    for r in rows:
        if "mean" in r:
            net = f"{r['net_mean']:.0f}" if r.get("net_mean") is not None else "-"
            print(f"{r['dur']:>5}s {r['mode']:>8} {r['mean']:>9.0f} {r['p95']:>9.0f} "
                  f"{net:>12} {r['errors']:>7}")
        else:
            print(f"{r['dur']:>5}s {r['mode']:>8} {'-':>9} {'-':>9} {'-':>12} {r['errors']:>7}")

    # Feasibility of the 1s partial cadence: the partial decode of the LONGEST
    # utterance must finish well inside one interval, or requests pile up.
    partials = [r for r in rows if r["mode"] == "partial" and "p95" in r]
    if partials:
        worst = max(partials, key=lambda r: r["p95"])
        print(f"\nWorst partial p95: {worst['p95']:.0f} ms at {worst['dur']}s audio.")
        if worst["p95"] < 800:
            print("=> 1s partial cadence is FEASIBLE (p95 comfortably under 1s).")
        elif worst["p95"] < 1400:
            print("=> 1s cadence is borderline; use a 1.5s interval to be safe.")
        else:
            print("=> 1s cadence NOT feasible; stretch the interval to 2s "
                  "and/or cap re-decode to the last ~15s of audio.")
    else:
        print("\nAll partial runs failed — check FPT_API_KEY / network before concluding.")


if __name__ == "__main__":
    main()
