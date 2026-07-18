# Codebase Overview

## 1. Cấu trúc thư mục
Dự án được cấu trúc theo dạng backend repository dựa trên framework NestJS (Node.js). Cây thư mục chính (bỏ qua `node_modules`, `.git`):

```text
.
├── backend/
│   ├── src/
│   │   ├── app.module.ts        # Root module
│   │   ├── main.ts              # Entry point
│   │   ├── audio/               # Xử lý âm thanh
│   │   ├── auth/                # Xác thực và phân quyền
│   │   ├── common/              # Các thành phần dùng chung (filters, pipes...)
│   │   ├── config/              # Validation biến môi trường
│   │   ├── context/             # Quản lý ngữ cảnh (context) hội thoại
│   │   ├── health/              # API kiểm tra health check
│   │   ├── messaging/           # Giao tiếp message/events
│   │   ├── observability/       # Logging, metrics, tracing
│   │   ├── participants/        # Quản lý người tham gia
│   │   ├── pipeline/            # Điều phối xử lý chính (pipeline audio -> text -> translate)
│   │   ├── providers/           # Các dịch vụ STT, Translation
│   │   ├── realtime/            # Xử lý thời gian thực (websocket)
│   │   ├── sessions/            # Quản lý phiên giao tiếp (sessions)
│   │   └── turns/               # Quản lý lượt hội thoại (turns)
│   ├── test/                    # Chứa mã e2e tests
│   ├── package.json             # Khai báo dependency và script
│   └── tsconfig.json            # Cấu hình TypeScript
└── README.md
```

## 2. Entry point của ứng dụng
- **File chạy chính:** `backend/src/main.ts`
- **Cách chạy:** 
  - Chạy dev server: `npm run start:dev` (chạy qua `nest start --watch`)
  - Chạy môi trường build: `npm run build` sau đó `npm run start:prod` (chạy qua `node dist/main`)
- **Khởi tạo:** `main.ts` dùng `NestFactory` tạo app dựa vào `AppModule`, cài đặt logger `StructuredLogger` tùy chỉnh, kích hoạt CORS, và khởi động server HTTP dựa trên cổng chỉ định ở biến môi trường.

## 3. Danh sách các module/package chính và vai trò
- `AppModule` (`app.module.ts`): Root module, gom tất cả các module con lại với nhau và khai báo global pipes/filters.
- `AudioModule`: Chuyên xử lý audio streaming và bộ nhớ đệm (buffers).
- `AuthModule`: Cung cấp cơ chế xác thực.
- `ConfigModule` (`config/`): Load cấu hình và validate định dạng biến môi trường bằng custom script (`environment.validation.ts`).
- `ContextModule`: Lưu trữ, xử lý thông tin ngữ cảnh để hỗ trợ dịch thuật.
- `HealthModule`: Khai báo controller phục vụ monitor trạng thái service.
- `MessagingModule`: Xử lý hệ thống gửi nhận message hoặc broker.
- `ObservabilityModule`: Cung cấp `StructuredLogger` dùng thay thế cho logger mặc định của NestJS, hỗ trợ việc ghi log có cấu trúc.
- `PipelineModule`: Luồng xử lý chính kết hợp âm thanh, STT (Speech To Text) và Translation lại với nhau.
- `ProvidersModule` (`providers/stt`, `providers/translation`): Module cung cấp adapter giao tiếp với các dịch vụ lõi (có thể config dạng `mock`, `local` hoặc `remote`).
- `RealtimeModule`, `SessionsModule`, `ParticipantsModule`, `TurnsModule`: Quản lý logic về realtime (có thể qua Websocket), phiên họp, thành viên và các lượt đối thoại.

## 4. Các dependency quan trọng đang dùng
Dự án viết bằng TypeScript trên nền tảng NestJS thay vì Golang (không có `go.mod`), danh sách lấy từ `package.json`:
- **Core NestJS:** `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `@nestjs/config`. Cung cấp Dependency Injection, HTTP Server, quản lý module và cấu hình.
- **Validation:** `class-validator`, `class-transformer`. Được dùng để định dạng, validate Data Transfer Objects (DTO) và parse config.
- **RxJS:** `rxjs`. Xử lý luồng sự kiện (streams) không đồng bộ, một thành phần lõi đi kèm với NestJS.
- **Testing:** `jest`, `supertest` phục vụ unit và e2e test.

## 5. Database/storage đang dùng gì và cách kết nối
- **Chưa xác định được, cần kiểm tra thêm.** 
- Dựa vào `backend/src/config/environment.validation.ts` và `app.module.ts`, hiện tại codebase hoàn toàn chưa chứa bất kỳ file thiết lập nào (như TypeORM, Prisma, Mongoose, v.v) cũng như không có biến môi trường cấu hình đường dẫn database. Có khả năng dữ liệu mới dừng lại ở in-memory, lưu qua file, hoặc storage sẽ được triển khai ở branch/commit sau.

## 6. Danh sách các API endpoint hiện có
Do dự án mới dựng phần khung skeleton, hiện tại chỉ có một endpoint HTTP thuần túy được khai báo (sử dụng decorator `@Controller`):
- `GET /health` : Trả về thông tin health check của hệ thống (xử lý trong file `backend/src/health/health.controller.ts`).

## 7. Convention đang thấy trong code
- **Naming Convention:**
  - File/Folder đặt tên dạng kebab-case (VD: `environment.validation.ts`, `health.controller.ts`, `global-exception.filter.ts`).
  - Lớp (Class) và Type/Interface dùng PascalCase (VD: `HealthController`, `HealthResponse`).
  - Variable/Method/Property dùng camelCase.
- **Error Handling:** Sử dụng filter tập trung thay vì try/catch cục bộ (đã khai báo `GlobalExceptionFilter` cấu hình mức toàn cục bằng `APP_FILTER` trong `app.module.ts`).
- **Data Validation:** Sử dụng pipe toàn cục (`ApplicationValidationPipe` - `APP_PIPE`) kết hợp với `class-validator`. Các biến môi trường được viết function validate rõ ràng.
- **Testing:** Đặt các test file có dạng `*.spec.ts` (unit) hoặc `*.e2e-spec.ts` (e2e). Chạy bằng test runner Jest.
- **Logging:** Dùng Custom Logger có cấu trúc (`StructuredLogger`), log theo định dạng object (có key như `event`, `environment`, `status`) cho phép dễ dàng tích hợp ELK/Datadog về sau.
