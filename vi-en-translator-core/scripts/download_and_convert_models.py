"""Explicit operator step for downloading/preloading local ASR and MT models.

For faster-whisper model-size names such as ``base``, ``small`` and
``large-v3-turbo``, faster-whisper downloads CTranslate2-ready assets from the
Hugging Face cache. If you need a custom raw Whisper checkpoint, convert it to
CTranslate2 outside the gateway and pass the converted directory as ASR_MODEL.
"""

from __future__ import annotations

import argparse
import os

from src.asr import WhisperASR
from src.mt import TransformersTranslator


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--asr-model", action="append", default=[], help="faster-whisper model size/name/path to preload")
    parser.add_argument("--mt", action="store_true", help="preload the local vi->en MT model")
    parser.add_argument("--download", action="store_true", help="allow downloading missing files into local caches")
    parser.add_argument("--partial-beam-size", type=int, default=1)
    parser.add_argument("--final-beam-size", type=int, default=5)
    args = parser.parse_args()

    local_files_only = not args.download
    if local_files_only:
        os.environ.setdefault("HF_HUB_OFFLINE", "1")
        os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

    for model_name in args.asr_model:
        WhisperASR(
            model_name,
            local_files_only=local_files_only,
            partial_beam_size=args.partial_beam_size,
            final_beam_size=args.final_beam_size,
        )
        print(f"ASR model ready: {model_name}")

    if args.mt:
        mt = TransformersTranslator(local_files_only=local_files_only)
        mt._load("vi", "en")
        print("MT model ready: Helsinki-NLP/opus-mt-vi-en")


if __name__ == "__main__":
    main()
