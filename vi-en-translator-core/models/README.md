# Local Models

Place converted CPU INT8 model artifacts here. The gateway does not load models at import time or on startup unless `GATEWAY_ENABLE_MODELS=1` is set and model paths are configured in `config/config.yaml`.

Expected local artifacts:

- ASR: faster-whisper / CTranslate2 model directory.
- MT: NLLB CTranslate2 model directory and tokenizer files.
