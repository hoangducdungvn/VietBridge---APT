# Kiến trúc tích hợp EOU trong VietBridge

## 1. Mục tiêu

EOU (End Of Utterance) xác định khi nào người dùng thực sự kết thúc một lượt nói. Mục tiêu của thay đổi là giảm hai lỗi đã quan sát trong Live Actor:

- Câu dài bị chia thành nhiều `stt.final` ngắn khi người nói dừng tự nhiên giữa câu.
- Audio im lặng hoặc nhiễu cuối câu làm STT sinh nội dung lặp, ví dụ `Đấy. Đấy. Đấy...`.

EOU không thay đổi mô hình nhận dạng giọng nói. Nó thay đổi ranh giới audio được gửi vào mỗi lượt STT và bổ sung lớp kiểm tra kết quả bất thường.

## 2. Kiến trúc trước khi điều chỉnh

```text
Microphone
  -> VoicePipeline
  -> VadEngine (energy, endSilenceMs = 600 ms)
  -> speech_end
  -> turn.end qua Socket.IO
  -> Backend chốt audio của turn
  -> STT final
  -> Translation
  -> Live Actor
```

Vấn đề chính là khoảng nghỉ 600 ms đã đủ phát `speech_end`. Trong tiếng Việt hội thoại, người nói thường nghỉ 600–900 ms để lấy hơi hoặc nghĩ tiếp. Mỗi lần như vậy tạo một turn mới; backend và STT xử lý từng turn độc lập, không ghép các đoạn final lại thành một câu hoàn chỉnh.

## 3. Kiến trúc sau khi thêm EOU

```text
Microphone
  -> VoicePipeline
  -> Silero VAD nếu tải được, energy VAD nếu không tải được
  -> VadEngine state machine
       speechStartThreshold = 0.70
       speechEndThreshold   = 0.22
       minSpeechMs          = 150 ms
       preRollMs            = 400 ms
       endSilenceMs         = 1000 ms
       maxUtteranceMs       = 25000 ms
  -> speech_end: vad_silence | max_duration
  -> turn.end
  -> Backend chốt turn và gọi STT final
  -> STT tiền xử lý audio
  -> STT trả transcript + metadata eou
  -> Bộ lọc hallucination lặp
  -> Translation
  -> Live Actor
```

### Vai trò của từng tầng

| Tầng | Trách nhiệm |
|---|---|
| `voice/VadEngine` | EOU chính, quyết định lúc phát `speech_end` và `turn.end`. |
| `voice/VoicePipeline` | Tải mô hình Silero tại `/models/silero_vad.onnx`; tự rơi về energy VAD nếu tải lỗi. |
| Frontend | Bật `enableSileroVad`; nhận partial để hiển thị trực tiếp và final để lưu transcript. |
| Backend | Quản lý vòng đời turn, gom audio trong một turn và gọi STT final khi nhận `turn.end`. |
| STT EOU | Tín hiệu dự phòng dạng metadata; đo lượng speech, im lặng cuối và lý do endpoint. |
| STT hallucination guard | Loại kết quả có một token/câu bị lặp với mật độ bất thường. |

## 4. Các thông số đã điều chỉnh

| Thông số | Trước | Sau | Tác động |
|---|---:|---:|---|
| `enableSileroVad` | `false` | `true` | Dùng xác suất speech từ Silero thay cho chỉ năng lượng khi model tải thành công. |
| `speechEndThreshold` | `0.28` | `0.22` | Ít coi âm tiết nhỏ hoặc đoạn hụt năng lượng là im lặng hơn. |
| `endSilenceMs` | `600` | `1000` | Giữ các khoảng nghỉ 600–999 ms trong cùng một câu. Đổi lại final xuất hiện muộn thêm tối đa khoảng 400 ms. |
| `maxUtteranceMs` | `20000` | `25000` | Giảm việc cắt câu dài, vẫn giữ biên 5 giây trước giới hạn thực tế 30 giây của Whisper. |
| `preRollMs` | `400` | `400` | Giữ phụ âm đầu và hơi lấy vào trước lúc xác nhận speech. |
| `minSpeechMs` | `150` | `150` | Bỏ tiếng click/pop ngắn nhưng vẫn nhận câu nói ngắn. |

