import argparse
from pathlib import Path

import httpx


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("audio", type=Path)
    parser.add_argument("--url", default="http://127.0.0.1:8000/transcribe")
    parser.add_argument("--language", default="vi")
    args = parser.parse_args()

    with args.audio.open("rb") as audio_file:
        response = httpx.post(
            args.url,
            files={"file": (args.audio.name, audio_file, "application/octet-stream")},
            data={"language": args.language},
            timeout=120,
        )
    response.raise_for_status()
    print(response.json())


if __name__ == "__main__":
    main()

