# 9. Acceptance Criteria & Test Scenarios

## 9.1 Definition of Done — Backend MVP

Backend được xem là hoàn thành khi:

1. Host tạo được session.
2. Guest join bằng room code.
3. Session từ `waiting` chuyển `active`.
4. Hai participant kết nối Socket.IO.
5. Backend nhận biết participant nào đang nói.
6. Chỉ một active turn tại một thời điểm.
7. Backend nhận binary audio đúng turn.
8. Backend forward audio tới STT adapter.
9. Partial transcript được gửi realtime.
10. Final transcript được nhận đúng turn.
11. Translation nhận đúng source/target language.
12. Translation nhận recent context.
13. Cả hai thiết bị nhận cùng `message.final`.
14. Message có source text và translated text.
15. Turn order đúng.
16. Latency được tính.
17. Provider lỗi không crash server.
18. Participant reconnect được.
19. Session full bị chặn.
20. API keys không lộ ra client.

## 9.2 Unit tests

### SessionService

- Create session.
- Generate unique room code.
- Join second participant.
- Reject third participant.
- Reject join closed session.
- End session idempotently.

### TurnService

- Start first turn.
- Reject second simultaneous turn.
- End active turn.
- Ignore duplicate end.
- Cancel active turn.
- Reject audio without active turn.

### ContextService

- Store completed turns only.
- Limit recent turns.
- Preserve order.
- Build glossary.

### LatencyService

- Calculate first partial.
- Calculate STT final.
- Calculate translation.
- Calculate end-to-end.

## 9.3 Integration tests

### Happy path

```text
Create session
→ Join session
→ Connect A
→ Connect B
→ A turn.start
→ audio chunks
→ A turn.end
→ mock STT final
→ mock translation
→ message.final to A and B
```

### Reverse language

- B source language `en`.
- Target must be `vi`.

### Turn busy

- A starts turn.
- B starts turn.
- B receives `TURN_BUSY`.

### Translation timeout

- STT final succeeds.
- Translation timeout.
- Client receives recoverable error.
- Session remains active.

### Reconnect

- B disconnects.
- B reconnects with same token.
- Session state restored.

### Duplicate final

- STT emits final twice.
- Only one translation request.
- Only one final message.

## 9.4 Manual demo test

- Hai browser/device khác nhau.
- Join cùng room.
- A nói tiếng Việt.
- Cả hai nhận song ngữ.
- B nói tiếng Anh.
- Cả hai nhận song ngữ.
- Thử B nói khi A đang giữ nút.
- Thử ngắt mạng một thiết bị rồi reconnect.
- Kiểm tra latency.
