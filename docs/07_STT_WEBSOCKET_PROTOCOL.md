# STT WebSocket Message Protocol Draft

Tài liệu này là đặc tả contract ở mức protocol, chưa phải code. Mục tiêu là chốt hình dạng message giữa NestJS backend và `stt-service` Python trước khi implement.

## 0. Phạm vi và nguyên tắc chung

- `StreamingSttProvider` hiện có các thao tác:
  - `startTurn(...)`
  - `sendAudio(...)`
  - `finishTurn(...)`
  - `cancelTurn(...)`
  - `closeSession(...)`
- Các event trả về từ provider:
  - `SttPartialResult`
  - `SttFinalResult`
  - `SttProviderError`
  - `SttDisconnectEvent`
- Contract này giả định:
  - Message control đi qua WebSocket dưới dạng JSON text frame.
  - Audio chunk đi qua WebSocket dưới dạng binary frame riêng, không nhúng audio bytes vào JSON.

## 1. Backend -> stt-service: control messages

### 1.1 `start_turn`

Mục đích: báo cho `stt-service` bắt đầu xử lý một turn mới.

JSON shape đề xuất:

```json
{
  "type": "start_turn",
  "sessionId": "string",
  "turnId": "string",
  "participantId": "string",
  "language": "string",
  "audioConfig": {
    "channels": 1,
    "codec": "pcm_s16le",
    "sampleRate": 16000
  }
}
```

Mapping sang `stt.types.ts`:

- `sessionId` -> `SttStartTurnInput.sessionId`
- `turnId` -> `SttStartTurnInput.turnId`
- `participantId` -> `SttStartTurnInput.participantId`
- `language` -> `SttStartTurnInput.language`
- `audioConfig` -> `SttStartTurnInput.audioConfig`
  - `audioConfig.channels` -> `AudioConfig.channels`
  - `audioConfig.codec` -> `AudioConfig.codec`
  - `audioConfig.sampleRate` -> `AudioConfig.sampleRate`

Ghi chú:

- Đây là message bắt buộc trước khi gửi audio cho turn đó.
- `turnId` là khóa định danh turn xuyên suốt toàn bộ stream của turn.

---

### 1.2 `finish_turn`

Mục đích: báo `stt-service` rằng backend đã gửi xong audio cho turn hiện tại và cần chốt kết quả cuối.

JSON shape đề xuất:

```json
{
  "type": "finish_turn",
  "sessionId": "string",
  "turnId": "string"
}
```

Mapping sang `stt.types.ts`:

- `sessionId` -> `SttTurnReference.sessionId`
- `turnId` -> `SttTurnReference.turnId`

Ghi chú:

- `finish_turn` là tín hiệu end-of-utterance ở mức protocol.
- Sau message này, service có thể trả `final_result` hoặc `error`.

---

### 1.3 `cancel_turn`

Mục đích: hủy turn đang chạy, không chờ final result nữa.

JSON shape đề xuất:

```json
{
  "type": "cancel_turn",
  "sessionId": "string",
  "turnId": "string"
}
```

Mapping sang `stt.types.ts`:

- `sessionId` -> `SttTurnReference.sessionId`
- `turnId` -> `SttTurnReference.turnId`

Ghi chú:

- Dùng khi backend không còn cần kết quả của turn đó.
- Sau `cancel_turn`, service nên dừng mọi xử lý còn lại cho turn tương ứng.

---

### 1.4 `close_session`

Mục đích: đóng toàn bộ session, hủy tất cả turn còn mở, giải phóng tài nguyên phía `stt-service`.

JSON shape đề xuất:

```json
{
  "type": "close_session",
  "sessionId": "string"
}
```

Mapping sang `stt.types.ts`:

- `sessionId` -> `SttDisconnectEvent.sessionId`
- Đồng thời cũng là giá trị dùng trong `SttStartTurnInput.sessionId` và `SttTurnReference.sessionId`

Ghi chú:

- Đây là message cấp session, không phải cấp turn.
- Khi nhận `close_session`, service nên đóng sạch mọi state gắn với `sessionId` đó và phát `disconnect` nếu contract muốn báo ngược về backend.

## 2. Audio chunk protocol

### 2.1 Xác nhận transport

