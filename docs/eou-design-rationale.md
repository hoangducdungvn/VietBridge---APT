# EOU (End Of Utterance Detection) trong VietBridge — Thiết kế & Lý do sử dụng

> Tài liệu này mô tả implementation THẬT trong codebase hiện tại. Xem thêm
> [`docs/eou-initial-research.md`](./eou-initial-research.md) cho hướng
> nghiên cứu ban đầu (Pipecat) — **không được áp dụng trong code hiện tại**.

## 1. Dự án VietBridge là gì

VietBridge là hệ thống giao tiếp giọng nói thời gian thực, gồm các thành phần chính:

- `voice/` — client-side pipeline: thu âm, VAD, phát hiện utterance, đóng gói, gửi qua WebSocket.
- `backend/` — NestJS, quản lý session/participant/turn, điều phối STT & translation provider.
- `stt-service/`, `stt/` — dịch vụ speech-to-text (có benchmark codeswitching Việt-Anh).
- `translation-service/` — dịch vụ dịch văn bản.
- `frontend/` — giao diện người dùng (React).

## 2. Kiến trúc thư mục liên quan đến EOU

```text
voice/src/
├── vad/
│   ├── vadEngine.ts        # State machine phát hiện speech start/end
│   └── sileroVad.ts        # Backend AI (Silero, ONNX Runtime Web)
├── utterance/
│   └── utteranceManager.ts # Quản lý vòng đời một lượt nói (utterance)
└── pipeline/
    └── voicePipeline.ts    # Nối capture → VAD → utterance → WebSocket

backend/src/turns/
├── turn-state-machine.ts   # Transition rules cho trạng thái turn
├── turn.store.ts           # Lưu trữ turn theo session/participant
└── turns.service.ts        # Xử lý start/append/end turn, gọi STT
```

## 3. Vấn đề gặp phải

Trong hội thoại giọng nói thời gian thực, hệ thống cần biết chính xác **khi nào người dùng đã nói xong** để:

- Không gửi audio liên tục lên server khi không ai nói → tốn băng thông, tốn chi phí STT.
- Không cắt audio quá sớm giữa câu → mất nghĩa, sai transcript.
- Không chờ quá lâu → trải nghiệm bị delay, cảm giác "AI lag".
- Xử lý các trường hợp bất thường: mất mic, mất kết nối, câu nói quá dài (vượt giới hạn STT).

## 4. Giải pháp: EOU tự xây dựng, chạy phía client

VietBridge **không dùng Pipecat hay dịch vụ Endpoint Detection có sẵn** (khác với đề xuất ban đầu trong `eou-initial-research.md`). Thay vào đó, nhóm tự xây dựng:

- **`VadEngine`**: state machine 4 trạng thái `IDLE → POSSIBLE_SPEECH → SPEAKING → POSSIBLE_END → IDLE`, hỗ trợ 2 backend:
  - `energy` (mặc định): tính xác suất giọng nói từ năng lượng frame (Energy) + Zero-Crossing Rate, dùng sigmoid trên tỷ lệ log so với noise floor thích nghi (EMA).
  - `silero`: model neural network Silero VAD (~1.8MB) chạy qua ONNX Runtime Web ngay trong browser, chính xác hơn trong môi trường nhiều tạp âm (TV, người nói khác). Tự động fallback về `energy` nếu load model thất bại.
- **`UtteranceManager`**: lắng nghe event `speech_start`/`speech_end` từ VAD, quản lý vòng đời một "utterance" — bao gồm continuation chain khi câu nói vượt `max_duration` (phải cắt nhưng vẫn nối tiếp về mặt ngữ nghĩa), và tính toán chất lượng audio tổng hợp (SNR, clipping, noise level) để gửi kèm.
- **`VoicePipeline`**: điều phối toàn bộ luồng `AudioWorklet → Resampler → VadEngine → UtteranceManager → WebSocket`, bao gồm cơ chế pre-roll buffer (giữ ~250ms audio trước thời điểm phát hiện speech) để không mất phần đầu câu nói khi VAD phát hiện trễ.

## 5. EOU là gì

EOU (End Of Utterance Detection) là cơ chế xác định thời điểm người dùng **kết thúc một lượt nói**. Trong VietBridge, đây không phải một khái niệm trừu tượng mà là kết quả cụ thể của state machine trong `VadEngine`: khi xác suất giọng nói trung bình (trên cửa sổ trượt) giảm dưới `speechEndThreshold` và duy trì đủ `endSilenceMs` (mặc định 600ms), một event `speech_end` được phát ra với lý do (`vad_silence` hoặc `max_duration`).

## 6. Vai trò của EOU trong hệ thống

EOU là ranh giới quyết định vòng đời một turn. Cụ thể trong VietBridge:

