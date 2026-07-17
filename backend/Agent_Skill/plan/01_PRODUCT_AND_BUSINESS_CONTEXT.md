# 1. Product & Business Context

## 1.1 Bài toán

Trong các cuộc họp trực tiếp giữa đoàn Việt Nam và đoàn Singapore, hai bên có thể không sử dụng thành thạo cùng một ngôn ngữ.

VietBridge hỗ trợ dịch hai chiều:

- Tiếng Việt → Tiếng Anh.
- Tiếng Anh → Tiếng Việt.

Hệ thống phải phản hồi gần thời gian thực, giữ đúng ý nghĩa, số liệu, tên riêng và thuật ngữ kinh doanh.

## 1.2 Mô hình sản phẩm đã chốt

Mỗi người dùng một thiết bị riêng:

- Người A dùng thiết bị A và nói tiếng Việt.
- Người B dùng thiết bị B và nói tiếng Anh.
- Hai thiết bị tham gia cùng một translation session bằng room code.
- Hai bên vẫn đang họp trực tiếp trong cùng không gian.
- VietBridge không truyền âm thanh hay video giữa hai thiết bị.

Luồng:

```text
Người A nói tiếng Việt trên thiết bị A
→ Thiết bị A gửi audio tới Backend
→ Backend chuyển audio tới STT tiếng Việt
→ Backend nhận transcript
→ Backend gửi transcript + context tới Translation
→ Backend nhận bản dịch tiếng Anh
→ Backend gửi cả câu gốc và câu dịch về thiết bị A và B
```

Chiều tiếng Anh hoạt động tương tự.

## 1.3 Tại sao chọn hai thiết bị

### Lợi ích

- Mỗi người có micro riêng.
- Backend biết rõ participant nào đang nói.
- Mỗi participant có source language được cấu hình sẵn.
- Không cần tự đoán người nói.
- Không cần speaker diarization trong MVP.
- Mỗi người có thể kiểm tra cả transcript gốc và bản dịch.
- Trải nghiệm rõ ràng hơn một màn hình dùng chung.
- Dễ mở rộng thành nhiều participant trong tương lai.

### Rủi ro

Hai thiết bị trong cùng phòng có thể cùng thu một giọng nói.

Giải pháp MVP:

- Dùng push-to-talk.
- Backend chỉ cho phép một active speaker tại một thời điểm.
- Participant còn lại không được mở turn mới khi session đang có turn active.

## 1.4 Vì sao không lạc đề

Đề bài yêu cầu một real-time translator cho in-person business meeting.

Mô hình này vẫn đúng đề vì:

- Cuộc họp vẫn diễn ra trực tiếp.
- Sản phẩm cốt lõi vẫn là dịch song ngữ gần thời gian thực.
- Hai thiết bị chỉ là cách thu âm và hiển thị tốt hơn.
- Không xây nền tảng họp online.

## 1.5 Cách định vị sản phẩm

Không gọi VietBridge là:

> Nền tảng họp trực tuyến có AI dịch.

Nên gọi là:

> Hệ thống phiên dịch cuộc họp đa thiết bị, đồng bộ transcript song ngữ theo ngữ cảnh trong cùng một phiên dịch trực tiếp.

## 1.6 Giá trị người dùng

Người nói cần nhìn thấy:

- Chính xác hệ thống nghe được gì.
- Bản dịch được tạo ra là gì.
- Câu nào thuộc về ai.
- Trạng thái đang nghe, đang dịch hay đã hoàn tất.

Người nghe cần:

- Bản dịch nhanh.
- Câu gốc để đối chiếu khi cần.
- Nội dung theo đúng thứ tự hội thoại.
- Ít thao tác làm gián đoạn cuộc họp.
