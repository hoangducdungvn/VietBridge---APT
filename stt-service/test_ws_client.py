import argparse
import asyncio
import json
from pathlib import Path

import websockets


async def transcribe(audio_path: Path, url: str) -> None:
    async with websockets.connect(url, max_size=None) as websocket:
        await websocket.send(audio_path.read_bytes())
        print(json.dumps(json.loads(await websocket.recv()), ensure_ascii=False, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("audio", type=Path)
    parser.add_argument("--url", default="ws://127.0.0.1:8000/ws")
    args = parser.parse_args()
    asyncio.run(transcribe(args.audio, args.url))


if __name__ == "__main__":
    main()