1. `VadEngine.processFrame()` chạy trên từng frame audio 20ms, phát hiện `speech_start`/`speech_end`.
2. `UtteranceManager` nhận các event này, gọi callback `onUtteranceStart`/`onUtteranceEnd`.
3. `VoicePipeline` dùng callback đó để gửi message `utterance.start`/`utterance.end` qua WebSocket lên backend.
4. Backend (`TurnsService`) nhận tín hiệu này để chuyển trạng thái turn: `started → streaming → processing → completed`, sau đó gọi STT trên toàn bộ audio đã tích lũy của turn đó.

Cần lưu ý: `TurnsService` không tự chạy bất kỳ thuật toán phát hiện giọng nói hay timer nào. Nó hoàn toàn thụ động — chỉ chuyển trạng thái turn khi nhận được lệnh gọi cụ thể (`appendAudio`, `endTurn`) từ tầng WebSocket/API, vốn được kích hoạt bởi tín hiệu `utterance.start`/`utterance.end` do client gửi lên. Toàn bộ "trí thông minh" của EOU nằm ở phía client (`voice/`), không nằm ở backend.

Nói cách khác: **client quyết định khi nào một câu nói kết thúc; backend chỉ phản ứng theo tín hiệu đó** — backend hoàn toàn không có logic phát hiện giọng nói (không timer, không phân tích audio), điều này thể hiện rõ trong `turn-state-machine.ts`: transition chỉ được kích hoạt từ bên ngoài gọi vào (`appendAudio`, `endTurn`), không có logic tự động dựa trên thời gian im lặng.

## 7. EOU được triển khai ở đâu và tại sao ở đó

| Vị trí | Vai trò | Lý do đặt ở đó |
|---|---|---|
| `voice/src/vad/vadEngine.ts` | Phát hiện speech start/end theo từng frame | Cần xử lý audio thô độ trễ thấp (20ms/frame), thực hiện ngay tại nguồn thu âm (browser) trước khi audio rời client — tránh gửi audio "rác" (khoảng lặng) lên mạng |
| `voice/src/vad/sileroVad.ts` | Backend AI tùy chọn cho VAD | Chạy WASM ngay trong browser, không cần round-trip server, giữ được độ trễ thấp trong khi tăng độ chính xác |
| `voice/src/utterance/utteranceManager.ts` | Quản lý vòng đời một lượt nói, xử lý continuation khi quá dài | Cần trạng thái liên tục xuyên suốt nhiều frame/chunk audio, đặt cạnh VAD để phản ứng ngay khi có event, không phải chờ round-trip backend |
| `voice/src/pipeline/voicePipeline.ts` | Điều phối toàn bộ pipeline, gửi tín hiệu utterance qua WebSocket | Là điểm nối duy nhất giữa xử lý audio client và giao thức mạng — nơi hợp lý để quyết định khi nào gửi gì lên server |
| `backend/src/turns/turns.service.ts` | Nhận tín hiệu, quản lý trạng thái turn, gọi STT | Backend không cần (và không nên) lặp lại việc phát hiện giọng nói — chỉ cần một state machine đơn giản, dễ test, phản ứng theo sự kiện từ client |

**Lý do kiến trúc tổng thể**: đặt EOU ở client giúp giảm tải mạng (không stream audio khi im lặng), giảm độ trễ (phát hiện ngay tại nguồn thay vì chờ server phân tích), và giữ backend đơn giản, chỉ tập trung vào nghiệp vụ (turn lifecycle, STT, translation) thay vì xử lý tín hiệu audio thời gian thực.

## 8. Tác dụng mang lại cho dự án

- **Giảm băng thông & chi phí STT**: audio được buffer liên tục nhưng chỉ được gửi (flush) lên backend khi utterance đang active — thấy rõ ở `VoicePipeline.flushChunkBuffer()`: chỉ gửi khi `utteranceManager.isActive()`.
- **Không mất đầu câu nói**: cơ chế pre-roll buffer (giữ ~250ms audio trước khi VAD xác nhận speech) đảm bảo không cắt mất âm tiết đầu tiên.
- **Chịu lỗi tốt**: khi mất mic (`source_lost`) hoặc kết thúc phiên (`session_end`), `UtteranceManager.forceClose()` đảm bảo utterance đang mở luôn được đóng đúng cách, không để backend chờ vô thời hạn.
- **Xử lý câu nói dài**: cơ chế `continuationId` cho phép chia một câu nói vượt `maxUtteranceMs` (25s) thành nhiều utterance nối tiếp về mặt ngữ nghĩa, phù hợp với giới hạn kỹ thuật của STT (ví dụ Whisper giới hạn 30s).
- **Tách biệt trách nhiệm rõ ràng**: client lo phát hiện giọng nói, backend lo nghiệp vụ turn — giúp `turn-state-machine.ts` cực kỳ đơn giản, dễ test (`turn-state-machine.spec.ts`), dễ maintain.
- **Có thể nâng cấp độ chính xác mà không đổi kiến trúc**: chuyển từ VAD năng lượng (`energy`) sang VAD neural network (`silero`) chỉ là đổi backend trong `VadEngine`, không ảnh hưởng đến `UtteranceManager` hay backend.
