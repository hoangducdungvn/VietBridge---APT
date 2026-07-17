# 10. Bootstrap Prompt for Coding Agent

Chỉ dùng prompt này sau khi agent đã đọc toàn bộ file `00` đến `09`.

---

Bạn đang xây Backend NestJS cho VietBridge.

Trước khi code:

1. Đọc toàn bộ thư mục `Agent_Skill`.
2. Tóm tắt lại kiến trúc và phạm vi MVP.
3. Liệt kê các assumption còn thiếu.
4. Không tự ý thay đổi event contract.
5. Không thêm database, Redis, Kafka, WebRTC hoặc microservice.
6. Bắt đầu bằng Phase 1 trong `08_IMPLEMENTATION_PLAN.md`.
7. Mỗi phase phải:
   - Nêu file sẽ tạo/sửa.
   - Viết code.
   - Chạy lint/test/build.
   - Báo kết quả.
   - Không tự động chuyển phase nếu build/test chưa pass.

Yêu cầu đầu tiên:

> Hãy triển khai Phase 1 — Foundation cho Backend NestJS theo đúng tài liệu. Bao gồm config, env validation, health endpoint, global validation, global exception filter, structured logging cơ bản, `.env.example` và test tối thiểu. Không triển khai session hoặc WebSocket ở phase này.