STT có thêm các biến môi trường:

| Biến | Giá trị hiện tại | Vai trò |
|---|---:|---|
| `STT_EOU_ENABLED` | `true` | Bật metadata EOU phía STT. |
| `STT_EOU_FRAME_MS` | `20` | Kích thước frame phân tích. |
| `STT_EOU_END_SILENCE_MS` | `600` | Ngưỡng fallback phía STT. |
| `STT_EOU_MIN_SPEECH_MS` | `160` | Speech tối thiểu để một đoạn đủ điều kiện endpoint. |
| `STT_EOU_MAX_UTTERANCE_MS` | `25000` | Chốt endpoint khi đạt thời lượng tối đa. |
| `STT_EOU_SPEECH_RMS` | theo `SILENCE_RMS` | Ngưỡng năng lượng trung bình. |
| `STT_EOU_SPEECH_PEAK` | theo `SILENCE_PEAK` | Ngưỡng đỉnh biên độ. |

## 5. Dữ liệu EOU trả về từ STT

Mỗi phản hồi STT có thêm trường:

```json
{
  "eou": {
    "is_endpoint": true,
    "reason": "trailing_silence",
    "speech_ms": 1500,
    "trailing_silence_ms": 1000,
    "duration_ms": 2500
  }
}
```

Các lý do có thể là `client_final`, `disabled`, `empty`, `insufficient_speech`, `max_duration`, `trailing_silence` hoặc `speaking`.

## 6. Trạng thái tích hợp hiện tại

Phần EOU chính ở client đã tham gia trực tiếp vào việc đóng turn. Phần EOU trong STT hiện mới là tín hiệu quan sát/dự phòng, chưa phải nguồn quyết định, vì:

1. `remote-stt-transcription.provider.ts` chưa ánh xạ trường `eou` từ phản hồi STT.
2. Pipeline backend chỉ final khi client gửi `turn.end`; backend chưa dùng `eou.is_endpoint` để giữ hoặc đóng turn.
3. STT đang gọi `detect_eou()` sau `_trim_trailing_silence()`. Bước trim có thể xóa chính phần im lặng mà EOU cần đo.
4. Ngưỡng client là 1000 ms nhưng fallback STT vẫn mặc định 600 ms, nên hai tầng chưa đồng nhất.

Do đó, phát biểu chính xác là: hệ thống đã tích hợp client EOU để cải thiện ranh giới turn và thêm STT EOU metadata để mở đường cho fallback; chưa phải EOU hai tầng hoàn chỉnh.

## 7. Điều chỉnh tiếp theo đề xuất

Thứ tự nên thực hiện:

1. Đổi `STT_EOU_END_SILENCE_MS` mặc định từ 600 thành 1000 ms để đồng bộ với client.
2. Tính EOU trên audio trước khi `_trim_trailing_silence()`, còn audio đã trim chỉ dùng để decode STT.
3. Mở rộng contract của STT provider/backend để giữ nguyên trường `eou` và ghi log theo `utterance_id`.
4. Chưa cho backend tự đóng turn bằng metadata STT trong luồng hiện tại, vì STT chỉ nhận request sau khi client đã partial/final. Muốn server EOU thực sự điều khiển turn cần stream hoặc gửi các cửa sổ audio tích lũy lên server.
5. Chạy test mic thật với cùng kịch bản trước/sau, đo số `turn.end`, số `stt.final`, thời gian từ âm cuối tới final và độ đầy đủ của câu.

## 8. Các file triển khai liên quan

- `voice/src/vad/vadEngine.ts`: state machine và ngưỡng VAD/EOU.
- `voice/src/pipeline/voicePipeline.ts`: tải Silero và chuyển event thành vòng đời utterance.
- `frontend/src/presentation/views/MeetingRoomScreen.tsx`: bật Silero VAD.
- `frontend/public/models/silero_vad.onnx`: model VAD được phục vụ cho trình duyệt.
- `stt/stt_service/eou.py`: thuật toán EOU fallback phía STT.
- `stt/stt_service/service.py`: gắn metadata EOU và lọc hallucination lặp.
- `stt/stt_service/config.py`: cấu hình EOU qua biến môi trường.
- `stt/stt_service/test_eou.py`: kiểm thử endpoint và hallucination guard.
