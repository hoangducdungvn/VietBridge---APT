# Hướng Dẫn Tích Hợp & Chạy Thử Hệ Thống Âm Thanh (VietBridge)

Tài liệu này hướng dẫn cách khởi chạy và kiểm thử toàn bộ luồng xử lý âm thanh thời gian thực của VietBridge: **Mic → VAD → WebSocket → STT (FPT Whisper) → Translation (FPT LLM) → UI**.

> [!IMPORTANT]
> **Thay đổi Kiến Trúc Mới Nhất:**
> Hệ thống hiện tại đã loại bỏ hoàn toàn Groq để tránh lỗi block IP tại Việt Nam. STT và Translation hiện được xử lý 100% trên hạ tầng của **FPT Cloud**, sử dụng chung 1 API Key duy nhất.

---

## 1. Yêu Cầu Môi Trường (`.env`)

Tạo file `.env` ở thư mục gốc của dự án (`VietBridge---APT/.env`) với nội dung sau:

```env
# FPT Cloud API Key (Bắt buộc)
FPT_API_KEY=your_fpt_api_key_here

# STT Configuration
FPT_BASE_URL=https://mkp-api.fptcloud.com
STT_BACKEND=auto

# Mock Gateway Configuration (Dành cho test UI)
MOCK_GATEWAY_PORT=8081
STT_URL=http://localhost:8001/v1/transcribe
LLM_URL=https://mkp-api.fptcloud.com/v1/chat/completions
LLM_MODEL=Llama-3.3-70B-Instruct
```

---

## 2. Cách Khởi Chạy Toàn Bộ Hệ Thống (Môi trường Test)

Để luồng âm thanh hoạt động, bạn cần bật 3 service độc lập. Hãy mở **3 cửa sổ Terminal** và trỏ về thư mục gốc của dự án.

### Terminal 1: Chạy STT Service (Python)
Service này xử lý file âm thanh (đã được cắt khoảng lặng) và chuyển thành văn bản.
* Xử lý Partial (đang nói): Dùng model `FPT.AI-whisper-large-v3-turbo` siêu nhanh.
* Xử lý Final (ngắt câu): Dùng model gốc `whisper-large-v3-turbo` để bắt lỗi Code-switching (Anh-Việt).

```powershell
cd stt
# Kích hoạt môi trường ảo (nếu có): venv\Scripts\activate
pip install -r requirements.txt
uvicorn stt_service.server:app --host 0.0.0.0 --port 8001
```

### Terminal 2: Chạy Mock Gateway (Node.js)
Đây là cầu nối (WebSocket Server) hứng luồng âm thanh liên tục từ Browser, cắt thành từng đoạn, gọi STT Service, và sau đó gọi LLM để dịch thuật.

```powershell
cd voice
npm install
npm run mock-server
```
*(Nếu cổng 8081 báo lỗi trùng, hãy đảm bảo bạn đã tắt các tiến trình Node.js cũ).*

### Terminal 3: Chạy Giao Diện Thu Âm (UI)
Giao diện để bạn chọn Microphone, theo dõi biểu đồ âm thanh (VAD) và kết quả dịch thuật realtime.

```powershell
cd voice
npm run dev
```

---

## 3. Cách Test Chức Năng Dịch Thuật

1. Mở trình duyệt vào `http://localhost:5173`.
2. Chọn **Microphone** của bạn, đảm bảo thanh Audio Level nhảy lên khi bạn nói.
3. Chọn **Language Hint: Auto** (hoặc Tiếng Việt/Tiếng Anh).
4. Bấm **▶ Start Session**.
5. Thử nói một câu có trộn lẫn tiếng Anh (Code-switching), ví dụ:
   > *"Anh em nhớ merge pull request trước khi deploy lên production nhé!"*

**Kết quả mong đợi trên UI:**
- **Khi đang nói:** Bạn sẽ thấy chữ nhảy liên tục (Partial) màu xanh lá. Chữ có thể bị phiên âm sai (vd: "mơ cồ pu ri quết").
- **Khi ngắt câu (dừng 0.5s):** 
  - Khối màu xanh lá đậm sẽ xuất hiện, chốt lại bản gốc chuẩn chính tả tiếng Anh: *"Anh em nhớ merge pull request..."*
  - Ngay bên dưới sẽ hiện `⏳ Translating...`.
  - Khoảng 1.5s sau, bản dịch tiếng Anh sẽ xuất hiện: *"Remember to merge the pull request before deploying to production!"* (Kèm cờ 🇺🇸).

---

## 4. Dành cho Backend (NestJS) Tích Hợp Lên Production

Khi đấu nối vào hệ thống chính (NestJS), Backend team cần implement lại logic của `mock-server` như sau:
1. Mở WebSocket Server hứng binary chunk từ client.
2. Nối chunk lại dựa trên event `utterance.start` và `utterance.end`.
3. Khi có `utterance.end`, gom toàn bộ buffer gửi HTTP POST (Multipart) sang STT Python trên port `8001`.
4. Nhận text từ STT, ngay lập tức gọi API `/v1/chat/completions` của FPT (truyền model `Llama-3.3-70B-Instruct`) để dịch.
5. Push ngược event `stt.final` và `translation.final` về qua WebSocket cho client.
