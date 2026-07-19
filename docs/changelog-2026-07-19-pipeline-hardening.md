# Changelog 2026-07-19 — Chốt kiến trúc, sửa lỗi pipeline, benchmark

Tài liệu tổng hợp toàn bộ thay đổi trong đợt làm việc 18-19/07/2026: quyết định kiến trúc, các bug đã tìm ra + sửa (kèm bằng chứng), số liệu benchmark, và trạng thái hiện tại. **Chưa commit** — toàn bộ nằm trong working tree.

---

## 1. Quyết định kiến trúc (đã chốt)

**Chọn hybrid: LiveKit CHỈ làm tầng transport, KHÔNG dùng Pipecat.** Pipeline nghiệp vụ (VAD/UtteranceManager/FPT STT/translation) giữ nguyên code hiện có; khi làm Phase 2, VAD + segmentation chuyển về server-side (tái dùng nguyên class vì là pure logic). Chi tiết + lộ trình: xem plan đã duyệt và `docs/phase1-ws-integration.md`.

Các phương án bị loại (kèm lý do, không mở lại nếu không có dữ liệu mới):
| Phương án | Lý do loại |
|---|---|
| Pipecat + VAD fake-stream | Phải rewrite ~900 dòng TS đã tinh chỉnh sang Python; `SegmentedSTTService` không emit gì tới hết utterance (mất partials); không giải quyết transport |
| Deepgram streaming | Benchmark nhóm: 6.7s + false finalization cho tiếng Việt vs FPT 784ms |
| VAD-chunked STT calls | Benchmark nhóm: overhead cố định ~450-500ms/call FPT |
| Pyannote | Sai bài toán (diarization ≠ crosstalk 2 mic); thay bằng cross-mic RMS gating (Phase 3) |
| LiveKit EOU turn-detector | **Đã verify docs chính thức: KHÔNG hỗ trợ tiếng Việt** → bỏ hẳn |

Facts đã verify cho Phase 2 (LiveKit): `@livekit/rtc-node` `AudioStream` nhận `{sampleRate:16000, numChannels:1, frameSizeMs:20}` (khớp input VadEngine); Opus DTX+RED bật mặc định cho mono; có binary win32-x64 (`@livekit/rtc-node-win32-x64-msvc` — pin version); free tier 5000 participant-min/tháng.

---

## 2. Bug đã tìm ra và sửa (tất cả có bằng chứng tái hiện trước khi sửa)

### 2.1. Gateway ↔ STT WebSocket

| Triệu chứng | Nguyên nhân | Fix | File |
|---|---|---|---|
| Utterance mất trắng, không error (final rỗng tức thì) | Race: `utterance.start` đến khi socket gateway→STT chưa OPEN → `start_turn` bị drop lặng lẽ, Python vứt toàn bộ audio | `connectSttWs()`: reconnect backoff 500ms→5s + **replay toàn bộ turn** (`start_turn` + audio đã buffer + `finish_turn`) mỗi khi socket mở lại. `pcmChunks` giờ là replay buffer chính danh | `voice/src/mock-server/server.ts` |
| STT service restart giữa phiên → client câm vĩnh viễn | Không có reconnect | Như trên (cùng cơ chế replay) | như trên |
| UI treo partial khi STT lỗi giữa câu | `stt.error` chỉ log ở gateway, không tới client | Broadcast `stt.error` + event `onSttError` xuyên suốt wsClient → VoicePipeline → UI (xoá live caption treo) | server.ts, `wsClient.ts`, `voicePipeline.ts`, `main.ts`, MeetingRoomScreen |
| `low_confidence`/`eou` luôn `false` | Hardcode ở gateway; Python không forward | Forward thật từ STT response ở cả 2 tầng | server.ts, `stt/stt_service/server.py` |
| Traceback "send after close" + disconnect spam | send_json đua với client disconnect; raw `receive()` không raise WebSocketDisconnect | `send_safe()` helper; xử lý message `websocket.disconnect`; guard double-close | `stt/stt_service/server.py` |

### 2.2. STT / hallucination filter

