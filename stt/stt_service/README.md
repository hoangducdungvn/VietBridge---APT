# stt_service — STT module (VietBridge)

Nhận audio đã VAD-cut từ ingestion gateway, trả text. Hai backend hoán đổi qua config:
FPT Cloud API (`FPT.AI-whisper-large-v3-turbo`) và Groq Cloud API (`whisper-large-v3-turbo`).

## Setup

```bash
pip install -r stt/stt_service/requirements.txt
```

Toàn bộ code STT nằm trong `stt/` (cùng cấp với `frontend/`, `backend/`, `voice/`):
`stt/stt_service/` (package Python), `stt/tests/` (audio mẫu), `stt/results/` (kết quả benchmark/test).

Set API key (chỉ đọc từ env, **không bao giờ** hardcode/commit/log):

```powershell
# PowerShell
$env:FPT_API_KEY = "sk-..."
```

```bash
# bash
export FPT_API_KEY="sk-..."
```

> ⚠️ Key nào đã từng dán vào chat/ảnh chụp màn hình thì coi như đã lộ — revoke và tạo key mới trên FPT Cloud trước khi demo.

Sửa `BACKEND` trong [config.py](config.py) — `"fpt"`, `"groq"` hoặc `"auto"` — hoặc set env `STT_BACKEND=groq`. Không cần sửa chỗ nào khác.

## Chạy benchmark

```bash
cd stt/stt_service
python benchmark.py                      # audio tổng hợp: latency thật, text rác
python benchmark.py --wav ../tests/sample_en.wav   # audio thật (16 kHz mono)
```

In bảng mean/p95 cho audio 3s/10s/25s, chế độ partial (timeout 5s) và final (timeout 10s), tách riêng network round-trip với backend FPT, kèm kết luận nhịp partial 1s có khả thi không.

## Chạy mock gateway

```bash
cd stt/stt_service
python mock_gateway.py ../tests/sample_en.wav        # partial mỗi 1s audio, rồi final
python mock_gateway.py ../tests/sample_en.wav --use-queue --realtime
python mock_gateway.py --synth 5                     # không có WAV: smoke test
```

## Interface đã chốt với team

```python
from stt_service import transcribe

result = transcribe(utterance_id, audio, language_hint, is_final)
# audio: np.float32 mono 16 kHz trong [-1,1] — TOÀN BỘ audio tích lũy của utterance
# -> {utterance_id, type: "partial"|"final", text, language,
#     asr_latency_ms, low_confidence, eou}
#    + continuation_id (nếu truyền vào, forward nguyên vẹn)
#    + network_ms (backend fpt), + error {code, message, status} khi API lỗi
```

- Audio im lặng/năng lượng quá thấp → text rỗng, không gọi API (guard hallucination).
- `eou` là metadata End Of Utterance phía STT (`is_endpoint`, `reason`, `speech_ms`,
  `trailing_silence_ms`, `duration_ms`). Client VAD vẫn là nguồn EOU chính; field này là
  tín hiệu dự phòng/advisory cho backend hoặc gateway.
- `language_hint` là prior; chỉ bị override khi backend detect ngôn ngữ khác với confidence ≥ 0.8 (hiện chỉ backend Groq báo confidence).
- Lỗi API (timeout/4xx/5xx/rate-limit) trả về trong `error`, worker không crash.

Xử lý tuần tự dùng `queue_worker.STTQueueWorker`: FIFO đúng thứ tự submit; final của một `utterance_id` vào hàng sẽ hủy các partial cùng id còn chờ.

## API FPT Cloud (đã xác minh bằng call thật, 2026-07-17)

`POST https://mkp-api.fptcloud.com/v1/audio/transcriptions` — multipart form
(`model`, `file`, `language`, `response_format`), header `Authorization: Bearer $FPT_API_KEY`.
Nguồn: https://github.com/fpt-corp/ai-marketplace

Hành vi thực tế đã đo:

- Response `json`: `{"text": ..., "usage": {"input_duration", "output_tokens"}}`.
  `verbose_json` **không được hỗ trợ** (trả 503) → không có confidence per-segment,
  `low_confidence` với backend fpt hiện luôn `False` trừ khi lỗi.
- Tham số `language` **bị model bỏ qua**: giọng tiếng Anh bị phiên âm thành phonetic
  tiếng Việt ("hello everyone" → "he lô e ri goăn"). Model này coi như VI-only —
  ⚠️ luồng EN→VI cần engine khác (sử dụng Groq). Backend đã cấu hình sẵn tính năng tự động định tuyến thông minh nếu để chế độ `auto`. Cần bàn với team.
- Audio nhiễu/không phải giọng nói → server trả 500; audio im lặng đã bị guard
  chặn trước khi gọi API.

## Kết quả benchmark (mạng thực tế, 2026-07-17)

| audio | mode | mean | p95 | ghi chú |
|---|---|---|---|---|
| 3s | partial | 1761ms | 2819ms | gần như toàn bộ là network |
| 10s | partial | 883ms | 1029ms | |
| 25s | partial | 1741ms | 2882ms | |
| 25s | final | 1497ms | 2102ms | |

Kết luận: **nhịp partial 1s KHÔNG khả thi** (p95 xấu nhất ~2.9s, jitter mạng lớn).
Khuyến nghị: giãn nhịp partial lên **2s** và/hoặc chỉ re-decode ~15s audio cuối.

## Chạy service & turn-protocol WebSocket (`/ws`)

Đây là service STT **duy nhất** (thư mục `stt-service/` cũ đã được hợp nhất vào đây).

```bash
cd stt
python -m uvicorn stt_service.server:app --port 8001 --host 127.0.0.1
```

Endpoint cho Node gateway (`voice/src/mock-server/server.ts`, env `STT_WS_URL`,
mặc định `ws://localhost:8001/ws`):

- Client → server: JSON `{"type":"start_turn","turnId","language","cadence_ms"}` /
  `{"type":"finish_turn","turnId"}`; binary = raw PCM_S16LE 16kHz mono.
- Server → client: `stt.partial` (theo `cadence_ms`, mặc định từ `PARTIAL_CADENCE_MS`
  bên gateway), `stt.final`, `stt.error` — kèm `low_confidence` và `eou` metadata.
- Gateway tự reconnect + replay toàn bộ turn khi socket đứt — service luôn có thể
  coi socket mới là trạng thái sạch.

Endpoint HTTP `/v1/transcribe` (multipart) vẫn giữ nguyên cho `benchmark.py` và tooling cũ.
