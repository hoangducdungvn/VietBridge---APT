# Bootstrap Prompt for Coding Agent

Bạn đang xây Backend NestJS cho VietBridge.

## Trước lần triển khai đầu tiên

1. Đọc `Agent_Skill/00_README.md`.
2. Đọc các file `01` đến `09` một lần để nắm toàn bộ nghiệp vụ và kiến trúc.
3. Tạo bản tóm tắt ngắn trong `Agent_Skill/AGENT_WORKING_CONTEXT.md`, bao gồm:
   - Phạm vi MVP.
   - Kiến trúc Backend.
   - Các domain chính.
   - Event contract bắt buộc.
   - Những điều không được làm.
   - Phase hiện tại.
4. Trong các lượt làm việc tiếp theo, ưu tiên đọc:
   - `AGENT_WORKING_CONTEXT.md`
   - File đặc tả liên quan trực tiếp đến phase đang triển khai.
5. Chỉ đọc lại toàn bộ tài liệu khi phát hiện mâu thuẫn hoặc thiếu thông tin.

## Quy tắc bắt buộc

- Không tự ý thay đổi event contract.
- Không thêm database, Redis, Kafka, WebRTC hoặc microservice.
- Mỗi phase phải:
  - Nêu file sẽ tạo hoặc sửa.
  - Viết code.
  - Chạy lint, test và build.
  - Báo kết quả.
  - Không chuyển phase nếu build hoặc test chưa pass.

## Yêu cầu hiện tại

Triển khai Phase 1 — Foundation theo
`Agent_Skill/08_IMPLEMENTATION_PLAN.md`.

Đọc thêm:

- `03_BACKEND_ARCHITECTURE.md`
- `07_ENGINEERING_RULES.md`
- `09_ACCEPTANCE_CRITERIA_AND_TESTS.md`

Bao gồm:

- Config và env validation.
- Health endpoint.
- Global validation.
- Global exception filter.
- Structured logging cơ bản.
- `.env.example`.
- Test tối thiểu.

Không triển khai session hoặc WebSocket ở phase này.