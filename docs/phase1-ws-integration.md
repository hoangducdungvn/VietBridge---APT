# Phase 1 — Hướng dẫn nối React UI vào đường WebSocket (mock-gateway)

> **TRẠNG THÁI: phần frontend mô tả ở mục 3 ĐÃ ĐƯỢC IMPLEMENT** (App.tsx, MeetingRoomScreen.tsx,
> env.ts — chế độ `VITE_TRANSPORT=ws`, render translation vào pane targetLang, xử lý stt.error,
> poll REST thay socket khi ở ws mode; test: `MeetingRoomScreen.wsmode.test.tsx`, suite 23/23 xanh).
> `frontend/.env.development.local` đã bật sẵn ws mode cho `npm run dev` (chỉ áp dụng dev mode —
> build production cần set `VITE_TRANSPORT=ws` lúc build). Tài liệu này giữ làm tham chiếu
> hành vi + checklist nghiệm thu; FE/BE chỉ cần chạy và tinh chỉnh UI.

**Dành cho:** team frontend + backend.
**Mục tiêu (Gate G1):** 2 laptop cùng LAN, mở React app, cùng session — nói tiếng Việt ở máy A → máy B thấy transcript VI **và bản dịch EN**; ngược lại với máy B nói tiếng Anh.
**Phạm vi:** chỉ nối dây — toàn bộ hạ tầng (gateway fan-out, STT, translation, VAD, module `voice/`) đã chạy và đã test E2E xanh. NestJS **không cần thêm gì** cho G1 (lobby REST giữ nguyên vai trò tạo/join session).

## 1. Luồng dữ liệu

```
React (2 máy) ──VoicePipeline (raw WS)──► mock-gateway :8081
                                             │  fan-out theo session_id → CẢ 2 client
                                             ├──► STT service :8001 (/ws, turn protocol)
                                             └──► Translation (Llama-3.3-70B, in-process)
React ◄── stt.partial / stt.final / translation.final / stt.error ── gateway
```

Điểm mấu chốt: `VoicePipeline` (package `vietbridge-voice`) đã tự lo **toàn bộ** capture → VAD → utterance → gửi audio → nhận kết quả. Frontend chỉ cần: (a) tạo pipeline đúng config, (b) render 3 loại event trả về.

## 2. Chạy hệ thống (backend laptop)

```bash
# Terminal 1 — STT service (LƯU Ý: stt-service/ cũ đã bị xoá, chỉ còn bản này)
cd stt
python -m uvicorn stt_service.server:app --port 8001 --host 0.0.0.0

# Terminal 2 — mock gateway
cd voice
npm run mock-server        # ws://<ip-laptop>:8081
```

Env cần có ở root `.env`: `FPT_API_KEY` (STT + translation dùng chung). Tuỳ chọn: `PARTIAL_CADENCE_MS` (mặc định 1000), `MOCK_GATEWAY_PORT`, `STT_WS_URL`.
Windows Firewall: mở inbound port **8081** (và 8001 nếu STT chạy máy khác) để máy thứ hai kết nối được qua LAN.

## 3. Việc của frontend

### 3.1. Env + flag

Thêm vào `frontend` env (`.env.local`):

```
VITE_TRANSPORT=ws
VITE_MOCK_GATEWAY_URL=ws://<ip-laptop-backend>:8081
```

Khi `VITE_TRANSPORT=ws`: **bỏ gate `roomSocket?.connected`** trong `MeetingRoomScreen.startMicrophone()` (gate này trỏ vào NestJS realtime — hiện là stub rỗng nên mic không bao giờ bật được), và **không truyền `transportFactory`** khi tạo `VoicePipeline` — bỏ trống là pipeline tự dùng raw-WS client trỏ vào `gatewayUrl`. Giữ nguyên nhánh Socket.IO cũ sau flag để bật lại khi NestJS realtime xong.

### 3.2. Tạo pipeline

```ts
const pipeline = new VoicePipeline(
  {
    gatewayUrl: env.mockGatewayUrl,                 // VITE_MOCK_GATEWAY_URL
    sessionId: activeSession.sessionId,             // ⚠️ BẮT BUỘC — xem lưu ý dưới
    participantId: activeSession.participantId,
    speakerId: activeSession.participantId,
    languageHint: activeSession.sourceLanguage,     // 'vi' | 'en'
    enableSileroVad: true,                          // thiếu model → tự fallback energy VAD
    // KHÔNG truyền transportFactory trong chế độ ws
  },
  { onSttResult, onTranslationResult, onSttError, onVadStateChange, onError },
);
await pipeline.start();
```

**⚠️ `sessionId` phải GIỐNG NHAU trên cả 2 máy** (lấy từ lobby REST — `activeSession.sessionId`). Gateway fan-out kết quả theo `session_id`; hai client khác session sẽ không thấy kết quả của nhau. Đây là lỗi dễ dính nhất khi nối.

