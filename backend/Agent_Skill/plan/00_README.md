# VietBridge Backend — Agent Context Pack

Thư mục này cung cấp toàn bộ ngữ cảnh nghiệp vụ, kiến trúc, hợp đồng dữ liệu và quy tắc kỹ thuật để AI coding agent xây dựng Backend cho VietBridge.

## Cách agent phải đọc tài liệu

Đọc theo thứ tự:

1. `01_PRODUCT_AND_BUSINESS_CONTEXT.md`
2. `02_MVP_SCOPE_AND_USER_FLOWS.md`
3. `03_BACKEND_ARCHITECTURE.md`
4. `04_DOMAIN_MODELS_AND_STATE.md`
5. `05_REALTIME_EVENTS_AND_API_CONTRACTS.md`
6. `06_STT_TRANSLATION_INTEGRATION.md`
7. `07_ENGINEERING_RULES.md`
8. `08_IMPLEMENTATION_PLAN.md`
9. `09_ACCEPTANCE_CRITERIA_AND_TESTS.md`

Không được bắt đầu code trước khi đã đọc đủ các file trên.

## Tóm tắt một câu

VietBridge là hệ thống phiên dịch cuộc họp trực tiếp Việt–Anh theo mô hình:

- Hai người.
- Hai thiết bị.
- Một phiên dịch chung.
- Mỗi người dùng micro của thiết bị mình.
- Mỗi lượt nói được chuyển thành transcript, dịch theo ngữ cảnh, rồi đồng bộ câu gốc và câu dịch về cả hai thiết bị.
- Không xây video call hay audio call trong MVP.

## Stack Backend đã chốt

- Node.js
- TypeScript
- NestJS
- Socket.IO
- REST API
- In-memory store cho MVP
- Adapter pattern cho STT và Translation
- Zod hoặc `class-validator` để validate dữ liệu
- Pino hoặc NestJS Logger cho structured logging
- Jest cho unit/integration test

## Nguyên tắc quan trọng nhất

Backend là **Realtime Translation Orchestrator**, không phải nơi tự triển khai noise reduction, STT model hay translation model.

Backend chịu trách nhiệm:

- Session.
- Participant.
- Turn.
- Active speaker lock.
- Audio routing.
- Điều phối STT.
- Điều phối Translation.
- Conversation context.
- Broadcast kết quả song ngữ.
- Latency.
- Error handling.
- API key và cấu hình.

## Không được tự ý thêm vào MVP

- Video call.
- WebRTC media call.
- Screen sharing.
- Diarization phức tạp.
- Database production.
- Redis/Kafka.
- Microservice phức tạp.
- Authentication đầy đủ kiểu SaaS.
- Tóm tắt cuộc họp.
- TTS tự động.
- Zoom/Teams/Meet integration.

Các phần này chỉ được thêm nếu toàn bộ MVP đã hoàn thành và có yêu cầu rõ ràng.
