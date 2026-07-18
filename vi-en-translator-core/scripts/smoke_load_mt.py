"""Load a localhost MT model once to verify/download runtime assets."""

from __future__ import annotations

import argparse

from src.mt import TransformersTranslator


def main() -> None:
    parser = argparse.ArgumentParser(description="Smoke-load the vi->en MT model.")
    parser.add_argument("--download", action="store_true", help="allow downloading the model into the local HF cache")
    parser.add_argument("--text", default="xin chao moi nguoi")
    args = parser.parse_args()

    translator = TransformersTranslator(local_files_only=not args.download)
    print(translator.translate(args.text, "vi", "en"))


if __name__ == "__main__":
    main()