Silero VAD cần asset tĩnh: copy `voice/public/models/silero_vad.onnx` → `frontend/public/models/` và `voice/public/ort-wasm/` → `frontend/public/ort-wasm/` (worklet `pcm-processor.js` đã có sẵn trong `frontend/public/worklet/`). Thiếu asset thì pipeline tự log "Silero unavailable" và chạy energy VAD — vẫn hoạt động.

### 3.3. Ba event cần render

Cả hai client nhận kết quả của **cả 2 người nói** (fan-out) — luôn route theo `speakerId`, đừng giả định kết quả là của mình.

**`onSttResult(res)`** — transcript:

| Field | Ý nghĩa |
|---|---|
| `type` | `'partial'` (đang nói, sẽ bị thay) / `'final'` (chốt) |
| `text`, `language` | nội dung + ngôn ngữ ( `'vi'`/`'en'` ) |
| `utteranceId` | key để thay partial→final đúng bubble |
| `speakerId`, `sourceId` | ai nói — so với `participantId` của mình để biết own/other |
| `lowConfidence` | true = text đáng ngờ (hallucination bị chặn / ASR lỗi) — style mờ |

Render: partial → thanh live-caption của pane ngôn ngữ tương ứng (kiểu tentative, cập nhật tại chỗ theo `utteranceId`); final → chốt thành bubble trong transcript, xoá live-caption.

**`onTranslationResult(res)`** — bản dịch, chỉ có sau final:

| Field | Ý nghĩa |
|---|---|
| `translatedText`, `targetLang` | bản dịch + ngôn ngữ đích |
| `sourceText`, `sourceLang` | câu gốc |
| `utteranceId`, `speakerId` | khớp với stt.final trước đó |

Render: đưa vào **pane của `targetLang`** (A nói VI → bản dịch EN nằm ở pane EN, nơi người đọc tiếng Anh đang nhìn), gắn nhãn người nói từ `speakerId`. Có thể hiển thị kèm dưới bubble gốc nếu design muốn.

**`onSttError(evt)`** — STT chết giữa utterance (`evt.utteranceId` có thể null): **xoá live-caption đang treo** của utterance đó + toast nhẹ. Không có event này thì caption partial sẽ treo vĩnh viễn khi backend STT lỗi.

### 3.4. Chi tiết UX đã có sẵn tín hiệu

- `onVadStateChange(state)` — `'SPEAKING'/'POSSIBLE_END'` → chấm "đang nói" (đã dùng sẵn trong MeetingRoomScreen).
- `onConnectionStateChange` — hiện trạng thái reconnecting (wsClient tự reconnect + resume).
- End-of-turn giờ là **tiered** (600ms chuẩn, ~1100ms khi câu chưa dứt, ~480ms khi có dấu kết câu) — bản dịch xuất hiện nhanh hơn cấu hình 2500ms cũ đáng kể; không cần làm gì thêm ở UI.

## 4. Wire protocol (tham chiếu — chỉ cần khi debug)

Client không cần tự parse (đã có `VoiceStreamClient`), nhưng payload server → client dạng:

```jsonc
{ "type": "stt.partial|stt.final", "session_id": "...", "source_id": "mic-...",
  "speaker_id": "...", "utterance_id": "utt-...", "text": "...", "language": "vi",
  "backend": "fpt_final", "asr_latency_ms": 250, "low_confidence": false, "eou": {...} }

{ "type": "translation.final", "utterance_id": "...", "speaker_id": "...",
  "source_text": "...", "translated_text": "...", "source_lang": "vi",
  "target_lang": "en", "model": "Llama-3.3-70B-Instruct", "translation_latency_ms": 1200 }

{ "type": "stt.error", "utterance_id": "utt-... | null", "message": "..." }
```

## 5. Checklist nghiệm thu G1

1. `cd voice && npx tsx scripts/simulate_client.ts` xanh (hạ tầng OK, không cần mic).
2. Hai tab browser cùng máy, cùng `sessionId` → tab này nói (hoặc phát audio), tab kia thấy transcript + bản dịch.
3. Lặp lại trên 2 laptop qua LAN (đổi `VITE_MOCK_GATEWAY_URL` sang IP thật, check firewall).
4. Tắt STT service giữa chừng rồi bật lại → gateway tự reconnect + replay, utterance đang nói không mất; UI nhận `stt.error`/kết quả tiếp tục bình thường.
5. Nói một câu có ngắt nghỉ giữa chừng ("hôm nay chúng ta sẽ bàn về… doanh thu") → câu không bị cắt đôi (tiered end-silence).

Có vướng gì về hành vi của `VoicePipeline`/gateway/STT thì hỏi bên voice — đừng sửa trực tiếp vào `voice/src` hay `stt/`.
