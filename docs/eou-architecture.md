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
       endSilenceMs         = 1500 ms (meeting client)
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
| `endSilenceMs` | `600` | `1500` trong meeting | Giữ các khoảng nghỉ tự nhiên dưới 1,5 giây trong cùng một câu. Đổi lại final xuất hiện muộn hơn sau khi người dùng dừng nói. |
| `maxUtteranceMs` | `20000` | `25000` | Giảm việc cắt câu dài, vẫn giữ biên 5 giây trước giới hạn thực tế 30 giây của Whisper. |
| `preRollMs` | `400` | `400` | Giữ phụ âm đầu và hơi lấy vào trước lúc xác nhận speech. |
| `minSpeechMs` | `150` | `150` | Bỏ tiếng click/pop ngắn nhưng vẫn nhận câu nói ngắn. |

STT có thêm các biến môi trường:

| Biến | Giá trị hiện tại | Vai trò |
|---|---:|---|
| `STT_EOU_ENABLED` | `true` | Bật metadata EOU phía STT. |
| `STT_EOU_FRAME_MS` | `20` | Kích thước frame phân tích. |
| `STT_EOU_END_SILENCE_MS` | `1500` | Ngưỡng quan sát đồng bộ với meeting client. |
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

Phần EOU chính ở client tham gia trực tiếp vào việc đóng turn. Frontend deploy đóng gói đủ ONNX Runtime để Silero thực sự khởi tạo, hiển thị `AI VAD` hoặc `Basic VAD`, và meeting dùng `endSilenceMs = 1500 ms` để giữ khoảng ngập ngừng tự nhiên.

Silero v5 dùng contract `input/state/sr -> output/stateN` và cửa sổ 512 mẫu tại 16 kHz. Capture tạo frame 320 mẫu, vì vậy `VadEngine` ghép PCM liên tục thành cửa sổ 512 mẫu thay vì zero-pad hoặc bỏ frame. Nếu model inference lỗi liên tiếp ba lần, client tự chuyển sang energy VAD và cập nhật badge `Basic VAD`; luồng microphone/STT vẫn tiếp tục hoạt động.

AudioWorklet được nối tới `AudioContext.destination` qua một gain node có volume bằng `0`. Kết nối câm này giữ Web Audio pull graph hoạt động ổn định trên Chromium nhưng không phát lại microphone. Khi Silero hoạt động, hệ thống giữ hai cửa sổ xác suất Silero và energy độc lập thay vì lấy `max` giữa hai thang đo: speech bắt đầu/tiếp tục khi Silero vượt `0.50` hoặc energy vượt ngưỡng bắt đầu, còn trạng thái kết thúc chỉ mở khi Silero dưới `0.35` và energy không còn tín hiệu speech mạnh. Cách kết hợp này vừa cho phép energy cứu trường hợp Silero quá bảo thủ, vừa tránh energy nền khoảng `0.5` che mất tín hiệu EOU của Silero.

VoicePipeline không chặn microphone để chờ tải WASM/ONNX. Energy VAD bắt đầu cùng capture ngay lập tức; Silero được tải nền và nâng cấp backend khi sẵn sàng. Vì vậy mạng chậm hoặc cold cache không còn tạo khoảng thời gian dài chỉ thấy Socket.IO `2/3` mà không có `turn.start`.

STT tính EOU trên audio đã normalize nhưng chưa trim, sau đó Backend ánh xạ metadata sang camelCase và giữ nó trong `stt.partial`/`stt.final`. Metadata này phục vụ quan sát ranh giới câu; Pipeline vẫn chỉ final khi client gửi `turn.end`, chưa dùng `eou.isEndpoint` để tự đóng turn.

Do đó, phát biểu chính xác là: hệ thống có client EOU hoàn chỉnh cho luồng realtime và có STT EOU metadata xuyên Backend để chẩn đoán; STT EOU vẫn là tín hiệu advisory, không phải nguồn điều khiển turn thứ hai.

## 7. Điều chỉnh tiếp theo đề xuất

Thứ tự nên thực hiện:

1. Chạy test mic thật với cùng kịch bản trước/sau, đo số `turn.end`, số `stt.final`, thời gian từ âm cuối tới final và độ đầy đủ của câu.
2. Theo dõi badge VAD; bản deploy chính thức phải hiển thị `AI VAD`, không phải `Basic VAD`.
3. Chưa cho backend tự đóng turn bằng metadata STT trong luồng hiện tại, vì STT chỉ nhận request sau khi client đã partial/final. Muốn server EOU thực sự điều khiển turn cần stream hoặc gửi các cửa sổ audio tích lũy lên server.
4. Nếu người dùng vẫn thường xuyên nghỉ lâu hơn 1.5 giây, cân nhắc cấu hình ngưỡng theo UX thay vì tăng cứng cho mọi thiết bị.

## 8. Các file triển khai liên quan

- `voice/src/vad/vadEngine.ts`: tính và làm mượt riêng xác suất Energy/Silero.
- `voice/src/vad/vadStateMachine.ts`: fusion hai tín hiệu và state machine VAD/EOU.
- `voice/src/pipeline/voicePipeline.ts`: tải Silero và chuyển event thành vòng đời utterance.
- `voice/src/vad/sileroVad.ts`: ánh xạ ONNX Runtime `.mjs`/`.wasm` sang URL asset có hash do Vite phát hành.
- `frontend/src/presentation/views/MeetingRoomScreen.tsx`: bật Silero VAD.
- `frontend/public/models/silero_vad.onnx`: model VAD được phục vụ cho trình duyệt.
- `stt/stt_service/eou.py`: thuật toán EOU fallback phía STT.
- `stt/stt_service/service.py`: gắn metadata EOU và lọc hallucination lặp.
- `stt/stt_service/config.py`: cấu hình EOU qua biến môi trường.
- `stt/stt_service/test_eou.py`: kiểm thử endpoint và hallucination guard.
