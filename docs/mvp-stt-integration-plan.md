# Kế hoạch tích hợp MVP STT — Frontend, Backend và STT

## 1. Mục tiêu

Tạo một vertical slice chạy được trên hai trình duyệt/máy:

1. Host tạo session và chọn `vi` hoặc `en`.
2. Guest join cùng room và bắt buộc chọn ngôn ngữ còn lại.
3. Mỗi client dùng microphone riêng.
4. Voice capture tạo PCM signed 16-bit, mono, 16 kHz và xác định utterance bằng VAD.
5. Frontend gửi turn/audio tới NestJS backend.
6. Backend xác thực participant, gom audio độc lập theo participant/turn và gọi STT service đồng thời khi cần.
7. STT tự route `vi → FPT` và `en → Groq`.
8. Backend gửi partial/final transcript về cả hai client.
9. Frontend hiển thị transcript gốc; chưa dịch và chưa TTS.

## 2. Trạng thái hiện tại

| Thành phần | Đã có | Chưa nối |
|---|---|---|
| Frontend | Room thật, participant state, Socket.IO chung, microphone button và source transcript | Chưa có bản dịch song ngữ |
| Voice | AudioWorklet, PCM16, VAD, utterance lifecycle, raw WS debug transport và Socket.IO room transport | Hai-browser acceptance test với mic thật cần chạy thủ công |
| Backend | REST room, token handshake, presence, participant-scoped PCM buffer, concurrent partial/final scheduler và remote STT adapter | Chưa có translation/context hoặc persistence |
| STT | FastAPI HTTP/WS gateway, FPT/Groq routing, partial/final và fallback | Cần xác nhận key/quota và hai engine bằng giọng thật tại máy demo |
| Translation | Chưa có | Ngoài phạm vi vertical slice này |

## 3. Vấn đề phải xử lý trước khi nối

### 3.1 Không gửi `audio/webm` vào STT hiện tại

`frontend/src/infrastructure/audio/WebAudioStreamRepository.ts` đang dùng `MediaRecorder` và phát Blob `audio/webm`. STT gateway chỉ đọc WAV hoặc raw PCM16; nếu gửi WebM trực tiếp, bytes sẽ bị hiểu nhầm thành PCM và transcript sai.

Quyết định cho MVP:

- Tái sử dụng capture, resampler, VAD và PCM16 từ `voice/`.
- Không dùng `MediaRecorder audio/webm` cho pipeline STT.
- Không thêm FFmpeg/WebM transcoding vào STT trong MVP.

### 3.2 Thống nhất transport

Quyết định đề xuất cho vertical slice:

- Frontend ↔ NestJS backend: **Socket.IO**, cùng endpoint backend port `3000`.
- NestJS backend ↔ STT service: **HTTP multipart** tới `POST /v1/transcribe` trên port `8001`.
- `voice/src/mock-server` chỉ giữ vai trò test harness độc lập, không nằm trong runtime cuối.
- Refactor phần transport của `VoicePipeline` thành interface; capture/VAD không phụ thuộc Socket.IO hay raw WebSocket.

Lý do: backend plan và frontend chính đã chọn Socket.IO; provider STT đã có HTTP API ổn định và không cần biết UI/room.

### 3.3 Khóa cặp ngôn ngữ

Trước khi nối STT, backend phải enforce đúng một participant `vi` và một participant `en`:

- Guest có `sourceLanguage` giống host → HTTP `409`.
- Đề xuất error code: `LANGUAGE_PAIR_CONFLICT`.
- Cập nhật `backend/Agent_Skill/API_SPECIFICATION.md`, unit test và e2e test trong cùng thay đổi.
- STT routing luôn lấy ngôn ngữ đã lưu của participant, không tin `direction` tùy ý từ client.

## 4. Kiến trúc đích

