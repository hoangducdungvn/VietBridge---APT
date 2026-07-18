> **Lưu ý:** Đây là tài liệu research/đề xuất ban đầu (nhắc đến Pipecat, Deepgram, OpenAI Realtime Turn Detection). Implementation thực tế của VietBridge KHÔNG dùng Pipecat — EOU được tự xây dựng bằng `VadEngine` + `UtteranceManager` phía client và `TurnsService` phía backend. Xem tài liệu chính thức tại `docs/eou-design-rationale.md`.

# Tìm hiểu và đề xuất sử dụng EOU (End Of Utterance Detection) trong dự án VietBridge

## 1. Giới thiệu

VietBridge là một hệ thống giao tiếp thời gian thực sử dụng **React** ở Frontend và **NestJS** ở Backend, kết hợp với **Pipecat** để xây dựng Voice AI Pipeline.

Trong một hệ thống hội thoại bằng giọng nói, một trong những vấn đề quan trọng nhất là:

> **Làm thế nào để AI biết người dùng đã nói xong và có thể bắt đầu xử lý?**

Nếu không có cơ chế này, AI sẽ rất khó xác định thời điểm phù hợp để chuyển dữ liệu sang Speech-to-Text (STT) và Large Language Model (LLM).

EOU (End Of Utterance Detection) được sử dụng để giải quyết vấn đề này.

---

# 2. EOU là gì?

EOU (End Of Utterance Detection) là cơ chế giúp hệ thống xác định thời điểm **người dùng đã kết thúc một lượt nói (utterance)**.

Nói một cách đơn giản:

- Người dùng đang nói → tiếp tục lắng nghe.
- Người dùng dừng nói trong một khoảng thời gian phù hợp → coi như đã kết thúc câu.
- Backend bắt đầu gửi dữ liệu sang AI để xử lý.

EOU giống như việc AI "đợi người dùng nói xong rồi mới trả lời".

---

# 3. Tại sao dự án cần EOU?

Dự án VietBridge hướng đến xử lý hội thoại theo thời gian thực.

Nếu không có EOU sẽ xảy ra nhiều vấn đề.

## Trường hợp 1: AI trả lời quá sớm

Người dùng:

> Cho tôi hỏi...

(dừng 0.8 giây)

> giá vé đi Đà Nẵng.

Nếu backend không có EOU:

```text
Cho tôi hỏi...

↓

LLM
```

AI sẽ trả lời ngay sau câu:

> Cho tôi hỏi...

trong khi người dùng vẫn chưa nói xong.

Điều này làm trải nghiệm hội thoại trở nên rất kém.

---

## Trường hợp 2: AI trả lời quá muộn

Nếu backend luôn chờ quá lâu mới gửi dữ liệu:

Người dùng:

> Xin chào.

AI sẽ phải đợi thêm vài giây mới phản hồi.

Người dùng sẽ cảm thấy:

- AI bị lag
- AI phản hồi chậm
- Trải nghiệm không tự nhiên

---

# 4. Vai trò của EOU trong hệ thống

EOU giúp backend xác định đúng thời điểm để:

- kết thúc một lượt nói
- gửi audio sang Speech-to-Text
- gửi transcript sang LLM
- bắt đầu sinh câu trả lời
- phát kết quả qua Text-to-Speech

Pipeline tổng quát:

```text
Microphone
      │
      ▼
Frontend
      │
      ▼
NestJS Backend
      │
      ▼
EOU Detection
      │
      ▼
Speech To Text
      │
      ▼
LLM
      │
      ▼
Text To Speech
      │
      ▼
Frontend
```

---

# 5. Vai trò của Backend

Backend chịu trách nhiệm:

- nhận audio stream từ frontend
- quản lý session của từng người dùng
- theo dõi trạng thái nói
- xác định thời điểm kết thúc câu nói
- chuyển dữ liệu sang STT
- gửi transcript sang LLM
- stream phản hồi về frontend

EOU chính là thành phần quyết định **khi nào backend bắt đầu xử lý một lượt hội thoại mới.**

---

# 6. EOU trong Pipecat

Dự án VietBridge sử dụng Pipecat để xây dựng Voice AI Pipeline.

Pipecat đã hỗ trợ pipeline xử lý audio theo thời gian thực và có thể tích hợp với:

- Silero VAD
- WebRTC VAD
- Deepgram Endpoint Detection
- OpenAI Realtime Turn Detection

Do đó nhóm phát triển **không cần tự xây dựng thuật toán EOU từ đầu**.

Backend chỉ cần:

- cấu hình VAD/EOU
- nhận event người dùng bắt đầu nói
- nhận event người dùng kết thúc nói
- gửi transcript sang LLM

Ví dụ pipeline:

```text
Audio

↓

Pipecat

↓

EOU

↓

Speech To Text

↓

LLM

↓

TTS
```

---

# 7. Lợi ích khi sử dụng EOU

## Trải nghiệm hội thoại tự nhiên

AI không ngắt lời người dùng.

---

## Giảm số lượng request gửi lên AI

Nếu gửi mỗi đoạn audio nhỏ lên STT sẽ:

- tăng số request
- tăng chi phí
- tăng độ trễ

EOU chỉ gửi khi người dùng nói xong.

---

## Giảm tải cho Backend

Backend không cần xử lý hàng trăm đoạn audio nhỏ.

Chỉ xử lý khi kết thúc một lượt nói.

---

## Tiết kiệm chi phí

Ít request hơn đồng nghĩa:

- giảm chi phí STT
- giảm chi phí LLM
- giảm băng thông

---

## Dễ mở rộng

EOU có thể kết hợp với:

- Voice Activity Detection (VAD)
- Streaming STT
- OpenAI Realtime API
- Deepgram
- Google Speech
- Azure Speech

---

# 8. Có cần tự xây dựng EOU không?

Đối với dự án VietBridge:

**Không cần.**

Do dự án sử dụng Pipecat nên backend chỉ cần tích hợp các dịch vụ đã hỗ trợ Endpoint Detection hoặc VAD.

Việc tự xây dựng thuật toán EOU chỉ cần thiết khi muốn nghiên cứu AI hoặc tối ưu đặc biệt cho các hệ thống có yêu cầu rất cao như:

- Call Center AI
- Meeting AI nhiều người
- Voice Assistant quy mô lớn

---

# 9. Kết luận

EOU (End Of Utterance Detection) là một thành phần quan trọng trong hệ thống hội thoại bằng giọng nói.

Trong dự án VietBridge, EOU giúp backend xác định chính xác thời điểm người dùng kết thúc một lượt nói để gửi dữ liệu sang STT và LLM.

Nhờ sử dụng Pipecat, nhóm phát triển không cần xây dựng EOU từ đầu mà chỉ cần cấu hình và tích hợp các thành phần đã hỗ trợ sẵn.

Việc sử dụng EOU mang lại nhiều lợi ích như:

- AI phản hồi tự nhiên hơn.
- Không ngắt lời người dùng.
- Giảm số lượng request.
- Tiết kiệm chi phí xử lý.
- Giảm tải cho backend.
- Dễ tích hợp với các dịch vụ AI hiện đại.

EOU vì vậy là một thành phần không thể thiếu để xây dựng trải nghiệm hội thoại bằng giọng nói mượt mà và hiệu quả trong dự án VietBridge.
