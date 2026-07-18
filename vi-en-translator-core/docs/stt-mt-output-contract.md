# STT/MT Output Contract

Owner: `vi-en-translator-core` / STT-MT team.

This document defines gateway-to-client events sent back over the same WebSocket. It intentionally does not modify `../docs/audio-streaming-contract.md`, whose scope is client-to-gateway input.

## Shared envelope

All output events use the same protocol version and identity fields as the input contract:

```json
{
  "protocol_version": "1.3",
  "type": "event.name",
  "session_id": "meeting-001",
  "stream_id": "stream-speaker-a",
  "utterance_id": "utt-a-0001",
  "sent_at": "2026-07-17T09:15:36.123Z"
}
```

## `stt.partial`

Sent while an utterance is open. The gateway periodically re-decodes all audio accumulated for the utterance with ASR `beam_size=1`. Translation is not run for partials.

```json
{
  "protocol_version": "1.3",
  "type": "stt.partial",
  "session_id": "meeting-001",
  "stream_id": "stream-speaker-a",
  "utterance_id": "utt-a-0001",
  "sent_at": "2026-07-17T09:15:36.123Z",
  "partial_transcript": "xin chao",
  "confidence": 0.82
}
```

Required fields:

- `partial_transcript`: current ASR hypothesis.
- `confidence`: normalized `0.0..1.0` confidence estimate.

## `translation.final`

Sent once after `utterance.end`. It combines final ASR and final MT because translation runs only after the final transcript is available.

```json
{
  "protocol_version": "1.3",
  "type": "translation.final",
  "session_id": "meeting-001",
  "stream_id": "stream-speaker-a",
  "utterance_id": "utt-a-0001",
  "sent_at": "2026-07-17T09:15:42.123Z",
  "final_transcript": "xin chao moi nguoi",
  "translation": "hello everyone",
  "confidence": 0.91,
  "low_confidence": false,
  "latency_ms": {
    "asr_final": 420.0,
    "mt": 210.0,
    "total_since_utterance_end": 630.0
  }
}
```

Required fields:

- `final_transcript`: final utterance transcript.
- `translation`: final translation string.
- `confidence`: normalized `0.0..1.0` ASR confidence estimate.
- `low_confidence`: `true` when confidence or quality signals indicate risk.
- `latency_ms.asr_final`, `latency_ms.mt`, `latency_ms.total_since_utterance_end`: latency telemetry for D18 budget tracking.

## Deviations

- None known for the client-to-gateway contract. The implementation validates `protocol_version == "1.3"`, the binary frame layout, required `audio.chunk` MVP fields, PCM `pcm_s16le` 16 kHz mono, and cumulative ACK after `utterance.end`.
- Output events are intentionally outside `audio-streaming-contract.md` scope and are documented here as the STT/MT-owned extension.
- In local ASR mode (`GATEWAY_ENABLE_ASR_ONLY=1`), MT is enabled only when `GATEWAY_ENABLE_MT=1`. If that flag is absent, `translation.final.translation` is intentionally empty and `final_transcript` still comes from the real ASR model.
- The local Hugging Face MT backend (`TransformersTranslator`) does not support true decoder-level constrained terminology forcing. It applies matched glossary pairs by pre-replacing source terms with target terms before MT and post-checking that target terms remain visible in the final translation. This is deterministic and testable, but weaker than beam-level constrained decoding.
