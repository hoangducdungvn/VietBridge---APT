# 8. Backend Implementation Plan

## Phase 1 — Foundation

Mục tiêu:

- NestJS chạy.
- Env validation.
- Health endpoint.
- Global validation.
- Global error filter.
- Logging cơ bản.

Deliverables:

- `GET /health`
- `.env.example`
- Config module
- Test app bootstrap

## Phase 2 — Session & Participant

Mục tiêu:

- Tạo session.
- Join session.
- Max 2 participant.
- In-memory stores.
- Short-lived participant token.

Deliverables:

- `POST /api/sessions`
- `POST /api/sessions/:roomCode/join`
- `GET /api/sessions/:roomCode`
- `POST /api/sessions/:sessionId/end`

## Phase 3 — Realtime Room

Mục tiêu:

- Socket.IO gateway.
- Auth handshake.
- Join room.
- Participant online/offline.
- Broadcast session state.

Deliverables:

- `session.connect`
- `participant.joined`
- `participant.left`
- `session.state`

## Phase 4 — Turn & Active Speaker

Mục tiêu:

- Push-to-talk lifecycle.
- Active speaker lock.
- Turn state.
- Reject simultaneous speaking.

Deliverables:

- `turn.start`
- `turn.accepted`
- `turn.rejected`
- `turn.end`
- `turn.cancel`

## Phase 5 — Mock Pipeline

Mục tiêu:

- Chưa cần STT/Translation thật.
- Audio chunk vào được.
- Mock STT partial/final.
- Mock Translation.
- Broadcast bilingual message.

Deliverables:

```text
Device A
→ turn.start
→ audio chunks
→ turn.end
→ mock STT
→ mock translation
→ message.final tới A và B
```

Đây là milestone quan trọng nhất trước tích hợp thật.

## Phase 6 — STT Integration

Mục tiêu:

- Real STT adapter.
- Partial transcript.
- Final transcript.
- Timeout/error.
- Audio validation.

## Phase 7 — Translation Integration

Mục tiêu:

- Real Translation adapter.
- Context.
- Glossary.
- Timeout/retry.
- Preserve data.

## Phase 8 — Observability & Reconnect

Mục tiêu:

- Latency metrics.
- Structured logs.
- Participant reconnect.
- Session TTL cleanup.
- Provider health.

## Phase 9 — Hardening

Mục tiêu:

- E2E tests.
- Duplicate events.
- Invalid sequence.
- Provider timeout.
- Two clients test.
- Session full.
- Turn busy.
- Feature freeze.

## Thứ tự ưu tiên tuyệt đối

1. Hai thiết bị join cùng session.
2. WebSocket broadcast.
3. Turn lock.
4. Mock end-to-end pipeline.
5. STT thật.
6. Translation thật.
7. Context.
8. Latency.
9. Reconnect.
10. Bonus.
