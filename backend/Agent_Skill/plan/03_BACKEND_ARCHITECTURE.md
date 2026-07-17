# 3. Backend Architecture

## 3.1 Vai trò Backend

Backend là Realtime Translation Orchestrator.

Backend không chịu trách nhiệm:

- Noise reduction algorithm.
- VAD algorithm.
- STT model internals.
- Translation model internals.

Backend chịu trách nhiệm nối các phần thành một pipeline thống nhất.

## 3.2 Kiến trúc logic

```text
Device A                    Device B
   │                           │
   └────── Socket.IO / REST ───┘
                │
                ▼
       Realtime Gateway
                │
                ▼
 Session & Participant Manager
                │
                ▼
        Active Speaker Lock
                │
                ▼
           Turn Manager
                │
                ▼
       Audio Stream Router
                │
                ▼
           STT Adapter
                │
                ▼
 Conversation Context Manager
                │
                ▼
      Translation Adapter
                │
                ▼
        Result Broadcaster
                │
                ▼
      Device A + Device B
```

Các concern xuyên suốt:

- Validation.
- Structured logging.
- Latency metrics.
- Timeout.
- Retry.
- Error mapping.
- Configuration.
- Cleanup.

## 3.3 Module bắt buộc

### `sessions`

- Tạo session.
- Join session.
- End session.
- TTL cleanup.
- Room code.
- Session status.
- Recent turns.

### `participants`

- Tạo participant.
- Gắn participant với session.
- Ngôn ngữ nguồn và đích.
- Online/offline.
- Socket binding.
- Reconnect.

### `realtime`

- Socket.IO gateway.
- Auth handshake.
- Join Socket.IO room.
- Nhận JSON events.
- Nhận binary audio.
- Broadcast events.

### `turns`

- Tạo turn.
- Quản lý state machine.
- Active speaker lock.
- Sequence number.
- Chống duplicate.
- Reject event không hợp lệ.

### `audio`

- Validate audio metadata.
- Route binary chunks.
- Gắn chunk với participant và turn.
- Forward tới STT adapter.
- Không xử lý noise reduction.

### `providers/stt`

- Interface chung cho STT.
- Mock adapter.
- Real adapter.
- Partial/final/error callbacks.

### `providers/translation`

- Interface chung cho Translation.
- Mock adapter.
- Real adapter.
- Timeout và retry.

### `context`

- Recent turns.
- Glossary.
- Build translation context.
- Giới hạn context.

### `pipeline`

- Điều phối toàn bộ lifecycle.
- Không để gateway chứa business logic.
- Không để provider adapter biết về UI.

### `messaging`

- Tạo bilingual message.
- Broadcast đúng Socket.IO room.
- Có thể emit riêng cho participant khi cần.

### `observability`

- Latency per stage.
- Structured log.
- Correlation bằng `sessionId`, `participantId`, `turnId`, `eventId`.

### `health`

- Backend status.
- STT provider status.
- Translation provider status.

## 3.4 Cấu trúc source code đề xuất

```text
backend/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── config/
│   ├── auth/
│   ├── sessions/
│   ├── participants/
│   ├── realtime/
│   ├── turns/
│   ├── audio/
│   ├── pipeline/
│   ├── providers/
│   │   ├── stt/
│   │   └── translation/
│   ├── context/
│   ├── messaging/
│   ├── observability/
│   ├── health/
│   └── common/
├── test/
├── .env.example
└── package.json
```

## 3.5 Store cho MVP

Dùng in-memory store:

```ts
Map<string, TranslationSession>
Map<string, Participant>
Map<string, ConversationTurn>
```

Không thêm database trước khi pipeline end-to-end chạy ổn định.

## 3.6 Provider mode

Phải hỗ trợ config:

```env
STT_PROVIDER=mock
TRANSLATION_PROVIDER=mock
```

Sau đó đổi thành:

```env
STT_PROVIDER=remote
TRANSLATION_PROVIDER=remote
```

Hoặc:

```env
STT_PROVIDER=local
TRANSLATION_PROVIDER=local
```

Orchestrator không được sửa khi đổi provider.