```text
Browser A / Browser B
  ├─ REST create/join session
  ├─ Socket.IO + participant accessToken
  └─ Voice capture: AudioWorklet → resample → VAD → PCM16
                    │
                    ▼
NestJS Backend :3000
  ├─ Session + Participant validation
  ├─ Socket room + presence
  ├─ Independent audio segment per participant
  ├─ Ordered PCM buffer per participant/turn
  ├─ Partial scheduler (~2s, max one in flight)
  └─ Remote STT adapter
                    │ HTTP multipart
                    ▼
FastAPI STT :8001
  ├─ language=vi → FPT
  ├─ language=en → Groq
  └─ partial/final result + latency/error
                    │
                    ▼
NestJS emits stt.partial / stt.final
                    │
                    ▼
Both browsers render source transcript
```

API keys chỉ tồn tại trong process STT qua `stt/.env`. Frontend và NestJS không được nhận, log hoặc forward provider keys.

## 5. Realtime contract tối thiểu cho MVP STT

Giữ event names đã định nghĩa trong backend plan:

### 5.1 Socket handshake

```ts
io(BACKEND_URL, {
  auth: { accessToken }
});
```

Backend verify token, lấy `sessionId` và `participantId` từ token claims, rồi join Socket.IO room theo `sessionId`.

### 5.2 Bắt đầu turn

Client emit `turn.start` với:

```json
{
  "type": "turn.start",
  "eventId": "evt-client-1",
  "sessionId": "session_...",
  "participantId": "participant_...",
  "payload": {
    "audioConfig": {
      "codec": "pcm_s16le",
      "sampleRate": 16000,
      "channels": 1
    }
  }
}
```

Backend trả `turn.accepted` kèm `turnId`. Client chỉ gửi audio sau khi turn được accept; pre-roll phải được buffer trong voice transport adapter trong lúc chờ ACK.

Không có speaker lock toàn session và không có `TURN_BUSY`. Hai participant được phép có turn đồng thời. Mỗi participant chỉ có một segment capture tại một thời điểm; `turn.start` mới sẽ hủy và dọn segment capture cũ bị kẹt rồi trả `turn.accepted`, còn segment đang chờ STT final không chặn segment mới.

### 5.3 Audio chunk

Socket.IO event `audio.chunk` gửi một object có metadata và binary payload:

```ts
{
  sessionId: string;
  participantId: string;
  turnId: string;
  sequence: number;
  audio: ArrayBuffer; // PCM_S16LE, 16 kHz, mono
}
```

Backend kiểm tra session, participant ownership, turn, sequence và giới hạn kích thước trước khi append buffer. Audio của hai participant được lưu ở hai turn riêng và không ghi đè lẫn nhau.

### 5.4 Kết thúc turn

Client emit `turn.end` với `turnId`. Backend dừng nhận chunk và gọi STT final trên toàn bộ PCM tích lũy. Participant có thể mở segment tiếp theo trong lúc final cũ đang xử lý; kết quả của người này không reset segment đang chạy của người kia.

### 5.5 Transcript events

Backend broadcast `stt.partial` và `stt.final` tới room, giữ schema trong backend plan. Với MVP chưa dịch:

- UI chỉ render `sourceText`/transcript.
- Không giả lập `translatedText`.
- Không emit `message.final` cho tới khi Translation phase được triển khai.

## 6. Contract Backend → STT

Endpoint:

```http
POST http://127.0.0.1:8001/v1/transcribe
Content-Type: multipart/form-data
```

Fields:

| Field | Value |
|---|---|
| `file` | Toàn bộ PCM16 tích lũy của turn/utterance |
| `utterance_id` | Backend `turnId` |
| `language_hint` | Participant `sourceLanguage` (`vi` hoặc `en`) |
| `is_final` | `false` cho partial, `true` cho final |
| `continuation_id` | Bỏ trống trong MVP đầu tiên |

Result cần map:

| STT result | Backend event |
|---|---|
| `utterance_id` | `turnId` |
| `type=partial` | `stt.partial` |
| `type=final` | `stt.final` |
| `text` | `payload.text` |
| `language` | `payload.language` |
| `asr_latency_ms` | latency metadata/log |
| `error` | `pipeline.error` với code được map sang `STT_*`/`PROVIDER_ERROR` |

Partial strategy:

