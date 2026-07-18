"""Prepare small Vietnamese and English FLEURS ASR benchmark manifests."""

from __future__ import annotations

import argparse
from pathlib import Path

import soundfile as sf
from datasets import Audio, load_dataset


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "data" / "asr_testset"
LANGUAGES = {"vi": "vi_vn", "en": "en_us"}


def directory_size(path: Path) -> int:
    return sum(file.stat().st_size for file in path.rglob("*") if file.is_file())


def human_size(size: int) -> str:
    units = ("B", "KiB", "MiB", "GiB")
    value = float(size)
    for unit in units:
        if value < 1024 or unit == units[-1]:
            return f"{value:.2f} {unit}"
        value /= 1024
    raise AssertionError("unreachable")


def prepare_language(language: str, config: str, output_dir: Path, count: int) -> int:
    dataset = load_dataset("google/fleurs", config, split="test")
    if len(dataset) < count:
        raise ValueError(f"FLEURS {config} test only has {len(dataset)} rows; requested {count}")

    # Decode/resample lazily only for the selected rows.
    dataset = dataset.select(range(count)).cast_column("audio", Audio(sampling_rate=16_000))
    audio_dir = output_dir / f"fleurs_{language}"
    audio_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = output_dir / f"manifest_{language}.tsv"

    with manifest_path.open("w", encoding="utf-8", newline="") as manifest:
        manifest.write("audio_path\treference_text\tlanguage\n")
        for index, sample in enumerate(dataset):
            audio = sample["audio"]
            wav_path = audio_dir / f"{index:04d}.wav"
            sf.write(wav_path, audio["array"], 16_000, subtype="PCM_16")
            reference = str(sample["transcription"]).replace("\t", " ").replace("\r", " ").replace("\n", " ")
            relative_path = wav_path.relative_to(PROJECT_ROOT).as_posix()
            manifest.write(f"{relative_path}\t{reference}\t{language}\n")

    return count


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--count", type=int, default=25, help="Samples per language (default: 25)")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.count < 1:
        raise ValueError("--count must be at least 1")

    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    total = sum(
        prepare_language(language, config, output_dir, args.count)
        for language, config in LANGUAGES.items()
    )
    print(f"Prepared {total} samples ({args.count} per language).")
    print(f"Output size: {human_size(directory_size(output_dir))} ({output_dir})")


if __name__ == "__main__":
    main()
