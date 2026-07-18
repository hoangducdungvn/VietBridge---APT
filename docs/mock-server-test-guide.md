# Hướng dẫn test E2E trên Mock Ingestion Gateway

Tài liệu này hướng dẫn chạy và kiểm thử toàn bộ luồng **voice → gateway → STT → translation** trên máy local, không cần backend NestJS và không cần người thứ hai.

Cập nhật lần cuối: 2026-07-18 (đã chạy pass toàn bộ theo đúng các bước dưới đây).

## Kiến trúc luồng test

```
┌─────────────────────┐  WS binary/JSON   ┌──────────────────────┐  HTTP multipart  ┌────────────────────┐
│ Client              │ ────────────────► │ Mock Gateway (P4)    │ ───────────────► │ STT Service        │
│ • browser voice UI  │                   │ voice/src/mock-server│                  │ stt/ (FastAPI)     │
│ • simulate_client   │ ◄──────────────── │ ws://localhost:8081  │ ◄─────────────── │ :8001              │
└─────────────────────┘  stt.partial      └──────────┬───────────┘                  └────────────────────┘
                         stt.final                   │ sau stt.final
                         translation.final           ▼
                         stream.ack        translation/src/translator.ts
                                           (Llama-3.3-70B trên FPT)
```

## 1. Chuẩn bị (một lần)

**Yêu cầu:** Python 3.10+, Node 20+, file `.env` ở root repo chứa `FPT_API_KEY` (đã gitignore — không commit).

```powershell
# Python deps cho STT service
pip install -r stt/stt_service/requirements.txt

# Node deps cho voice (gateway + client + tsx)
cd voice
npm install
```

Kiểm tra key hoạt động (không bắt buộc nhưng nên làm — tránh debug nhầm tầng):

```powershell
cd translation
npx --prefix ..\voice tsx cli.ts "Xin chào" --from vi
# Kỳ vọng: in ra bản dịch tiếng Anh + latency. Lỗi HTTP 401 = key sai/hết hạn.
```

## 2. Bật 2 service (2 terminal riêng)

**Terminal 1 — STT service (:8001):**

```powershell
cd stt
$env:PYTHONIOENCODING = "utf-8"
python -m uvicorn stt_service.server:app --host 127.0.0.1 --port 8001
```

Chờ dòng `Uvicorn running on http://127.0.0.1:8001` rồi kiểm tra:

```powershell
curl http://127.0.0.1:8001/health
# {"status":"ok","backend":"auto","engines_initialized":[],...}
```

**Terminal 2 — Mock gateway (:8081):**

```powershell
cd voice
npm run mock-server
```

Chờ banner `VIETBRIDGE MOCK INGESTION GATEWAY / Port: 8081`. Gateway tự load `.env` từ root repo (log `[ENV] Loaded .env from ...`).

## 3. Cách test A — simulate_client (không cần mic, nhanh nhất)

Giả lập một client bắn file WAV tiếng Anh 10s thành 251 chunk 40ms như luồng thật:

```powershell
# Terminal 3
cd voice
npx tsx scripts/simulate_client.ts
```

**Kết quả kỳ vọng** (đã chạy pass 2026-07-18):

```
🎉 [stt.partial] (fpt_final |  ~1100ms) -> "Hello everyone."          ← partial đầu chậm (warmup TLS)
🎉 [stt.partial] (fpt_final |  ~400ms)  -> "Hello everyone. Welcome to"
...text lớn dần, LUÔN đúng thứ tự...
📦 [stream.ack]  (highest sequence: 251)
🏆 [stt.final]   (fpt_final |  ~580ms)  -> "Hello everyone, welcome to the Vietbridge demo. ..."
✨ Demo completed successfully!
```

Đồng thời ở **terminal gateway** phải thấy `[TRANSLATION] [Llama-3.3-70B-Instruct | ~1100ms] "Xin chào mọi người, ..."` và `→ translation.final`.

**Checklist pass/fail:**

- [ ] Partial về đúng thứ tự, text lớn dần, KHÔNG có partial nào về sau final
- [ ] Partial hiển thị `backend=fpt_final` (audio EN) — nếu thấy text kiểu "he lô e ri goăn" là routing sai
- [ ] Final là toàn văn chính xác
- [ ] Gateway log có `[TRANSLATION]` với bản dịch tiếng Việt đúng nghĩa
- [ ] `stream.ack` có `highest sequence` = tổng số chunk

## 4. Cách test B — browser UI với mic thật

```powershell
# Terminal 3
cd voice
npm run dev
```

Mở `http://localhost:5173`, sau đó:

1. Cho phép quyền microphone, chọn mic trong dropdown.
2. Chọn **Language**: `Tiếng Việt` hoặc `English` theo người nói (không còn "Auto" — xem contract §8.2).
3. WS URL để mặc định `ws://localhost:8081`, bấm **Start**.
4. Nói một câu tự nhiên, ngừng ~0.5s để VAD đóng utterance.

**Kỳ vọng trên UI:** đèn VAD chuyển IDLE→SPEAKING khi nói; khung transcript hiện partial (dòng tạm, tự thay thế) rồi final; bên dưới hiện bản dịch kèm `[Llama-3.3-70B-Instruct • XXXms]`.

**Lưu ý khi đọc partial:** với câu dài hơn 6s, partial chỉ hiển thị "cửa sổ đuôi" 6s cuối (sliding window phía STT) — phần đầu câu biến mất khỏi partial là **đúng thiết kế**, final luôn đủ toàn văn.