| Triệu chứng | Nguyên nhân | Fix | File |
|---|---|---|---|
| Câu lặp hợp lệ (≥4 câu trùng) bị xoá trắng final → mất luôn bản dịch | Filter chống lặp (signal 4) không phân biệt người nói lặp thật vs Whisper loop trên noise | Gate theo **speech-ratio** (từ EOU frame stats): chỉ blank khi audio phần lớn là non-speech (<50%) | `stt/stt_service/service.py` |
| — | `"..."` nằm trong blocklist substring → blank cả câu thật chứa dấu ba chấm | Chuyển `"..."`/`". . ."` sang exact-match | như trên |
| Turn kẹt mở đốt 1-2 call FPT/giây toàn kết quả rỗng | Mic nhiễu giữ turn mở, partial loop cứ 700ms gọi API | Backoff: 3 partial rỗng liên tiếp → nhịp ×2, 6 → ×4; có chữ là reset | `stt/stt_service/server.py` |
| **Đính chính**: lo ngại "Whisper 30s limit" | — | Đã đo: FPT xử lý 42s audio tốt (full text, 544ms) — không phải hard-fail | — |

### 2.3. VAD (nguyên nhân chính của "câu dài bị lỗi")

| Triệu chứng | Nguyên nhân | Fix | File |
|---|---|---|---|
| Bản dịch trễ ~5-7s sau khi ngừng nói | Đợt refactor trước đặt `endSilenceMs: 2500` (Studio 3500), `maxUtteranceMs: Infinity` — cộng cứng 2.5s vào MỌI câu | Revert 600ms/0.28/20s + **tiered endSilencePolicy**: 600ms mặc định, ~1100ms khi đuôi partial là từ nối/đang liệt kê ("và", "nhưng", "1, 2, 3,"), ~480ms khi có dấu kết câu | `voice/src/vad/vadEngine.ts`, `voice/src/vad/endSilencePolicy.ts` (mới), `voicePipeline.ts` |
| Utterance treo tới trần 20s (`reason=max_duration`, không bao giờ `vad_silence`) dù đã ngừng nói | **Deadlock noise-floor**: floor chỉ học khi IDLE/POSSIBLE_END, đóng băng suốt SPEAKING; để đóng câu cần frame < floor−1.2dB → nền ồn tăng sau khi học floor (AGC/quạt/loa) thì không bao giờ đóng | **Recovery latch**: frame lặng nhất 2s gần đây > floor+8dB → latch target gần mức nền thật, nâng floor ~4dB/s tới khi đóng câu được. Phiên floor đúng không bị ảnh hưởng | `voice/src/vad/vadEngine.ts` |
| Log ghi `vad_engine=energy-vad` bất kể Silero có chạy hay không | Hardcode trong UtteranceManager | Callback `vadEngineName` → log ghi backend THẬT (dùng để xác minh Silero load) | `utteranceManager.ts`, `voicePipeline.ts` |

### 2.4. Translation

| Triệu chứng | Nguyên nhân | Fix | File |
|---|---|---|---|
| `[[VB_VALUE_1]]` lọt vào bản dịch của câu không có số | System prompt luôn lệnh "copy marker" → LLM bịa marker | Chỉ nhắc marker khi có giá trị được bảo vệ; restore lọc sạch marker lạ | `translation/src/prompts.ts`, `criticalTokens.ts` |
| Dịch "1..10" bị cụt ở "8," | `maxTokens = max(48, từ×3)` không tính mỗi marker ngốn ~8-10 token | `maxTokens = min(400, max(48, từ×3 + marker×10))` | `translation/src/translator.ts` |

Smoke test live (giữ tại `voice/scripts/translate_smoke.ts`): 3/3 pass.

### 2.5. Debug UI (`voice/`)

- Final rỗng không còn tạo bubble trống treo "Translating..." vĩnh viễn (chỉ log `∅ Final rỗng`).
- Ô live-partial theo **từng utterance** (`live-partial-<id>`) — fan-out 2 người không đè caption nhau.
- Các tab mặc định chung session `ses-debug-room` (override `?session=xyz`) để test fan-out 1 máy.

---

## 3. Hợp nhất STT service