- Không gọi STT theo từng audio chunk 40–60 ms.
- Re-decode toàn bộ audio tối đa mỗi khoảng `2s`, theo benchmark hiện tại.
- Chỉ cho một partial request đang chạy trên mỗi turn.
- Khi `turn.end` tới, final supersede partial đang chờ; final không được drop.
- Xóa raw PCM khỏi memory sau final/error/cancel.
- Giới hạn một utterance ở `25s` cho demo.

## 7. Environment và port

### 7.1 STT — `stt/.env` (local, gitignored)

```env
FPT_API_KEY=<local-secret>
GROQ_API_KEY=<local-secret>
STT_BACKEND=auto
STT_HOST=127.0.0.1
STT_PORT=8001
```

### 7.2 Backend — `backend/.env`

```env
PORT=3000
HOST=127.0.0.1
CORS_ORIGIN=http://localhost:5173
STT_PROVIDER=remote
STT_BASE_URL=http://127.0.0.1:8001
STT_START_TIMEOUT_MS=5000
STT_FINAL_TIMEOUT_MS=10000
TRANSLATION_PROVIDER=mock
```

`STT_BASE_URL` cần được thêm vào env validation và `backend/.env.example` khi triển khai adapter.

### 7.3 Frontend — `frontend/.env`

```env
VITE_BACKEND_API_URL=http://localhost:3000
VITE_BACKEND_WS_URL=http://localhost:3000
VITE_PUBLIC_APP_URL=http://localhost:5173
VITE_SUPPORTED_LANGUAGES=vi,en
```

Frontend không được có FPT/Groq API key.

Khi test trên hai máy cùng Wi-Fi, dùng cấu hình HTTPS certificate và same-origin Vite proxy trong `docs/deploy.md`. Cả `VITE_BACKEND_API_URL`, `VITE_BACKEND_WS_URL` và `VITE_PUBLIC_APP_URL` phải trỏ tới `https://<IP-LAN-MÁY-HOST>:5173` để microphone hoạt động mà không bị mixed-content.

## 8. Kế hoạch triển khai theo milestone

### Milestone 0 — Smoke test STT độc lập

- [x] Tạo `stt/.env` local và `stt/.env.example`.
- [x] Xác nhận cả hai key được config loader nhận mà không log giá trị.
- [ ] Cài `stt/stt_service/requirements.txt` trong virtual environment.
- [x] Chạy `GET :8001/health`.
- [ ] Gọi `/v1/transcribe` bằng sample Việt và Anh; xác nhận backend result lần lượt là `fpt` và `groq`.
- [ ] Chạy `voice` debug UI + `voice` mock gateway để xác nhận microphone → PCM/VAD → STT trước khi thay gateway.

Lệnh smoke test cho debug UI (mock gateway mặc định dùng `8081` vì `8080` có thể bị service khác trên máy chiếm):

```powershell
# Terminal A — mock gateway, trong thư mục voice
$env:STT_URL="http://127.0.0.1:8001/v1/transcribe"
npm run mock-server

# Terminal B — Voice debug UI, trong thư mục voice
npm run dev
```

Gateway URL trên debug UI: `ws://localhost:8081`. Có thể đổi port gateway bằng biến `MOCK_GATEWAY_PORT` và nhập URL tương ứng trên UI.

### Milestone 1 — Chuẩn hóa session/language

- [x] Enforce cặp ngôn ngữ đối nghịch ở `SessionsService`.
- [x] Thêm `LANGUAGE_PAIR_CONFLICT` và cập nhật API specification.
- [x] Thay room mock ở frontend bằng REST create/join/state/end.
- [x] Thêm sảnh General cố định 5 card `APT001`–`APT005`, lấy occupancy thật từ `GET /api/rooms` và popup Create/Join.
- [x] Lưu `sessionId`, `participantId`, `roomCode`, `accessToken`, `sourceLanguage`, `targetLanguage` và `role` trong session store phía frontend.
- [x] Xóa nút `Simulate participant join` khỏi runtime thật.

### Milestone 2 — Backend realtime room

