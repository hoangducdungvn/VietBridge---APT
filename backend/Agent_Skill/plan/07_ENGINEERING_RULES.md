# 7. Engineering Rules for AI Coding Agent

## 7.1 Quy tắc chung

- Dùng TypeScript strict mode.
- Không dùng `any` nếu không có lý do rõ ràng.
- Tất cả input bên ngoài phải validate.
- Business logic không nằm trong controller/gateway.
- Provider-specific code chỉ nằm trong adapter.
- Không hardcode API key.
- Không log secret.
- Không commit `.env`.
- Không thêm dependency nếu chưa cần.
- Không over-engineer.

## 7.2 NestJS conventions

- Mỗi domain có module, service, types/DTO riêng.
- Controller chỉ nhận request và gọi service.
- Gateway chỉ parse event và gọi orchestrator.
- Orchestrator điều phối pipeline.
- Store phải bọc qua service/interface.
- Dùng dependency injection.

## 7.3 Validation

Có thể dùng:

- `class-validator` + DTO.
- Hoặc Zod.

Phải validate:

- Language.
- Room code.
- Participant ID.
- Session ID.
- Event type.
- Audio config.
- Sequence.
- Text length.
- Glossary size.

## 7.4 Logging

Mỗi log quan trọng phải có:

- `event`
- `sessionId`
- `participantId`
- `turnId`
- `durationMs`
- `status`
- `errorCode`

Không log:

- API key.
- Access token.
- Raw audio.
- Authorization header.

Transcript logging phải có config:

```env
LOG_TRANSCRIPTS=false
```

## 7.5 Idempotency

Các event sau phải chịu được duplicate:

- `turn.end`
- `session.end`
- Provider final callback
- Translation response

## 7.6 Concurrency

- Một session chỉ có 1 active turn trong MVP.
- Mọi thao tác cập nhật active speaker phải atomic trong phạm vi một process.
- Kết quả provider phải kiểm tra `turnId` và state hiện tại.
- Partial cũ không được overwrite final.

## 7.7 Error handling

Không throw error không được map ra client.

Error phải có:

```ts
interface PipelineError {
  code: string;
  message: string;
  recoverable: boolean;
  sessionId?: string;
  turnId?: string;
}
```

## 7.8 Security MVP

- Short-lived participant token.
- Token gắn với `sessionId` và `participantId`.
- Socket handshake phải verify token.
- REST join phải chặn session full.
- CORS chỉ mở cho frontend URL cấu hình.
- Rate limit đơn giản cho create/join.
- Không expose provider keys.

## 7.9 Performance

- Audio dùng Buffer/binary, không Base64.
- Partial transcript có thể drop khi backpressure.
- Final transcript và final translation không được drop.
- Không giữ raw audio sau khi turn hoàn tất trừ khi debug mode được bật rõ ràng.
- Context có giới hạn.

## 7.10 Testability

Mọi provider phải mock được.

Orchestrator phải test được mà không cần WebSocket thật.

Store phải có thể reset giữa test.

## 7.11 Forbidden changes

AI agent không được tự ý:

- Thêm PostgreSQL.
- Thêm Redis.
- Thêm Kafka.
- Thêm Docker Compose nhiều service.
- Thêm WebRTC.
- Thêm GraphQL.
- Thêm CQRS/Event Sourcing.
- Thêm authentication SaaS đầy đủ.
- Tự thay đổi event contract.

Nếu thấy cần thay đổi contract, phải đề xuất trước.
