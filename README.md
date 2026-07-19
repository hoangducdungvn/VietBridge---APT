# VietBridge

> **[📖 Xem Hướng Dẫn Tích Hợp Chi Tiết (Integration Guide)](./docs/integration-guide.md)**
> Đọc hướng dẫn này để biết cách thiết lập, khởi chạy và test toàn bộ luồng âm thanh STT + Dịch thuật mới nhất trên FPT Cloud.
>
> **[🏗️ Xem Báo Cáo Kỹ Thuật & Kiến Trúc Hệ Thống (Technical & Architecture Report)](./ARCHITECTURE.md)**
> Báo cáo chi tiết gửi Ban Giám Khảo về kiến trúc luồng dữ liệu thời gian thực (Audio Pipeline, Silero VAD, FPT Whisper Turbo STT, Llama-3.3 Translation) cùng kết quả benchmark của hệ thống.

VietBridge is organized as a monorepo containing 4 independent applications that work together to provide real-time meeting transcription and translation.

## Workspace

- `frontend/`: React 18, TypeScript, Vite, TailwindCSS, Zustand, and Socket.IO client
- `backend/`: NestJS API and real-time meeting services

## Frontend

```bash
cd frontend
npm install
npm run dev
```

## Backend

```bash
cd backend
npm install
npm run start:dev
```

Each application owns its package files, environment example, tests, and build configuration.