- [x] Cài Socket.IO server dependency tương thích NestJS.
- [x] Implement gateway handshake bằng participant token.
- [x] Bind socket ↔ participant, join room và cập nhật online/offline.
- [x] Emit `session.state`, `participant.joined`, `participant.left`.
- [x] Không log token hoặc Authorization data.

### Milestone 3 — Independent audio ingestion

- [x] Implement `TurnService` state machine với audio segment độc lập cho mỗi participant; không có active-speaker lock toàn session.
- [x] Validate `turn.start`, `audio.chunk`, `turn.end`, duplicate end và sequence.
- [x] Buffer PCM theo `turnId`, không theo socket tùy ý.
- [x] Giới hạn chunk, tổng duration và memory.
- [x] Cleanup buffer trong mọi success/error/cancel/disconnect path.

Trạng thái hiện tại sau Milestone 3: hai VoicePipeline trên hai thiết bị có thể gửi audio đồng thời vào các buffer riêng.

### Milestone 4 — Remote STT adapter

- [x] Implement STT provider adapter gọi FastAPI multipart.
- [x] Partial scheduler 2s và final supersession.
- [x] Map timeout, unavailable, provider error và latency.
- [ ] Route language từ participant state; assert `vi → fpt`, `en → groq` trong integration test.
- [x] Broadcast `stt.partial`/`stt.final` về cả hai sockets.

### Milestone 5 — Frontend voice integration

- [x] Tách transport khỏi `VoicePipeline` bằng interface.
- [x] Giữ AudioWorklet/resampler/VAD/utterance; thêm Socket.IO transport adapter.
- [x] Buffer pre-roll cho tới khi nhận `turn.accepted`.
- [x] Bỏ `WebAudioStreamRepository` dùng MediaRecorder khỏi STT runtime path chính.
- [x] Render partial theo `turnId`; final thay partial và không tạo duplicate.
- [x] Dừng mic và giải phóng tracks khi stop/unmount.
- [x] Đánh dấu pane STT ngôn ngữ nguồn của local participant bằng màu xanh lá và nhãn `You`.
- [x] Xóa transcript UI cùng toàn bộ turn/transcript/audio state trong backend khi end session.
- [x] Thêm scroll độc lập và auto-follow final transcript mới nhất cho từng pane ngôn ngữ.

### Quyết định mentor — microphone độc lập

- Đã bỏ active-speaker lock và `TURN_BUSY`; không còn bước chuyển quyền microphone giữa hai người.
- Mỗi thiết bị capture microphone liên tục. Energy VAD chỉ chia audio local thành utterance (`~120 ms` để mở, `600 ms` im lặng để đóng), không khóa participant còn lại.
- Hai người có thể nói đồng thời; backend buffer, partial scheduler và final STT theo từng `turnId` độc lập.
- Final của participant A không reset turn đang chạy của participant B.
- Hai thiết bị đặt gần nhau vẫn có thể cùng thu một giọng nói; khi test nên dùng tai nghe và tách thiết bị để hạn chế echo/cross-talk.

Phase tuning sau chỉ cần tập trung chất lượng chia utterance/VAD, không còn handoff hoặc retry `TURN_BUSY`.

### Milestone 6 — E2E MVP STT

- [ ] Hai browser join cùng room với ngôn ngữ đối nghịch.
- [ ] A nói tiếng Việt: cả hai thấy cùng partial/final, engine `fpt`.
- [ ] B nói tiếng Anh: cả hai thấy cùng partial/final, engine `groq`.
- [ ] A và B nói đồng thời: cả hai turn được accept và cả hai transcript được broadcast.
- [ ] Provider timeout/error của một participant không crash session hoặc làm mất stream của participant kia.
- [ ] Không có provider key trong bundle FE, browser network payload hoặc backend log.
- [ ] Chạy lint/test/build cho `backend`, `frontend`, `voice`; chạy Python tests cho `stt`.

## 9. Thứ tự chạy local sau khi hoàn thành integration

Terminal 1 — STT:

```powershell
cd D:\VietBridge---APT\stt
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r .\stt_service\requirements.txt
python -m stt_service.server
```

Terminal 2 — Backend:

