from pathlib import Path
import sys

from app.model import transcribe_file


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python test_infer.py <audio-file>")
    audio_path = Path(sys.argv[1])
    if not audio_path.is_file():
        raise SystemExit(f"Audio file not found: {audio_path}")
    print(transcribe_file(audio_path).model_dump_json(indent=2))


if __name__ == "__main__":
    main()

