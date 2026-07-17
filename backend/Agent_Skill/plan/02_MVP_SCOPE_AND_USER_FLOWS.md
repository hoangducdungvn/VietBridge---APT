# 2. MVP Scope & User Flows

## 2.1 Phạm vi MVP bắt buộc

### Session

- Người A tạo translation session.
- Backend sinh `sessionId` và `roomCode`.
- Người B tham gia bằng `roomCode`.
- MVP giới hạn tối đa 2 participant.
- Mỗi participant chọn source language: `vi` hoặc `en`.

### Realtime connection

- Mỗi participant kết nối Backend qua Socket.IO.
- Mỗi socket phải được gắn với đúng `sessionId` và `participantId`.
- Hai socket cùng join vào một Socket.IO room.

### Speaking turn

- Người dùng giữ nút để nói.
- Frontend gửi `turn.start`.
- Backend cấp active speaker lock.
- Frontend gửi binary audio chunks.
- Frontend gửi `turn.end` khi người dùng thả nút.
- Backend finalize STT rồi gọi Translation.

### Bilingual result

Kết quả cuối cùng phải bao gồm:

- Speaker.
- Source language.
- Target language.
- Source text.
- Translated text.
- Turn order.
- Latency.

Kết quả được broadcast tới cả hai participant.

### Conversation context

- Backend lưu 4–8 turn hoàn chỉnh gần nhất.
- Translation nhận context để hiểu đại từ và chủ đề.
- Context không được quá dài gây tăng latency.

### Reliability

- Participant có thể reconnect trong một khoảng thời gian ngắn.
- STT hoặc Translation lỗi không được làm crash session.
- Partial transcript có thể mất nhưng final result không được mất.
- API key không được xuất hiện ở frontend.

## 2.2 Không thuộc MVP

- Audio/video call.
- WebRTC signaling.
- Screen sharing.
- Speaker diarization.
- TTS tự động đọc mọi bản dịch.
- Meeting summary.
- Action items.
- Persistent user accounts.
- Multi-room admin dashboard.
- Payment.
- Redis/Kafka.
- Full production authentication.
- Lưu audio lâu dài.

## 2.3 User flow — Tạo phiên

1. Người A mở web.
2. Chọn tên hiển thị.
3. Chọn ngôn ngữ `vi`.
4. Bấm “Tạo phiên dịch”.
5. Frontend gọi `POST /api/sessions`.
6. Backend trả `sessionId`, `roomCode`, `participantId`, `accessToken`.
7. Frontend kết nối Socket.IO.
8. Backend trả `session.state` với trạng thái `waiting`.

## 2.4 User flow — Tham gia phiên

1. Người B nhập room code.
2. Chọn tên hiển thị.
3. Chọn ngôn ngữ `en`.
4. Frontend gọi `POST /api/sessions/:roomCode/join`.
5. Backend thêm participant thứ hai.
6. Frontend kết nối Socket.IO.
7. Backend broadcast `participant.joined`.
8. Session chuyển sang `active`.

## 2.5 User flow — Người A nói

1. A giữ nút nói.
2. Frontend A gửi `turn.start`.
3. Backend kiểm tra session và active speaker.
4. Backend tạo `turnId`.
5. Backend gửi `turn.accepted`.
6. A bắt đầu gửi audio chunks.
7. Backend forward chunks sang STT.
8. STT trả partial transcript.
9. Backend gửi `stt.partial` về cả hai thiết bị hoặc ít nhất thiết bị A.
10. A thả nút.
11. Frontend gửi `turn.end`.
12. Backend finalize STT.
13. STT trả final transcript.
14. Backend gọi Translation với context.
15. Backend nhận bản dịch.
16. Backend lưu turn.
17. Backend broadcast `message.final` về cả A và B.
18. Backend giải phóng active speaker lock.

## 2.6 User flow — Hai người nói cùng lúc

MVP không xử lý song song.

Nếu session đang có active turn:

- Participant khác gửi `turn.start`.
- Backend trả `turn.rejected`.
- Error code: `TURN_BUSY`.

## 2.7 User flow — Reconnect

1. Socket bị mất.
2. Backend đánh participant là `offline`.
3. Session được giữ trong TTL ngắn.
4. Frontend reconnect bằng `accessToken`.
5. Backend rebind socket mới với participant cũ.
6. Backend gửi state hiện tại và recent messages.
