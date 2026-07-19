# Báo Cáo Kỹ Thuật: VietBridge - Pipeline Dịch Real-time (Team xin gửi Ban Giám Khảo)

Dạ kính chào Ban Giám Khảo, đây là báo cáo của Team em ghi lại quá trình làm dự án từ thứ Bảy tới giờ. Bọn em tự viết hơn 3.400 dòng code, liên tục thay đổi kiến trúc để hệ thống chạy ổn định nhất lúc demo. Dưới đây là những nội dung Team đã làm, các kết quả benchmark, cũng như những hạn chế còn tồn đọng.

---

## 1. Kiến trúc hiện tại

Để chạy được luồng real-time, Team ráp nối 4 phần chính:

- **Frontend (Browser)**: Bắt âm thanh từ mic, đưa qua `AudioWorklet` xé nhỏ thành frame 20ms. Dùng Resampler hạ từ 48kHz xuống 16kHz để giảm tải.
- **Lọc tạp âm**: Thêm bộ lọc lowpass/highpass cắt tiếng xì xào và tiếng ù nền để AI nhận diện giọng nói chuẩn hơn.
- **Cắt câu (VAD & EOU)**: Nhúng AI Silero VAD chạy trên trình duyệt để phân biệt tiếng người và khoảng lặng.
- **Server trung gian (Node.js)**: Gateway nhận luồng âm thanh từ web đẩy lên.
- **STT (FPT Whisper Turbo)**: Bọn em dùng API của FPT. Tự viết thêm "Hallucination Filter" (Lọc ảo giác) để chặn model tự đoán chữ sai. Lúc đầu từ điển lỗi Unicode bắt trượt, bọn em đã fix xong.
- **Dịch (Llama-3.3-70B)**: Đẩy text qua Llama dịch sang ngôn ngữ đích.

---

## 2. Quá trình xử lý VAD (Ngắt câu EOU)

Khó khăn lớn nhất của Team là xác định khi nào người dùng nói xong một câu. Bọn em đã thử và gặp các lỗi sau:

- **Ngắt ở 600ms:** Thời gian chờ quá ngắn. Người dùng ngập ngừng lấy hơi là câu bị chém đôi. LLM dịch sai hoàn toàn do mất ngữ cảnh.
- **Ngắt ở 2500ms:** Câu không bị cắt sai, nhưng độ trễ (latency) cộng dồn quá cao. Hệ thống phải chờ thêm 2.5s mới gửi đi dịch, làm hỏng trải nghiệm real-time.
- **Lỗi kẹt mic và nuốt chữ:** Các âm bật hơi đầu câu (như chữ "H") hay bị nuốt do VAD mở không kịp. Nếu tiếng ồn nền (quạt máy) tăng, VAD tưởng có người nói nên kẹt ở trạng thái mở, làm treo luồng dịch vụ.

**Cách giải quyết (Tiered EOU):**
Bọn em tự code lại logic ngắt câu dựa vào ngữ pháp tiếng Việt:
- Chờ mặc định 1000ms.
- Nếu đuôi câu có từ nối ("và", "là", "để", "nhưng"), tự động kéo dài lên 1100ms.
- Nếu đuôi câu là dấu chấm/phẩy, chốt câu ngay ở 480ms.
- Thêm pre-roll buffer 400ms: Lưu sẵn 400ms âm thanh trước khi VAD mở để chống nuốt chữ đầu câu.
- Thêm Dynamic Noise Floor: Nếu ồn quá, ngưỡng ngắt câu tự dâng lên để chống kẹt mic.

---

## 3. Kết quả đo đạc (Benchmark)

Team đã chạy 3 vòng benchmark để chốt kiến trúc:

### Vòng 1: Deepgram Streaming vs FPT Batch
- Deepgram (streaming) xử lý 1 câu tiếng Việt 20 từ mất 6.7s, thỉnh thoảng tự ngắt câu sai. 
- FPT Whisper (batch) mất 784ms trả về đủ câu.
- Chốt: Bỏ Deepgram, dùng FPT.