- Audio chunk phải được gửi dưới dạng **binary frame riêng**, không nhúng vào JSON.
- Lý do:
  - tránh overhead base64
  - giữ nguyên luồng audio bytes
  - phù hợp với streaming latency thấp

### 2.2 Vấn đề metadata cho binary frame

Vì WebSocket binary frame không mang metadata tự mô tả, backend cần một cơ chế để service biết binary chunk thuộc `sessionId`, `turnId`, `sequence` nào.

Có 2 hướng thiết kế:

#### Option A: gửi JSON `audio_chunk_meta` ngay trước binary frame

Đề xuất JSON control message:

```json
{
  "type": "audio_chunk_meta",
  "sessionId": "string",
  "turnId": "string",
  "sequence": 123
}
```

Sau đó frame kế tiếp là binary audio bytes của chunk tương ứng.

Mapping:

- `sessionId` -> `SttSendAudioInput.sessionId`
- `turnId` -> `SttSendAudioInput.turnId`
- `sequence` -> `SttSendAudioInput.sequence`
- binary payload -> `SttSendAudioInput.audio`

Ưu điểm:

- một connection có thể multiplex nhiều turn
- service nhận đủ metadata trước khi đọc bytes
- giữ được thứ tự nếu backend gửi tuần tự theo cùng socket

Rủi ro:

- phải định nghĩa chặt chẽ pairing giữa JSON meta và binary frame tiếp theo
- nếu có concurrency cao, protocol phải cấm interleave meta của turn khác giữa meta và binary frame tương ứng

#### Option B: 1 WebSocket connection riêng cho mỗi turn

Trong mô hình này:

- mỗi turn dùng một WS connection riêng
- `sessionId` và `turnId` được “ngầm hiểu” từ socket đó
- binary frame có thể chỉ chứa audio bytes, không cần meta per chunk
- `sequence` vẫn có thể nằm trong message control hoặc header nội bộ nếu cần

Ưu điểm:

- protocol đơn giản hơn cho binary audio
- tránh ambiguity giữa nhiều turn

Rủi ro:

- nhiều connection hơn
- quản lý session/turn phức tạp hơn ở tầng transport
- không tối ưu nếu muốn dùng một connection dài hạn cho nhiều turn

### 2.3 Kết luận tạm thời cho contract

- Nếu muốn **1 connection dùng chung cho cả session**, thì backend **nên gửi `audio_chunk_meta` JSON ngay trước mỗi binary frame**.
- Nếu muốn **1 connection riêng cho mỗi turn**, thì binary frame có thể không cần meta per chunk nữa, vì `turnId` đã được gắn ở mức connection.

## 3. stt-service -> backend: result / error / disconnect messages

### 3.1 `partial_result`

Mục đích: trả kết quả nhận dạng tạm thời trong lúc turn vẫn đang chạy.

JSON shape đề xuất:

```json
{
  "type": "partial_result",
  "sessionId": "string",
  "turnId": "string",
  "text": "string",
  "confidence": 0.5,
  "providerLatencyMs": 123
}
```

Mapping sang `SttPartialResult`:

- `sessionId` -> `SttPartialResult.sessionId`
- `turnId` -> `SttPartialResult.turnId`
- `text` -> `SttPartialResult.text`
- `confidence` -> `SttPartialResult.confidence`
- `providerLatencyMs` -> `SttPartialResult.providerLatencyMs`

Ghi chú:

- `confidence` và `providerLatencyMs` là optional theo type hiện tại.
- `text` là bắt buộc.

---

### 3.2 `final_result`

Mục đích: trả kết quả cuối của turn.

JSON shape đề xuất:

```json
{
  "type": "final_result",
  "sessionId": "string",
  "turnId": "string",
  "text": "string",
  "language": "string",
  "confidence": 1,
  "providerLatencyMs": 123
}
```

Mapping sang `SttFinalResult`:

- `sessionId` -> `SttFinalResult.sessionId`
- `turnId` -> `SttFinalResult.turnId`
- `text` -> `SttFinalResult.text`
- `language` -> `SttFinalResult.language`
- `confidence` -> `SttFinalResult.confidence`
- `providerLatencyMs` -> `SttFinalResult.providerLatencyMs`

Ghi chú:

- `language` là bắt buộc theo `SttFinalResult`.
- `confidence` và `providerLatencyMs` là optional theo type hiện tại.