```powershell
cd D:\VietBridge---APT\backend
npm install
npm run start:dev
```

Terminal 3 — Frontend:

```powershell
cd D:\VietBridge---APT\frontend
npm install
npm run dev
```

Health checks:

```text
GET http://localhost:8001/health
GET http://localhost:3000/health
```

### Kiểm tra integration không cần microphone

Sau khi Terminal 1 (STT) và Terminal 2 (Backend) đã chạy, dùng sample WAV tiếng Anh để kiểm tra trọn tuyến Socket.IO → Backend → Groq → broadcast cho hai client giả lập:

```powershell
cd D:\VietBridge---APT\backend
npm run smoke:stt
```

Kết quả PASS phải có `backend: "groq"`, `language: "en"`, transcript không rỗng và `broadcastToBothClients: true`. Nếu test này fail thì sửa Backend/STT trước; chưa cần kiểm tra microphone hay Frontend.

Automated backend suite dùng mock STT để chạy ổn định, không tiêu quota provider:

```powershell
cd D:\VietBridge---APT\backend
npm run test -- realtime.e2e-spec.ts --runInBand
```

### Kiểm tra hai browser và microphone thật

1. Chạy đủ STT, Backend và Frontend theo ba terminal ở trên.
2. Browser A mở URL LAN HTTPS theo `docs/deploy.md`, chọn một card trống trong 5 phòng (hoặc bấm **Create room**), nhập tên và chọn `vi`; link copy sẽ có dạng `https://<IP-LAN>:5173/?room=APT001&language=en`.
3. Browser B mở đúng link đó; room code và ngôn ngữ đối nghịch đã được điền sẵn, chỉ cần nhập display name và bấm **Join room**.
4. Socket.IO tự kết nối và microphone tự khởi động khi vào meeting; cho phép quyền microphone khi trình duyệt hỏi. Nút microphone dùng để stop hoặc retry nếu browser chặn auto-start.
5. A nói tiếng Việt rồi im lặng ít nhất khoảng một giây để VAD đóng turn. Cả hai browser phải thấy cùng transcript ở cột tiếng Việt; log STT phải cho thấy backend `fpt`.
6. B nói tiếng Anh rồi im lặng. Cả hai phải thấy cùng transcript ở cột tiếng Anh; backend phải là `groq`.
7. Cho A và B nói đồng thời; không bên nào nhận `TURN_BUSY`, và cả hai transcript phải xuất hiện đúng cột ngôn ngữ.
8. Bấm **Stop microphone** trước khi rời phòng. Reload browser để kiểm tra session/token reconnect.

Lưu ý khi dùng hai máy: microphone thường bị browser chặn trên `http://<LAN-IP>`. Hãy dùng HTTPS đáng tin cậy hoặc cấu hình browser demo cho phép origin LAN đó; `http://localhost` chỉ được coi là secure context trên chính máy đang chạy browser.

Ở milestone này không có bản dịch: câu tiếng Việt không tự xuất hiện bằng tiếng Anh và ngược lại.

## 10. Definition of Done cho MVP STT

- FE không còn dùng room/caption mock trong luồng demo chính.
- Hai participant thật cùng một backend session và khác source language.
- Access token được verify khi mở socket.
- Audio tới backend là PCM16 16 kHz mono, không phải WebM.
- Hai participant có thể stream/STT đồng thời, mỗi turn có ownership và buffer riêng.
- Backend gọi đúng STT engine theo participant language.
- Partial/final xuất hiện ở cả hai browser và giữ đúng speaker/turn ordering.
- Final transcript không bị mất hoặc duplicate.
- Kết thúc turn luôn cleanup PCM của đúng participant mà không ảnh hưởng turn còn lại.
- Không lộ API key và không commit `.env`.
- Translation/TTS không bị giả lập như một tính năng đã hoàn thành.

## 11. Ngoài phạm vi kế hoạch này

- Translation và glossary/context.
- `message.final` song ngữ.
- TTS.
- Database, Redis, Kafka hoặc microservices.
- Production scaling, multi-instance gateway và long-term audio storage.
