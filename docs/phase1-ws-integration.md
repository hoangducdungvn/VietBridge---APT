# Phase 1 — Bàn giao: chạy & tích hợp luồng WebSocket (mock-gateway)

> **Cập nhật 2026-07-19.** Phần frontend React ĐÃ ĐƯỢC IMPLEMENT (không còn là việc phải làm).
> Toàn bộ bug tìm được trong các phiên test 18-19/07 đã sửa — chi tiết từng lỗi xem
> `docs/changelog-2026-07-19-pipeline-hardening.md`. Tài liệu này là bản bàn giao vận hành:
> chạy thế nào, hành vi ra sao, nghiệm thu gì, lỗi thường gặp xử lý ra sao.

## 1. Kiến trúc đang chạy

```
Browser (debug UI voice/ HOẶC React frontend/, chế độ ws)
  VoicePipeline: mic → VAD (Silero, fallback energy) → UtteranceManager → raw WS
        ▼
mock-gateway :8081 (voice/src/mock-server/server.ts)
  • fan-out kết quả theo session_id → MỌI client trong session
  • WS bền tới STT (:8001/ws): tự reconnect + REPLAY nguyên turn khi đứt
        ▼
stt/stt_service :8001  (⚠ stt-service/ cũ đã xoá — chỉ còn service này)
  • /ws turn-protocol: buffer audio, partial theo cadence, final khi finish_turn
  • preprocessing + hallucination filter (speech-ratio gated) + EOU metadata
        ▼
translation/ (in-process trong gateway): Llama-3.3-70B, criticalTokens bảo vệ số liệu
```

Kết quả về client: `stt.partial` → `stt.final` → `translation.final` (+ `stt.error` khi STT chết giữa câu). Tất cả kèm `source_id`/`speaker_id` để phân người nói.

## 2. Chạy hệ thống

```bash
# Terminal 1 — STT
cd stt
python -m uvicorn stt_service.server:app --port 8001 --host 0.0.0.0

# Terminal 2 — gateway
cd voice && npm run mock-server          # ws://<ip>:8081

# Terminal 3 — UI, chọn MỘT trong hai:
cd voice && npm run dev                  # debug UI (không cần NestJS)
# hoặc React đầy đủ (cần thêm NestJS REST cho lobby):
cd backend && npm run start:dev
cd frontend && npm run dev               # ws mode bật sẵn qua .env.development.local
```

Env ở root `.env`: `FPT_API_KEY` (bắt buộc), `PARTIAL_CADENCE_MS=700` (đã chốt sau A/B — đổi về 1000 nếu cần tiết kiệm quota FPT), `STT_WS_URL`, `MOCK_GATEWAY_PORT`.
Frontend: `frontend/.env.development.local` có `VITE_TRANSPORT=ws` (+ `VITE_MOCK_GATEWAY_URL` nếu gateway không cùng máy). **Chỉ áp dụng `npm run dev`** — build production phải set biến lúc build. Test suite luôn chạy socketio mode (ép trong `vitest.config.ts`).
LAN 2 máy: mở firewall inbound 8081 (và 3000, 5173 nếu cần), client trỏ IP thật.

## 3. Hành vi cần biết khi vận hành

- **Fan-out theo `sessionId`**: 2 client phải CÙNG session mới thấy nhau. React lấy từ lobby REST (tự đúng). Debug UI: các tab mặc định chung `ses-debug-room`, tách phòng bằng `?session=xyz`.
- **Kết quả của cả 2 người đổ về mọi client** — UI route theo `speakerId` (React đã làm; code tự viết phải làm theo).
- **End-of-turn phân tầng** (không còn flat): 600ms mặc định; ~1100ms khi câu chưa dứt (đuôi là từ nối hoặc đang liệt kê "1, 2, 3,"); ~480ms khi có dấu kết câu. Trần utterance 20s — nói liên tục quá 20s sẽ bị tách turn (nối mảnh là việc Phase 3).
- **Final rỗng là bình thường** (im lặng/hallucination bị chặn/sai hint ngôn ngữ) — client bỏ qua, không render, không có translation.
- **STT restart giữa phiên không mất câu**: gateway tự reconnect + replay. Client chỉ cần xử lý `stt.error` (xoá caption treo) — đã có sẵn ở cả 2 UI.
- Số liệu hiện tại (đo bằng `voice/scripts/measure_e2e.ts`): caption đầu ~0.85-0.9s từ lúc bắt đầu nói; bản dịch ~1.6-2.5s sau khi ngừng nói. Chạy lại script này tại venue để có số thật theo mạng.