- **`stt-service/` (fork) đã XOÁ.** Nguồn duy nhất: `stt/stt_service/` (giữ benchmark.py, tests, HTTP endpoint, README).
- Endpoint `/ws` turn-protocol (start_turn/audio/finish_turn) thêm vào `stt/stt_service/server.py` — gateway không đổi gì (`STT_WS_URL` mặc định `ws://localhost:8001/ws`).
- Merge ngược từ fork: 2 entry blocklist mới; `_SHORT_HALLUCINATIONS` KHÔNG mang theo (code chết + chứa "hello."/"xin chào" sẽ blank câu chào hợp lệ).
- `requirements.txt`: `uvicorn[standard]` (cần websockets).

## 4. Phase 1 React (đã implement, không chỉ tài liệu)

- `VITE_TRANSPORT=ws` (bật sẵn trong `frontend/.env.development.local`, chỉ áp dụng `npm run dev`): mic không cần NestJS realtime; kết quả + **bản dịch render vào pane của targetLang** với tag "Translated"; `stt.error` dọn caption treo; App poll REST 2.5s thay socket.
- Assets Silero đã copy vào `frontend/public/` (models + ort-wasm).
- Test: suite 23/23 xanh (3 test ws-mode mới trong `MeetingRoomScreen.wsmode.test.tsx`); build production xanh. `vitest.config.ts` ép `VITE_TRANSPORT=socketio` cho test để `.env*.local` không lây vào suite.

## 5. Benchmark (script `voice/scripts/measure_e2e.ts`, realtime pacing, 3 file × 3 runs)

| Chặng (median) | Kết quả |
|---|---|
| Bắt đầu nói → caption đầu | **~0.85-0.9s** (sau khi hạ `PARTIAL_CADENCE_MS` 1000→**700** trong `.env`; A/B: nhanh hơn ~0.3s, +50% call FPT partial, không dồn request) |
| Ngừng nói → transcript final | ~0.8-1.5s (VAD tiered 0.48-1.1s + FPT final ~0.3-0.4s) |
| Ngừng nói → **bản dịch** | **~1.6-2.5s** (mục tiêu plan 1.9-3.3s — đạt) |
| FPT partial ASR | ~220-420ms/call · Final ~330-390ms · LLM dịch 0.7-1.05s |

Lưu ý: FPT nhanh bất thường so với benchmark cũ (p95 2.9s trong README stt) — **chạy lại `measure_e2e.ts` tại venue trước demo**. Run đầu tiên luôn chậm (TLS warm-up) → runbook cần 1 call warm-up.

Scripts đo/chẩn đoán mới (đều trong `voice/scripts/`): `measure_e2e.ts`, `stress_long_utterance.ts` (test race + utterance dài), `translate_smoke.ts`, `test_end_silence_policy.ts` (27 assertions).

## 6. Trạng thái & việc còn lại

| Việc | Trạng thái |
|---|---|
| Baseline WS demo-complete (G1) | ✅ Code xong — còn cần test tay 2 laptop qua LAN |
| VAD với mic thật/nhiễu | 🔶 Fix deadlock đã vào, **cần verify lần chạy tới**: log phải có `reason=vad_silence` + `vad_engine=` thật (nếu ra `energy-vad` → Silero không load, cần điều tra) |
| Phase 2 LiveKit | ⏳ Chờ user tạo LiveKit Cloud project (`LIVEKIT_URL`/`API_KEY`/`API_SECRET` vào `.env`) |
| Phase 3 (tentative translation, cross-mic arbiter, merge-repair) | ⏳ Theo plan, flag-gated |
| Nối `continuation_id` xuống gateway→STT (khâu các mảnh max_duration) | ⏳ Chưa làm — cần khi muốn xử lý nói liên tục >20s tử tế |
| "20 tỷ VND" giữ nguyên "tỷ" trong bản dịch EN | ⏳ Trade-off đã biết của criticalTokens (bảo toàn số > tự nhiên); có thể map triệu→million/tỷ→billion ở bước restore |
| `translation-service/` (Python, không ai gọi) | ⏳ Đề nghị xoá hoặc đánh dấu thí nghiệm — chưa đụng |
