"""Convert common audio files to contract-compatible PCM16 mono 16 kHz WAV."""

from __future__ import annotations

import argparse
import wave
from pathlib import Path

import av
import numpy as np


def convert(input_path: Path, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
    pcm_chunks: list[bytes] = []

    with av.open(str(input_path)) as container:
        for frame in container.decode(audio=0):
            resampled = resampler.resample(frame)
            frames = resampled if isinstance(resampled, list) else [resampled]
            for audio_frame in frames:
                array = audio_frame.to_ndarray()
                pcm = np.asarray(array).reshape(-1).astype("<i2", copy=False)
                pcm_chunks.append(pcm.tobytes())

    with wave.open(str(output_path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(16000)
        wav_file.writeframes(b"".join(pcm_chunks))

    print(f"wrote {output_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert audio to PCM16 mono 16 kHz WAV.")
    parser.add_argument("input")
    parser.add_argument("output")
    args = parser.parse_args()
    convert(Path(args.input), Path(args.output))


if __name__ == "__main__":
    main()