## 4. Sự kiện cho code tích hợp (qua `VoicePipeline` events)

| Event | Field chính | UI phải làm |
|---|---|---|
| `onSttResult` type=`partial` | `text`, `language`, `utteranceId`, `speakerId` | Live caption (tentative), update tại chỗ theo `utteranceId` |
| `onSttResult` type=`final` | + `lowConfidence` | Chốt bubble, xoá caption; **text rỗng → bỏ qua** |
| `onTranslationResult` | `translatedText`, `targetLang`, `sourceText`, `speakerId` | Render vào **pane của `targetLang`** |
| `onSttError` | `utteranceId \| null`, `message` | Xoá caption treo của utterance đó (null = tất cả) |
| `onVadStateChange` / `onConnectionStateChange` | — | Chấm "đang nói" / trạng thái kết nối header |

## 5. Checklist nghiệm thu G1

1. `cd voice && npx tsx scripts/simulate_client.ts` xanh (không cần mic).
2. Debug UI 2 tab cùng máy: nói ở tab A → transcript + bản dịch hiện **cả 2 tab**; log gateway có `[BROADCAST] ... → 2 clients`.
3. React 2 máy qua LAN, cùng room code: nói tiếng Việt máy A → máy B thấy transcript VI + bản dịch EN đúng pane.
4. Kill stt-service giữa lúc nói rồi bật lại → câu không mất (log gateway có `replayed ... turn`).
5. Câu 10-15s có ngắt nghỉ tự nhiên → log `utterance.end` có `reason=vad_silence` (KHÔNG phải toàn `max_duration`).
6. `npx tsx scripts/measure_e2e.ts 3` → ngừng-nói→dịch median < 2.5s.

## 6. Lỗi thường gặp (đúc kết từ các phiên test thật)

| Triệu chứng | Nguyên nhân | Xử lý |
|---|---|---|
| Caption đôi / transcript rác xen kẽ khi test 1 máy 2 tab | Cả 2 tab cùng nghe 1 mic; tab sai hint ngôn ngữ decode ra rác | Test chất lượng thì chạy 1 tab; test fan-out thì chấp nhận, hoặc 2 tab chọn 2 mic khác nhau |
| Utterance ôm mãi không chốt, toàn `reason=max_duration` | Nền ồn cao / floor VAD thối (đã có recovery tự động ~vài giây), hoặc nguồn âm là video phát liên tục (không có khoảng lặng → đúng thiết kế) | Nói giọng thật mic gần; kiểm tra dòng `vad_engine=` trong log — nếu là `energy-vad` tức Silero không load, báo team voice |
| Studio Quality khi nào bật? | Tắt lọc ồn trình duyệt | CHỈ bật với tai nghe + phòng yên tĩnh. Mic laptop trần → bỏ tick |
| Bản dịch chậm bất thường ở câu ĐẦU sau khi khởi động | TLS/connection warm-up FPT | Trước demo: nói 1 câu bỏ đi (warm-up) |
| Số/ngày/tiền trong bản dịch | Được bảo vệ nguyên xi (criticalTokens); từ đơn vị tiếng Việt ("tỷ") hiện giữ nguyên trong bản EN | Hành vi chủ ý (ưu tiên đúng số liệu); muốn dịch đơn vị thì sửa bước restore |
| Tên riêng bị nghe sai ("Đoàn"→"Loạn") | Giới hạn STT với proper noun | Có thể thêm tên người tham gia vào glossary prompt dịch; STT gốc vẫn có thể sai |
| 2 tab debug không thấy nhau | Khác session | Cùng để mặc định hoặc cùng `?session=` |

## 7. Việc tiếp theo (ngoài phạm vi bàn giao này)

Phase 2 LiveKit transport (cần LiveKit Cloud keys trong `.env`; spikes S1-S4 theo plan) → Phase 3 chất lượng (tentative translation, cross-mic arbiter, merge-repair theo dữ liệu harness). Câu hỏi về hành vi `VoicePipeline`/gateway/STT: hỏi team voice, **không sửa trực tiếp `voice/src` hay `stt/`**.
