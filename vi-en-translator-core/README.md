# VietBridge VI-EN Translator Core

Python gateway + STT + terminology + MT core for the `voice/` streaming contract.

## Install

```powershell
cd E:\merged_partition_content\Khoi_Project\VAIC-Hackathon\VietBridge---APT\vi-en-translator-core
pip install -r requirements.txt
```

The gateway does not load ASR/MT models on import or by default at startup. Real models are loaded only when `GATEWAY_ENABLE_MODELS=1` and model paths are configured.

## Run With `voice/`

Process 1, start the Python gateway:

```powershell
cd E:\merged_partition_content\Khoi_Project\VAIC-Hackathon\VietBridge---APT\vi-en-translator-core
python -m gateway.server
```

Process 2, run the existing `voice/` client and point it to:

```text
ws://localhost:8765
```

The browser client owns VAD and sends `utterance.start` / `utterance.end`; this gateway trusts those boundaries and only uses server-side VAD for optional revalidation or standalone CLI demos.

## Run The Python Demo Client

For a no-model protocol smoke test that still emits demo partial/final events:

```powershell
cd E:\merged_partition_content\Khoi_Project\VAIC-Hackathon\VietBridge---APT\vi-en-translator-core
$env:GATEWAY_FAKE_ENGINE="1"
python -m gateway.server
```

In a second terminal:

```powershell
cd E:\merged_partition_content\Khoi_Project\VAIC-Hackathon\VietBridge---APT\vi-en-translator-core
python demo/ws_gateway_demo_client.py --input-file data/audio_samples/sample.wav --language-hint vi
```

The WAV file must be PCM16 mono 16 kHz. The demo sends:

`session.start -> source.register -> utterance.start -> audio.chunk x N -> utterance.end -> heartbeat.ping`

## Run Real Speech-To-Text Locally

This mode loads a real faster-whisper ASR model and can also run local MT. The output event is `translation.final`; check both `final_transcript` and `translation`.

Install dependencies:

```powershell
cd E:\merged_partition_content\Khoi_Project\VAIC-Hackathon\VietBridge---APT\vi-en-translator-core
pip install -r requirements.txt
```

Optional first-run model download/smoke load:

```powershell
$env:PYTHONPATH="E:\merged_partition_content\Khoi_Project\VAIC-Hackathon\VietBridge---APT\vi-en-translator-core"
python scripts/smoke_load_asr.py --model tiny --download
python scripts/download_and_convert_models.py --mt --download
```

For a better local ASR model than `tiny`, preload `base` or `small` before switching `ASR_MODEL`:

```powershell
python scripts/download_and_convert_models.py --asr-model base --download
python eval/eval_latency.py --wav data/audio_samples/sample.wav --asr-model base --language vi
```

Start the gateway with real ASR + real MT:

```powershell
cd E:\merged_partition_content\Khoi_Project\VAIC-Hackathon\VietBridge---APT\vi-en-translator-core
$env:GATEWAY_ENABLE_ASR_ONLY="1"
$env:GATEWAY_ENABLE_MT="1"
$env:ASR_MODEL="tiny"
$env:ASR_LOCAL_FILES_ONLY="1"
$env:MT_LOCAL_FILES_ONLY="1"
$env:MT_PRELOAD="1"
$env:GATEWAY_PING_TIMEOUT="120"
python -m gateway.server
```

Wait until the terminal prints `Gateway listening on ws://0.0.0.0:8765`. With `MT_PRELOAD=1`, startup is slower but the browser does not pay the first MT model load.

Use the demo client with a real PCM16 mono 16 kHz WAV:

```powershell
python demo/ws_gateway_demo_client.py --input-file data/audio_samples/sample.wav --language-hint vi --realtime
```

If your recording is not already 16 kHz mono PCM WAV, convert it before sending:

```powershell
python demo/convert_audio.py input.m4a data/audio_samples/sample.wav
```

## Test

```powershell
cd E:\merged_partition_content\Khoi_Project\VAIC-Hackathon\VietBridge---APT\vi-en-translator-core
pytest tests/ -m "not slow"
```

## Contracts

- Input from `voice/`: `../docs/audio-streaming-contract.md`
- Output to UI: `docs/stt-mt-output-contract.md`