---

### 3.3 `error`

Mục đích: báo lỗi liên quan đến turn hiện tại hoặc session liên quan.

JSON shape đề xuất:

```json
{
  "type": "error",
  "sessionId": "string",
  "turnId": "string",
  "code": "string",
  "message": "string",
  "recoverable": true
}
```

Mapping sang `SttProviderError`:

- `sessionId` -> `SttProviderError.sessionId`
- `turnId` -> `SttProviderError.turnId`
- `code` -> `SttProviderError.code`
- `message` -> `SttProviderError.message`
- `recoverable` -> `SttProviderError.recoverable`

Ghi chú:

- `recoverable=false` nghĩa là backend nên coi turn đó đã kết thúc với lỗi.
- `recoverable=true` nghĩa là backend có thể tiếp tục session hoặc retry tùy policy.

---

### 3.4 `disconnect`

Mục đích: báo session đã bị đóng hoặc không còn hợp lệ ở phía `stt-service`.

JSON shape đề xuất:

```json
{
  "type": "disconnect",
  "sessionId": "string"
}
```

Mapping sang `SttDisconnectEvent`:

- `sessionId` -> `SttDisconnectEvent.sessionId`

Ghi chú:

- Đây là event cấp session, không có `turnId`.
- Có thể dùng khi service tự đóng connection, hoặc khi backend gửi `close_session` và service xác nhận ngắt.

## 4. Quyết định đã chốt

### Quyết định kiến trúc WS

Đã chốt mô hình:

- **1 connection WebSocket dùng chung cho cả session, nhiều turn**
- **audio_chunk_meta** sẽ được gửi ngay trước mỗi binary frame, theo Option A

### Lý do

- Một session có thể chứa nhiều turn diễn ra nối tiếp liên tục, thường là nhiều người thay phiên nói.
- Mở connection mới cho mỗi turn sẽ tạo overhead handshake không cần thiết trong bối cảnh real-time.
- Shared session socket giúp reuse kết nối, giảm chi phí thiết lập transport và phù hợp hơn với luồng hội thoại liên tục.

### Hệ quả protocol

- Backend phải gửi JSON `audio_chunk_meta` trước binary frame tương ứng.
- `stt-service` phải đọc cặp message theo thứ tự chặt chẽ để resolve đúng `sessionId`, `turnId`, `sequence`.
- `stt-service` PHẢI áp dụng timeout 3000ms kể từ khi nhận `audio_chunk_meta` để chờ binary frame tương ứng. Nếu quá thời hạn này mà chưa nhận được binary frame, coi đây là protocol violation theo quy tắc ở mục 5 và đóng connection.

## 5. Rule ordering bắt buộc

### Quy tắc xử lý

Server (`stt-service`) **PHẢI** xử lý đúng thứ tự sau:

1. Nhận JSON `audio_chunk_meta`
2. Frame tiếp theo ngay lập tức trên **cùng connection** **PHẢI** là binary audio tương ứng
3. Không được xen bất kỳ message nào khác giữa hai frame này
4. Không được xen message của turn khác vào giữa hai frame này

### Ý nghĩa

- Cặp `audio_chunk_meta` + binary frame là một đơn vị giao thức nguyên tử ở mức ordering.
- `audio_chunk_meta` xác định chính xác:
  - `sessionId`
  - `turnId`
  - `sequence`
- Binary frame ngay sau đó là payload audio tương ứng với metadata vừa nhận.

### Vi phạm giao thức

Nếu xảy ra một trong các trường hợp sau:

- binary frame không đến ngay sau `audio_chunk_meta`
- có JSON message khác chen vào giữa
- có metadata của turn khác chen vào giữa
- frame kế tiếp không phải binary audio

thì đây là **lỗi giao thức**.

### Hành vi khi vi phạm

- `stt-service` nên coi đây là protocol violation
- `stt-service` nên đóng connection
- backend cần tái thiết lập luồng nếu muốn tiếp tục xử lý

## 6. Việc để ngỏ cho implementation

Các điểm dưới đây chưa cần chốt ở mức contract, nhưng sẽ cần quyết định khi implement:

- Có cần checksum cho audio chunk không
- Có cho phép pipeline nhiều chunk liên tiếp hay strict one-meta-one-binary
