"""Load a faster-whisper model once to verify/download ASR runtime assets."""

from __future__ import annotations

import argparse

from src.asr import WhisperASR


def main() -> None:
    parser = argparse.ArgumentParser(description="Smoke-load the ASR model without running the gateway.")
    parser.add_argument("--model", default="tiny", help="faster-whisper model name or local model directory")
    parser.add_argument("--download", action="store_true", help="allow downloading the model into the local HF cache")
    args = parser.parse_args()

    WhisperASR(args.model, local_files_only=not args.download)
    print(f"ASR model loaded: {args.model}")


if __name__ == "__main__":
    main()