## 4b. Test Studio Mode + EnvironmentMonitor (browser UI)

Studio Mode = checkbox **🎙️ Studio Quality (Raw Audio)** trong Configuration — tắt AEC/NS/AGC của trình duyệt, thu raw PCM. Mặc định TẮT; chỉ bật khi dùng tai nghe trong phòng yên tĩnh. Checkbox bị khóa khi pipeline đang chạy (đổi mode = stop → start lại).

Ba kịch bản kiểm tra:

1. **Toggle TẮT, phòng thường** — hành vi y hệt trước; dòng "Trạng thái môi trường" dưới checkbox hiện 🟢/🟡/🔴 kèm noise floor (dBFS) sau ~1–5s chạy.
2. **Toggle BẬT + tai nghe, phòng yên tĩnh** — nói thầm câu bắt đầu bằng phụ âm bật hơi ("Hello", "Phương án là...") → transcript không mất chữ đầu (pre-roll 400ms); ngập ngừng giữa câu → không bị cắt đôi utterance (end-silence 600ms).
3. **Toggle BẬT + tạo tiếng ồn** (bật video đám đông/quạt sát mic) — trong ≤10s phải xuất hiện toast góc phải "Môi trường ồn... [Tắt Studio Mode]"; bấm nút → pipeline tự restart với mode mới, không crash; bấm "Bỏ qua" → toast im hẳn phiên đó. Gợi ý có cooldown 2 phút.

Ngoài ra: nếu >40% utterance gần đây trả text rỗng/low-confidence khi đang ở Studio Mode, monitor cũng gợi ý tắt (dấu hiệu VAD đang ăn tiếng người xung quanh).

## 5. Test riêng từng tầng khi cần debug

| Tầng | Lệnh | Không cần |
|---|---|---|
| Chỉ STT (file WAV) | `cd stt/stt_service; python mock_gateway.py ../tests/sample_en.wav --lang en` | gateway, browser |
| Chỉ STT (HTTP như P4 gọi) | `curl -F "file=@stt/tests/sample_en.wav" -F "utterance_id=t1" -F "language_hint=en" -F "is_final=true" http://127.0.0.1:8001/v1/transcribe` | gateway |
| Chỉ translation | `cd translation; npx --prefix ..\voice tsx cli.ts "..." --from vi` | mọi thứ khác |
| Benchmark latency STT | `cd stt/stt_service; python benchmark.py --wav ../tests/sample_en.wav` | gateway |
| Test code-switching | `cd stt; python stt_service/test_codeswitching.py` (cần gtts + ffmpeg) | gateway |

Audio mẫu có sẵn trong `stt/tests/`: `sample_en.wav` (TTS EN 10s), `sample_vi_neural.mp3` / `sample_en_neural.mp3` (giọng neural tự nhiên).

## 6. Lỗi thường gặp

| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Client báo `WebSocket error ECONNREFUSED 8081` | Gateway chưa chạy | Bật `npm run mock-server` trước |
| Gateway log `[STT ERROR] fetch failed` | STT service :8001 chưa chạy | Bật uvicorn (bước 2) |
| STT trả lỗi `FPT_API_KEY is not set` | Thiếu `.env` ở root hoặc key rỗng | Tạo `.env` với `FPT_API_KEY=sk-...` |
| Partial EN ra phonetic tiếng Việt | Routing sai — kiểm tra `language_hint` gửi lên có phải `en` không | Xem §20.4 contract; hint không phải `en` bị chuẩn hóa thành `vi` |
| Transcript final bằng tiếng Anh dù nói tiếng Việt | Model gốc không nhận được `language=vi` | Không được để hint rỗng/`auto` — đã chuẩn hóa ở cả 3 tầng, nếu vẫn gặp thì báo bug |
| HTTP 500 `Invalid response from transcription service` | Audio không phải giọng nói (nhiễu thuần) hoặc backend FPT chập chờn | Thử lại; nếu audio thật mà vẫn 500 → kiểm tra file có đúng 16kHz mono không |
| HTTP 429 | Rate limit FPT | Chờ rồi thử lại, giãn nhịp test |
| 522/timeout thất thường | Cloudflare phía FPT chập chờn | Đã có fallback fpt↔fpt_final tự động; thử lại |
| Log tiếng Việt vỡ font trong terminal | Codepage Windows | `$env:PYTHONIOENCODING = "utf-8"` (đã có trong bước 2); nội dung thật vẫn đúng |
| `npm run typecheck` fail ở `socketIoVoiceTransport.ts` | Thiếu `socket.io-client` (nhánh Socket.IO đang dở) | `npm install socket.io-client` hoặc bỏ qua — không ảnh hưởng luồng test này |

## 7. Phạm vi của mock gateway (để không hiểu nhầm)

Mock gateway hiện **có**: nhận đủ event contract v1.3, gom PCM theo utterance, gọi STT partial (tự điều tiết theo in-flight) + final, drop partial về muộn, ack sau `utterance.end`, heartbeat pong, gọi translation sau final.

Mock gateway **chưa có** (thuộc backend P4 thật): xác thực token, `server_received_at` cho overlap liên-stream (D7), resend/dedupe sau `stream.resume`, `stream.throttle`/`SERVER_BACKPRESSURE`, xử lý `continuation_id` xuyên utterance, phát kết quả cho client thứ hai (hiện chỉ echo về đúng client gửi audio).
