# Deploy VietBridge trên LAN để test hai microphone

## Mô hình chạy

```text
Thiết bị A/B
  → HTTPS https://<LAN_IP>:5173 (Vite + REST/Socket.IO proxy)
  → HTTP Backend 127.0.0.1:3000
  → HTTP STT 127.0.0.1:8001
```

Chỉ máy host chạy source code. Hai thiết bị cùng Wi-Fi mở chung URL HTTPS. Mic của mỗi thiết bị capture liên tục và hai participant có thể STT đồng thời; không còn `TURN_BUSY`.

Cấu hình đang dùng IP Wi-Fi `192.168.10.19`. Certificate cũng chứa IP dự phòng `10.180.172.188`. Nếu Windows đổi IP, cập nhật ba URL frontend và `CORS_ORIGIN`, sau đó restart Backend và Frontend.

## 1. Chuẩn bị HTTPS một lần

Tìm IPv4 của máy host:

```powershell
ipconfig
```

Cài `mkcert`, sau đó chạy tại thư mục repository:

```powershell
mkcert -install
New-Item -ItemType Directory -Force .\frontend\certs
mkcert -key-file .\frontend\certs\lan-key.pem -cert-file .\frontend\certs\lan-cert.pem 10.180.172.188 192.168.10.19 localhost 127.0.0.1
mkcert -CAROOT
```

Nếu vừa cài bằng `winget` mà terminal báo không tìm thấy `mkcert`, đóng và mở PowerShell mới để PATH được cập nhật.

Cài/trust file `rootCA.pem` từ thư mục `mkcert -CAROOT` trên thiết bị thứ hai. Không commit `rootCA.pem`, private key, certificate hoặc file `.env`.

## 2. Cấu hình local

`frontend/.env`:

```env
VITE_BACKEND_API_URL=https://192.168.10.19:5173
VITE_BACKEND_WS_URL=https://192.168.10.19:5173
VITE_PUBLIC_APP_URL=https://192.168.10.19:5173
VITE_SUPPORTED_LANGUAGES=vi,en
LAN_HTTPS_CERT_PATH=certs/lan-cert.pem
LAN_HTTPS_KEY_PATH=certs/lan-key.pem
LAN_PROXY_BACKEND_URL=http://127.0.0.1:3000
```

`backend/.env`:

```env
NODE_ENV=development
HOST=127.0.0.1
PORT=3000
CORS_ORIGIN=https://192.168.10.19:5173
STT_PROVIDER=remote
STT_BASE_URL=http://127.0.0.1:8001
STT_START_TIMEOUT_MS=5000
STT_FINAL_TIMEOUT_MS=10000
TRANSLATION_PROVIDER=mock
LOG_TRANSCRIPTS=false
```

Trong `stt/.env`, giữ `FPT_API_KEY`, `GROQ_API_KEY`, `STT_HOST=127.0.0.1` và `STT_PORT=8001`. Không đổi `GROQ_API_KEY` thành `ENGLISH_STT_API_KEY` vì code hiện tại đọc đúng tên `GROQ_API_KEY`.

Nếu Windows Firewall chặn, chỉ mở inbound TCP `5173`; không expose `3000` hoặc `8001` vì Vite proxy xử lý REST và Socket.IO.

## 3. Chạy ba terminal trên máy host

Terminal 1 — STT:

```powershell
cd D:\VietBridge---APT\stt
.\.venv\Scripts\Activate.ps1
pip install -r .\stt_service\requirements.txt
python -m stt_service.server
```

Terminal 2 — Backend:

```powershell
cd D:\VietBridge---APT\backend
npm install
npm run start:dev
```

Terminal 3 — Frontend HTTPS:

```powershell
cd D:\VietBridge---APT\frontend
npm install
npm run dev
```

Kiểm tra trên máy host:

```text
http://127.0.0.1:8001/health
http://127.0.0.1:3000/health
https://192.168.10.19:5173/health
```

## 4. Test hai thiết bị

1. Cả hai thiết bị mở `https://192.168.10.19:5173` và cho phép microphone.
2. Thiết bị A tạo phòng với tiếng Việt; thiết bị B mở invite và join với tiếng Anh.
3. Xác nhận cả hai hiển thị Socket.IO `Connected` và mic tự bật.
4. A nói, B nói, rồi cho cả hai nói đồng thời. Không bên nào được nhận `TURN_BUSY`; transcript Việt và Anh phải cùng được broadcast.
5. Dùng tai nghe hoặc đặt hai thiết bị xa nhau để tránh một giọng nói bị cả hai mic thu lại.
6. End Meeting và xác nhận transcript/in-memory audio được xóa.

Nếu thiết bị thứ hai không xin quyền mic, certificate/CA chưa được trust hoặc URL không nằm trong certificate. Nếu `/health` qua port `5173` lỗi, kiểm tra Backend trước rồi kiểm tra Vite proxy và Firewall.

Đây vẫn là local development: Backend và STT chỉ bind loopback trên máy host, còn Vite mở HTTPS cho LAN. Trên chính máy host nên dùng cùng URL `https://192.168.10.19:5173` để invite link và Socket.IO giống hệt thiết bị B; certificate cũng cho phép mở `https://localhost:5173`, nhưng public invite vẫn dùng URL LAN trong `.env`.
