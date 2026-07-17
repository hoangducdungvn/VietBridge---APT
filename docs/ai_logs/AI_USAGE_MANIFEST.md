# AI Usage Manifest — VietBridge Project

Tài liệu này tổng hợp đầy đủ danh sách các công cụ AI và phiên làm việc (sessions) được đội thi sử dụng trong suốt quá trình phát triển dự án Hackathon **VietBridge — Real-Time VI↔EN Meeting Translator**.

---

## 1. Bảng tổng hợp công cụ AI đã sử dụng

| Công cụ / Model | Loại | Mục đích sử dụng chính | Minh chứng (Link / Session Files) |
| :--- | :--- | :--- | :--- |
| **Antigravity (Gemini 3.1 Pro)** | Desktop Tool / CLI | Thiết kế tài liệu README, phân tích kiến trúc Backend NestJS, setup Git logs & quản lý branch | `desktop_sessions/antigravity_session_26159e39/` |
| **ChatGPT / Claude / Gemini Web** *(Cập nhật theo thực tế)* | Online Web | Nghiên cứu tối ưu hóa Silero VAD, tham số faster-whisper int8, và mô hình xử lý tiếng ồn | *[Dán link chia sẻ chat công khai vào đây]* |
| **Cursor / VS Code Copilot** *(Cập nhật theo thực tế)* | Desktop IDE | Autocomplete code TypeScript/Python, refactor các module Backend và WebSocket | `screenshots/` |

---

## 2. Hướng dẫn cho Ban Tổ Chức (Organizers & Judges)

Theo đúng yêu cầu minh bạch sử dụng AI từ Ban Tổ Chức, chúng tôi cung cấp đầy đủ:
1. **Đối với công cụ Online (ChatGPT, Claude Web, v.v.):** Các đường link chia sẻ (Public Shareable Links) đính kèm trực tiếp trong bảng trên.
2. **Đối với công cụ Desktop/CLI (Antigravity, Cursor, Copilot, v.v.):** Toàn bộ file log phiên làm việc (`.jsonl`, `.json`...) được lưu trữ nguyên vẹn tại thư mục `desktop_sessions/` kèm theo các ảnh chụp màn hình quan trọng tại thư mục `screenshots/`.

---

## 3. Cấu trúc lưu trữ minh chứng AI (`docs/ai_logs/`)

```text
docs/ai_logs/
├── AI_USAGE_MANIFEST.md                     # Tài liệu tổng hợp này
├── desktop_sessions/                        # Các file log/transcript từ Desktop tools
│   └── antigravity_session_26159e39/        # Log chi tiết phiên làm việc với Antigravity AI
└── screenshots/                             # Ảnh chụp màn hình các phiên prompt quan trọng
```

---

## 4. Ghi chú bổ sung từ đội thi
- Tất cả các phiên làm việc với AI đều phục vụ mục đích tăng tốc độ phát triển prototype, hỗ trợ thiết kế kiến trúc và chuẩn hóa mã nguồn, tuân thủ tuyệt đối quy định và bản quyền của cuộc thi Hackathon.