### Vòng 2: Cắt nhỏ audio vs Gửi 1 lần (Sliding Window)
- Thử băm nhỏ 10s audio thành 3 khúc gọi API 3 lần. Nhận thấy API có overhead mạng cố định ~500ms/lần. Gọi 3 lần làm độ trễ cộng dồn lên 1903ms, còn bị lỗi HTTP 500.
- Chốt: Dùng Sliding Window 6s gửi cả mảng lớn 1 lần, ổn định và nhanh hơn.

### Vòng 3: Giao tiếp bằng WebSocket
- Chuyển giao thức giữa Node.js và Python STT sang WebSocket.
- Đo 5 file wav khác nhau: Overhead mạng tự viết chỉ tốn 2-7ms. Độ trễ tổng thể cho câu 7-10s đạt P50 ~330ms, P90 ~480ms. Đủ mượt để chạy real-time.

---

## 4. Những công nghệ đành bỏ lại

> [!WARNING]
> **Pipecat + FPT Whisper:** Pipecat chuyên cho streaming. Ép luồng batch của FPT vào gây nghẽn cổ chai mất 800ms độ trễ, lại phải viết lại 580 dòng code sang Python. Team đành bỏ.

> [!WARNING]
> **LiveKit EOU Turn Detection Model:** Tài liệu báo "99% chống cắt câu sai". Nhưng model chủ yếu train bằng tiếng Anh và không cho test offline. Team rủi ro cao nên tự code EOU riêng.

> [!WARNING]
> **Pyannote Diarization:** Dự định dùng để chống nhiễu 2 mic (crosstalk). Nhưng Pyannote dùng để bóc tách 1 file ghi âm chung, không hợp bài toán 2 mic chạy song song của Team.
> **Giải quyết:** Dùng Cross-mic Energy Gating. So sánh năng lượng RMS giữa 2 mic. Nếu `RMS(Mic A) > RMS(Mic B) + 15dB` thì giảm âm (mute) mic B. Chỉ 30 dòng code toán học, chạy 0ms độ trễ.

---

## 5. Giải pháp né đứt mạng lúc Demo

Wifi ở các sự kiện thường hay rớt gói tin. Dùng WebSocket (TCP) mất 1 gói là âm thanh giật cục. 
Team đang chuyển sang dùng **WebRTC (UDP) qua máy chủ LiveKit**. Chỉ mượn đường truyền UDP để chống vấp mạng, không dùng AI của LiveKit.

---

## 6. Hạn chế hiện tại và Hướng phát triển

Mặc dù hệ thống đã chạy được end-to-end, nhưng do thời gian làm hackathon ngắn, Team vẫn còn các hạn chế sau:

### Hạn chế
- **Công nghệ (Rule-based EOU):** Logic cắt câu bằng if-else dựa trên từ nối giải quyết tốt vấn đề trước mắt, nhưng khó scale sang đa ngôn ngữ vì phải viết lại luật ngữ pháp cho từng tiếng.
- **Thời gian (Chưa có cơ chế Offline Recovery):** Nếu rớt mạng ngang chừng, hệ thống chưa tự nối lại và nhồi lại phần âm thanh bị mất mượt mà 100%. 
- **Phần cứng (Phụ thuộc Cloud):** Hiện tại STT và LLM đang gọi API lên FPT Cloud. Nếu lượng người dùng tăng đột biến, overhead network và giới hạn call API sẽ là cổ chai.

### Hướng phát triển tương lai
- **Thay Rule-based bằng AI:** Áp dụng Sentence Completeness Prediction (như BERT-tiny) để AI tự đoán câu đã trọn vẹn nghĩa hay chưa thay vì check if-else.
- **Triển khai Edge Computing:** Kéo model STT nhỏ (như Whisper-tiny) chạy thẳng dưới máy client bằng WebGPU để loại bỏ hoàn toàn độ trễ gửi file qua mạng, chỉ gửi text lên LLM.
- **Acoustic Echo Cancellation (AEC):** Áp dụng thuật toán triệt tiêu tiếng vọng chuẩn công nghiệp thay vì dùng thuật toán RMS Mute thủ công hiện tại khi có thiết bị phần cứng đồng bộ.

Dạ thưa Ban Giám Khảo, Team ưu tiên giữ lại một luồng chạy ổn định và thực dụng nhất thay vì dùng nhiều framework phức tạp, cốt để ra bản dịch nhanh nhất. Cảm ơn Ban Giám Khảo đã đọc báo cáo của Team em ạ!
