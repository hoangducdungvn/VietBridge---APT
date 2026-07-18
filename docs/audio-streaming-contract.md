# Audio Capture & Streaming Contract v1.3

**Dự án:** VietBridge — Real-Time Vietnamese-English Business Meeting Translator  
**Phạm vi:** Từ microphone đến đầu vào của ingestion gateway (P4) / STT  
**Trạng thái:** Voice va STT da dong thuan, khong con cau hoi mo, chuyen sang code va test tich hop  
**Phiên bản giao thức:** `1.3`

## Changelog

- **1.4** - Cập nhật kiến trúc xử lý Audio: Chuyển High-pass filter (80Hz) và Peak Normalization sang phía Backend (STT Service) để tối ưu chất lượng đầu vào cho Whisper, giảm tải cho Client. Tinh chỉnh các ngưỡng VAD mặc định (speechStart: 0.70, endSilenceMs: 450) để cắt câu nhanh hơn. Bổ sung theo kiểm chứng thực tế 2026-07-17/18 (wire format KHÔNG đổi, `protocol_version` giữ `1.3`): (a) chốt **dual-model STT** trên FPT Cloud — partial VI dùng `FPT.AI-whisper-large-v3-turbo` (fine-tune, VI-only), final và mọi request EN dùng `whisper-large-v3-turbo` bản gốc (§20.4 mới); (b) `language_hint: "auto"` loại khỏi vận hành, mọi hint chuẩn hóa về `vi`/`en` (§8.2); (c) nhịp partial đổi từ "mỗi ~1s cố định" sang **tự điều tiết theo in-flight** + sliding window `6s` phía STT (§20.3); (d) tầng Translation tách thành folder `translation/` ở root repo (Llama-3.3-70B trên FPT, timeout 8s); (e) sửa các lỗi triển khai: highpass vectorized, FastAPI threadpool, race partial/final ở gateway.
- **1.3** - Đóng toàn bộ O1–O8 (mục 20.2) thành D15–D21 trong 20.1; sửa D3 (ack một lần sau `utterance.end`), D4 (thêm điều kiện fallback MVP nếu trễ mốc ngày 1), D8 (sửa sai vai trò: STT transcribe từng utterance riêng, không tự ghép continuation — việc đó thuộc tầng Translation); thêm §20.3 mô tả mô hình `transcribe()` "periodic re-decode + final"; chốt chính thức model `FPT.AI-whisper-large-v3-turbo` ở §13.1; đồng bộ toàn bộ `protocol_version` trong JSON example về `1.3`.
- **1.2** - Chốt cứng phương án 2 mic độc lập (tai nghe có dây, mỗi người một mic riêng) cho toàn bộ hackathon. Bỏ hoàn toàn yêu cầu speaker diarization trên một mic chung ra khỏi phạm vi Voice; đơn giản hóa mục 3 và mục 4 (định danh).
- **1.1** - Bổ sung heartbeat ping/pong để phát hiện idle timeout từ proxy/load balancer; định nghĩa cơ chế server-side backpressure (`stream.throttle`) và ngưỡng kích hoạt `SERVER_BACKPRESSURE`; giải thích rõ ràng buộc 30s receptive field khi chọn maximum utterance duration.
- **1.0** - Bản đề xuất sơ bộ ban đầu.

## 1. Mục tiêu

Module Voice chịu trách nhiệm:

1. Thu âm từ trình duyệt hoặc nền tảng tích hợp khác.
2. Làm sạch audio ở mức an toàn cho nhận dạng giọng nói.
3. Phát hiện vùng có tiếng nói (VAD) và chia audio thành các utterance.
4. Giữ đúng timeline khi hai người nói lần lượt hoặc nói chồng lên nhau.
5. Gắn định danh nguồn âm thanh, người nói và lượt nói.
6. Gửi audio gần thời gian thực cho STT bằng một hợp đồng độc lập nền tảng.
7. Cung cấp chỉ số chất lượng để STT có thể xử lý hoặc cảnh báo khi đầu vào xấu.

Module Voice **không** tự sửa nội dung, loại bỏ từ đệm, đoán bản dịch hoặc thay đổi câu nói. STT/Translation quyết định cách biểu diễn các từ như “ừm”, “ờ”, “uh”, “um”.

## 2. Kiến trúc đề xuất

```text
Microphone / Audio source
          │
          ▼
Platform adapter
(Web AudioWorklet / Native audio API / Mobile audio API)
          │
          ▼
Normalize: mono, PCM signed 16-bit, 16 kHz
          │
          ▼
Safe DSP: AEC → noise suppression → gain control → limiter
          │
          ├──────────────► Audio quality metrics
          │
          ▼
VAD + utterance state machine
          │
          ▼
Packetizer + local resend buffer
          │
          ▼
Secure WebSocket
          │
          ▼
Ingestion gateway (P4)
```

Mọi nền tảng chỉ cần triển khai `Platform adapter`. Phần DSP, VAD, packetizer và giao thức đầu ra nên giữ cùng hành vi và cùng schema.

## 3. Phan cung: 2 mic doc lap (da chot)

### 3.1 Quyet dinh

Thiet bi thuc te cho hackathon: **hai tai nghe co day, moi tai nghe co mic rieng**. Day khong con la "phuong an de xuat" - day la cau hinh chinh thuc duoc dung trong toan bo qua trinh phat trien va demo.

- Nguoi A: `speaker_id = speaker-a`, `source_id = mic-a` (mic tren tai nghe A).
- Nguoi B: `speaker_id = speaker-b`, `source_id = mic-b` (mic tren tai nghe B).
- Anh xa `source_id -> speaker_id` la **tinh, cau hinh san khi source.register**, khong can suy luan hay nhan dien giong noi trong luc chay.
- Moi nguon co stream, VAD state va utterance rieng, hoan toan doc lap.
- Khi hai nguoi noi chong nhau, ca hai utterance van duoc gui doc lap voi timeline chung (xem muc 10).

### 3.2 Vi sao bo hoan toan speaker diarization

Voi 1 mic dung chung, he thong can mot mo hinh nhan dien giong noi (speaker diarization/embedding) de doan ai dang noi tu audio da tron - day la mot bai toan AI rieng, tach biet hoan toan voi viec thu/lam sach/truyen audio, va khong kha thi de lam dung trong pham vi 2 ngay hackathon voi do tin cay cao.

Vi da co 2 mic vat ly rieng, van de nay khong ton tai: **moi kenh mic la mot nguoi cu the, biet truoc, khong doi trong suot session**. Voice module vi vay:

- Khong can chay bat ky mo hinh nhan dien giong noi nao.
- Khong can `speaker_id: null` / `speaker_state: "unknown"` trong van hanh binh thuong - moi nguon deu co speaker_id xac dinh ngay tu `source.register`.
- Khong can co che "gan nhan sau" (sua speaker_id sau khi nhan dien) o bat ky tang nao.

Tai lieu nay vi vay **khong con dinh nghia rieng cho truong hop 1 mic chung** nhu mot luong chinh. Neu vi ly do bat kha khang phai dung tam 1 mic (vi du hong tai nghe luc demo), quy tac fallback toi thieu la: gan `speaker_id: null`, `speaker_state: "unknown"`, va coi day la tinh huong khong duoc thiet ke/test day du, khong dam bao chat luong.

### 3.3 Luu y rieng cho web

Trinh duyet khong dam bao thu dong thoi on dinh tu hai microphone vat ly tren cung mot may/mot AudioContext. Vi vay cau hinh demo bat buoc la: **hai thiet bi/hai trinh duyet client rieng biet, moi nguoi mot may, moi may cam mot tai nghe**, moi client mo mot WebSocket rieng ve gateway.

Khong nen gia dinh `getUserMedia()` luon tra dung `16 kHz`; trinh duyet thuong capture o `48 kHz`. Client phai resample hoac gateway phai chuan hoa truoc khi dua vao STT.

## 4. Định danh bắt buộc

| Trường | Ý nghĩa | Vòng đời |
|---|---|---|
| `session_id` | Một cuộc họp | Từ lúc bắt đầu đến khi kết thúc cuộc họp |
| `participant_id` | Người tham gia ở tầng nghiệp vụ | Ổn định trong session |
| `speaker_id` | Người đang tạo ra tiếng nói | Xác định tĩnh từ `source.register` (1 mic = 1 speaker_id cố định); chỉ `null` trong trường hợp fallback 1 mic chung (xem §3.2) |
| `source_id` | Nguồn capture cụ thể: microphone/device/channel | Ổn định trong một kết nối hoặc sau khi đăng ký lại |
| `connection_id` | Một lần kết nối WebSocket | Thay đổi sau reconnect |
| `utterance_id` | Một đoạn lời nói liên tục do VAD tạo ra | Mới cho mỗi utterance |
| `stream_id` | Logical stream để khôi phục sau reconnect | Ổn định dù `connection_id` thay đổi |
| `sequence` | Số thứ tự audio chunk trong một stream | Tăng đơn điệu, không tái sử dụng |

Không dùng `speaker_id` thay cho `source_id`: về nguyên tắc đây vẫn là hai khái niệm khác nhau (một người có thể đổi thiết bị giỏa session). Với cấu hình đã chốt (§3.1), ánh xạ `source_id ↔ speaker_id` là 1-1 và cố định suốt session, nhưng hai trường vẫn được giự tách biệt trong metadata để STT/orchestration không phải giả định 1-1 nếu sau này đổi sang cấu hình khác (ví dụ nhiều người/nhiều ngôn ngữ).

## 5. Audio profile chuẩn

### 5.1 Profile mặc định gửi STT

| Thuộc tính | Giá trị |
|---|---|
| Codec | `pcm_s16le` |
| Sample rate | `16000 Hz` |
| Channels | `1` |
| Sample format | Signed 16-bit little-endian |
| Chunk duration | `20 ms` nội bộ; gom `40–100 ms` khi gửi |
| Byte rate | `32,000 bytes/s` |
| Timestamp | Monotonic time tính từ đầu session |

PCM được chọn cho prototype vì không có độ trễ encode/decode và tránh sai khác codec giữa nền tảng. Có thể bổ sung Opus sau:

```json
{
  "codec": "opus",
  "sample_rate_hz": 48000,
  "channels": 1,
  "frame_duration_ms": 20
}
```

Không đổi codec giữa stream nếu chưa gửi sự kiện `stream.reconfigure` và nhận xác nhận từ STT.

### 5.2 Kích thước tham khảo

- `20 ms` PCM 16 kHz mono: `640 bytes`.
- `40 ms`: `1,280 bytes`.
- `100 ms`: `3,200 bytes`.

Đề xuất gửi mỗi `40–60 ms` để cân bằng độ trễ và overhead WebSocket.

## 6. Transport và wire format

### 6.1 Transport

- `WSS` (WebSocket qua TLS).
- Một session có thể có nhiều WebSocket, mỗi nguồn audio một kết nối.
- Control event dùng WebSocket **text frame** chứa JSON UTF-8.
- Audio event dùng WebSocket **binary frame**.

### 6.2 Binary audio frame

Để metadata và audio luôn nằm trong cùng một WebSocket message:

```text
┌──────────────────────────┬──────────────────────────┬────────────────────┐
│ metadata_length: uint32  │ metadata: UTF-8 JSON     │ PCM/Opus payload   │
│ big-endian, 4 bytes      │ metadata_length bytes    │ remaining bytes    │
└──────────────────────────┴──────────────────────────┴────────────────────┘
```

Không dùng base64 trong production path vì tăng khoảng 33% kích thước và tạo thêm chi phí CPU/memory. JSON + base64 chỉ phù hợp để debug thủ công.

## 7. Vòng đời giao thức

```text
Client                                  Ingestion Gateway (P4)
  │                                          │
  ├──────── session.start ──────────────────►│
  │◄─────── session.accepted ────────────────┤
  ├──────── source.register ────────────────►│
  │◄─────── source.accepted ─────────────────┤
  ├──────── utterance.start ────────────────►│
  ├════════ audio.chunk (binary) ═══════════►│
  ├════════ audio.chunk (binary) ═══════════►│
  ├──────── utterance.end ──────────────────►│
  │◄─────── stream.ack ──────────────────────┤
  │                                          │
  │        ... IDLE, không ai nói ...        │
  ├──────── heartbeat.ping ─────────────────►│
  │◄─────── heartbeat.pong ───────────────────┤
  │        (lặp lại mỗi ~15–20s khi idle)     │
  │                                          │
  ├──────── session.end ────────────────────►│
```

Heartbeat không chỉ chạy khi idle; nó chạy xuyên suốt session bất kể có audio hay không, vì mục tiêu là phát hiện sớm việc proxy/load balancer đóng kết nối âm thầm, không phải chỉ để lấp khoảng trống khi không có audio.chunk.

## 8. Control events

Mọi control event có envelope chung:

```json
{
  "protocol_version": "1.3",
    "type": "event.name",
  "event_id": "evt-01J...",
  "session_id": "ses-01J...",
  "stream_id": "str-01J...",
  "source_id": "mic-a",
  "sent_at": "2026-07-17T09:15:31.123Z"
}
```

`event_id`, `session_id`, `stream_id` và `utterance_id` nên dùng UUID hoặc ULID.

### 8.1 `session.start`

```json
{
  "protocol_version": "1.3",
    "type": "session.start",
  "event_id": "evt-001",
  "session_id": "meeting-001",
  "stream_id": "stream-speaker-a",
  "source_id": "mic-a",
  "sent_at": "2026-07-17T09:15:31.123Z",
  "client": {
    "platform": "web",
    "app_version": "0.1.0",
    "sdk_version": "0.1.0",
    "device_id": "device-a"
  },
  "audio": {
    "codec": "pcm_s16le",
    "sample_rate_hz": 16000,
    "channels": 1,
    "chunk_duration_ms": 40
  },
  "capabilities": {
    "aec": true,
    "noise_suppression": true,
    "agc": true,
    "vad": true,
    "resend": true
  }
}
```

### 8.2 `source.register`

```json
{
  "protocol_version": "1.3",
    "type": "source.register",
  "event_id": "evt-002",
  "session_id": "meeting-001",
  "stream_id": "stream-speaker-a",
  "source_id": "mic-a",
  "sent_at": "2026-07-17T09:15:31.200Z",
  "participant_id": "participant-a",
  "speaker_id": "speaker-a",
  "speaker_state": "assigned",
  "language_hint": "vi",
  "microphone": {
    "label": "Headset microphone",
    "channel": 0
  }
}
```

Giá trị `language_hint`: `vi`, `en` hoặc `auto`.

`language_hint` là gợi ý tĩnh theo nguồn thu âm, có thể bị STT override khi độ tin cậy phát hiện ngôn ngữ tại runtime cao hơn.

> **Cập nhật 1.3.1:** `auto` vẫn hợp lệ trên wire nhưng **không dùng trong vận hành MVP**. Kiểm chứng 2026-07-18: model whisper gốc trên FPT khi không nhận `language` cụ thể sẽ tự **dịch** audio VI sang tiếng Anh thay vì transcribe. Vì cấu hình 2-mic có hint tĩnh per-source (§3.1), mọi tầng (gateway, STT service, UI) chuẩn hóa hint theo quy tắc: không phải `en` ⇒ `vi`. UI demo đã bỏ lựa chọn "Auto".

### 8.3 `utterance.start`

```json
{
  "protocol_version": "1.3",
    "type": "utterance.start",
  "event_id": "evt-010",
  "session_id": "meeting-001",
  "stream_id": "stream-speaker-a",
  "source_id": "mic-a",
  "sent_at": "2026-07-17T09:15:35.010Z",
  "utterance_id": "utt-a-0001",
  "participant_id": "participant-a",
  "speaker_id": "speaker-a",
  "speaker_state": "assigned",
  "language_hint": "vi",
  "start_time_ms": 3780,
  "vad": {
    "engine": "silero",
    "speech_probability": 0.91,
    "pre_roll_ms": 250
  }
}
```

`start_time_ms` phải trỏ đến đầu audio có cả pre-roll, không phải thời điểm event được gửi.

### 8.4 `utterance.end`

```json
{
  "protocol_version": "1.3",
    "type": "utterance.end",
  "event_id": "evt-020",
  "session_id": "meeting-001",
  "stream_id": "stream-speaker-a",
  "source_id": "mic-a",
  "sent_at": "2026-07-17T09:15:41.850Z",
  "utterance_id": "utt-a-0001",
  "speaker_id": "speaker-a",
  "end_time_ms": 10620,
  "last_sequence": 171,
  "reason": "vad_silence",
  "trailing_silence_ms": 600,
  "audio_duration_ms": 6840,
  "quality_summary": {
    "average_snr_db": 18.4,
    "clipping_ratio": 0.001,
    "dropped_chunks": 0,
    "noise_level": "moderate"
  }
}
```

Giá trị `reason`:

- `vad_silence`: kết thúc tự nhiên sau khoảng im lặng.
- `max_duration`: chạm giới hạn độ dài; utterance tiếp theo phải có continuation marker.
- `user_stop`: người dùng chủ động dừng.
- `source_lost`: mất microphone hoặc quyền truy cập.
- `connection_close`: client kết thúc trước khi gửi đủ audio.
- `session_end`: cuộc họp kết thúc.

### 8.5 `stream.ack`

STT gửi định kỳ để client biết dữ liệu nào đã nhận bền vững:

```json
{
  "protocol_version": "1.3",
    "type": "stream.ack",
  "session_id": "meeting-001",
  "stream_id": "stream-speaker-a",
  "highest_contiguous_sequence": 171,
  "missing_sequences": [],
  "server_time": "2026-07-17T09:15:41.900Z"
}
```

### 8.6 `stream.resume`

Sau reconnect, client giữ nguyên `session_id` và `stream_id` nhưng tạo `connection_id` mới:

```json
{
  "protocol_version": "1.3",
    "type": "stream.resume",
  "event_id": "evt-030",
  "session_id": "meeting-001",
  "stream_id": "stream-speaker-a",
  "source_id": "mic-a",
  "connection_id": "conn-new",
  "last_acknowledged_sequence": 171,
  "next_sequence": 172
}
```

Client nên giữ resend buffer tối thiểu `5–10 giây` audio chưa được ACK.

### 8.7 `heartbeat.ping` / `heartbeat.pong`

**Van de:** Khi VAD o trang thai `IDLE` keo dai (khong ai noi), khong co `audio.chunk` nao duoc gui. Load balancer/reverse proxy (nginx, ALB, Cloudflare, v.v.) thuong co idle timeout khoang `30-60s` va se dong ket noi ma khong gui close frame dung chuan. Client chi phat hien loi khi thu gui chunk tiep theo, nghia la co the mat dau cau noi tiep theo.

**Giai phap:** Heartbeat hoat dong doc lap voi VAD/audio state va chay suot vong doi ket noi, ke ca khi dang co audio.

- Client gui `heartbeat.ping` moi `15-20s` tinh tu frame gan nhat da gui (audio hoac control). Neu dang co audio.chunk lien tuc thi khong can gui them ping rieng.
- Ingestion gateway (P4) phai tra `heartbeat.pong` trong vong `5s`. Neu khong nhan duoc, client coi ket noi da chet va chu dong reconnect ngay, thay vi cho TCP timeout co the keo dai vai phut.
- Neu 2 lan ping lien tiep khong co pong, client danh dau ket noi la `stale` va chuan bi `stream.resume` tren ket noi moi.
- Heartbeat chay tren cung WebSocket voi control event, khong mo ket noi phu.

```json
{
  "protocol_version": "1.3",
    "type": "heartbeat.ping",
  "event_id": "evt-hb-041",
  "session_id": "meeting-001",
  "stream_id": "stream-speaker-a",
  "source_id": "mic-a",
  "sent_at": "2026-07-17T09:16:05.000Z"
}
```

```json
{
  "protocol_version": "1.3",
    "type": "heartbeat.pong",
  "event_id": "evt-hb-042",
  "session_id": "meeting-001",
  "stream_id": "stream-speaker-a",
  "in_reply_to": "evt-hb-041",
  "server_time": "2026-07-17T09:16:05.040Z"
}
```

Khuyen nghi tham so:

| Tham so | Gia tri |
|---|---|
| Ping interval | `15-20s` |
| Pong timeout | `5s` |
| So lan ping lien tiep khong co pong truoc khi coi la mat ket noi | `2` |

Co the dung WebSocket ping/pong frame chuan (RFC 6455) ở transport layer thay cho application-level JSON neu thu vien client/server ho tro tot; van nen giu them heartbeat o application layer vi mot so proxy/CDN can thiep vao control frame RFC 6455 hoac khong cho phep truy cap truc tiep.

## 9. Metadata của `audio.chunk`

Metadata JSON nằm trong binary frame:

```json
{
  "protocol_version": "1.3",
    "type": "audio.chunk",
  "session_id": "meeting-001",
  "stream_id": "stream-speaker-a",
  "connection_id": "conn-001",
  "source_id": "mic-a",
  "participant_id": "participant-a",
  "speaker_id": "speaker-a",
  "speaker_state": "assigned",
  "utterance_id": "utt-a-0001",
  "sequence": 95,
  "utterance_sequence": 12,
  "capture_start_ms": 4260,
  "duration_ms": 40,
  "audio": {
    "codec": "pcm_s16le",
    "sample_rate_hz": 16000,
    "channels": 1,
    "payload_bytes": 1280
  },
  "speech": {
    "vad_probability": 0.96,
    "overlap": false,
    "active_speaker_ids": ["speaker-a"]
  },
  "processing": {
    "aec_applied": true,
    "noise_suppression_applied": true,
    "agc_applied": true,
    "resampled": true
  },
  "quality": {
    "rms_dbfs": -21.3,
    "peak_dbfs": -4.8,
    "estimated_snr_db": 19.2,
    "clipping_ratio": 0.0
  }
}
```

### Trường bắt buộc trong MVP

- `protocol_version`
- `type`
- `session_id`
- `stream_id`
- `source_id`
- `utterance_id`
- `sequence`
- `capture_start_ms`
- `duration_ms`
- `audio.codec`
- `audio.sample_rate_hz`
- `audio.channels`
- `audio.payload_bytes`

### Trường nên có

- `participant_id`
- `speaker_id`
- `speaker_state`
- `utterance_sequence`
- `speech.vad_probability`
- `speech.overlap`
- `processing.*`
- `quality.*`

## 10. Timeline, nói chen và nói chồng

### 10.1 Nguyên tắc

- Mỗi nguồn có VAD state và utterance riêng.
- `capture_start_ms` dùng chung một mốc monotonic của session.
- Không dừng stream A chỉ vì stream B bắt đầu nói.
- Không trộn hai nguồn thành một stream trước STT.
- STT/Conversation Orchestrator dùng khoảng thời gian để xác định overlap.

Ví dụ:

```text
Speaker A: [---------- utt-a-0001 ----------]
Speaker B:                  [--- utt-b-0004 ---]
Timeline : 0----1----2----3----4----5----6----7
                              overlap
```

Trong vùng chồng nhau:

```json
{
  "speech": {
    "overlap": true,
    "active_speaker_ids": ["speaker-a", "speaker-b"]
  }
}
```

`overlap` chỉ đáng tin cậy khi client hoặc session coordinator nhìn thấy cả hai nguồn. Nếu một client chỉ biết stream của mình, có thể bỏ trường này; server tự suy ra từ timeline.

### 10.2 Nói chen ngắn

Một câu chen ngắn như “đúng”, “yes”, “sorry” vẫn tạo utterance riêng nếu vượt ngưỡng VAD tối thiểu. Không gộp nó vào utterance của người kia.

Khuyến nghị:

- Minimum speech duration: `100–150 ms`.
- Pre-roll: `200–300 ms`.
- End-of-turn silence: `500–700 ms`.

Không nên dùng `interruption=true` ở lớp Voice vì “nói chen” là khái niệm hội thoại. Voice chỉ cung cấp timeline và overlap; lớp orchestration có thể suy luận interruption sau.

### 10.3 Crosstalk giữa hai mic headset

Cấu hình đã chốt (§3.1) dùng headset có mic gần sát miệng cho mỗi người, nên rủi ro mic B thu vọng giọng người A thấp hơn nhiều so với dùng mic để bàn/mic laptop. Tuy nhiên vẫn có thể xảy ra khi nói to trong phòng nhỏ hoặc khi headset không ôm tai kín. Biện pháp:

1. Ưu tiên headset ôm tai/chụp tai hơn tai nghe nhét tai hở, giảm thu vọng giữa hai mic.
2. Hiệu chỉnh gain từng microphone.
3. So sánh năng lượng/độ trễ giữa các nguồn ở server để đánh dấu crosstalk.
4. Không loại audio chỉ dựa vào mức âm lượng; có thể làm mất câu nói thật.
5. Nếu có deduplication, thực hiện ở coordinator và giữ bản gốc để phục hồi.

Có thể bổ sung metadata server-side:

```json
{
  "crosstalk": {
    "suspected": true,
    "dominant_source_id": "mic-a",
    "confidence": 0.88
  }
}
```

### 10.4 Đồng bộ timeline liên-stream qua ingestion gateway (`server_received_at`)

Từ v1.2, hai nguồn bắt buộc chạy trên **hai máy khác nhau** (§3.3), nghĩa là hai đồng hồ monotonic hoàn toàn độc lập. So sánh trực tiếp `capture_start_ms` giễa hai stream **không an toàn** — không có cơ chế nào đảm bảo hai client khởi động đồng hồ cùng lúc.

**Nguyên tắc:** Voice **không** tự đồng bộ clock giỏa hai máy (bài toán distributed clock sync không phù hợp để giải trong phạm vi hackathon). Thay vào đó, trách nhiệm xác định thời gian liên-stream chuyển cho **ingestion gateway (P4)** — nơi duy nhất trong hệ thống nhìn thấy cả hai stream trên cùng một đồng hồ.

- `capture_start_ms` / `start_time_ms` / `end_time_ms` do Voice gửi vẫn là mốc **nội bộ theo từng stream** (đủ dùng để tính duration, phát hiện `max_duration`, nối continuation). Không đổi gì ở phía Voice.
- Ingestion gateway (P4) ghi `server_received_at` (theo đồng hồ của chính gateway) cho **mọi** event/chunk ngay khi đến nơi (`session.start`, `utterance.start`, `audio.chunk`, `utterance.end`...).
- Overlap giữa hai utterance thuộc hai stream khác nhau được xác định bằng cách so sánh khoảng `[server_received_at của utterance.start, server_received_at của utterance.end]` của từng stream, cộng thêm biên an toàn `±200–300ms` cho jitter mạng.
- Voice giảm sai số bằng cách **gửi audio ngay sau khi capture, không buffer thêm phía client** — latency mạng trên LAN/Wi-Fi hội trường thường `<100–200ms`, nhỏ so với độ phân giải cần thiết cho overlap detection (~600ms).
- Hạ tậng calibration kiểu NTP (round-trip offset giữa client và gateway) là hướng nâng cấp khả thi cho v1.3+ nếu cần độ chính xác dưới `100ms`, nhưng **không làm trong phạm vi hackathon** — không cần thiết cho use case "ai nói chen ai".

Đây là quyết định kiến trúc cần **P4 xác nhận và implement** (Voice không cần code thêm gì cho mục này, ngoài việc đảm bảo không buffer audio lâu phía client).

## 11. Từ đệm, ngập ngừng và khoảng dừng

Các âm “ừm”, “ờ”, “à”, “uh”, “um” là speech hợp lệ:

- VAD không được cố phân loại hoặc xóa chúng.
- Không đóng utterance khi chỉ có khoảng dừng ngắn giữa câu.
- Hangover/end silence `500–700 ms` giúp giữ câu tự nhiên.
- Nếu người nói ngừng lâu hơn ngưỡng, kết thúc utterance; STT vẫn có thể ghép ngữ cảnh ở tầng session.
- Không trim mạnh đầu/cuối vì dễ làm mất phụ âm ngắn.

Nếu utterance dài quá giới hạn, chia kỹ thuật nhưng đánh dấu quan hệ:

```json
{
  "reason": "max_duration",
  "continuation_id": "cont-a-003",
  "has_next": true
}
```

Utterance tiếp theo dùng cùng `continuation_id` và `continued_from_utterance_id`.

## 12. Môi trường ồn và làm sạch audio

### 12.1 Thứ tự xử lý thực tế (cập nhật v1.4)

Quá trình làm sạch audio được chia làm hai giai đoạn để tận dụng sức mạnh của cả Client (tiết kiệm băng thông) và Server (chất lượng cao).

**Giai đoạn 1: Tại Client (Trình duyệt / Voice module)**
```text
Capture → Hardware/Browser AEC (Khử vọng) → Noise Suppression (Giảm ồn) → AGC (Cân bằng âm) → VAD
```
*Client chỉ áp dụng các filter có sẵn của WebRTC để phát hiện VAD hiệu quả.*

**Giai đoạn 2: Tại Backend (STT Service)**
```text
Nhận PCM từ Gateway → Trim Trailing Silence (Cắt đuôi tĩnh lặng) → High-pass Filter (80Hz khử DC offset/rumble) → Peak Normalization (-3dBFS) → STT API (Whisper)
```
*Việc đẩy High-pass filter và Normalization về backend giúp Whisper luôn nhận được mức âm lượng tối ưu (chuẩn -3dBFS) bất kể người dùng nói nhỏ hay xa mic, đồng thời chặn hoàn toàn tiếng ồn ù ù (rumble).*

### 12.2 Nguyên tắc an toàn

- Ưu tiên intelligibility hơn cảm giác “sạch tuyệt đối”.
- Noise suppression quá mạnh có thể xóa phụ âm tiếng Việt và tiếng Anh.
- AGC quá mạnh làm tiếng ồn nền bị kéo lên khi người nói im lặng.
- Limiter phải ngăn clipping nhưng không nén động học quá mức.
- AEC đặc biệt quan trọng nếu bản dịch/TTS phát qua loa.
- Nếu có thể, dùng tai nghe để tránh tiếng TTS quay lại microphone.
- **TTS mặc định phát qua headset**, không phát qua loa ngoài. Vì cấu hình đã chốt là mỗi người dùng một tai nghe có dây (§3.1), âm thanh dịch (TTS) cần được đặt làm output audio của chính tai nghe đó — vừa tránh vòng lặp echo (loa phát lại vào mic chính mình hoặc mic người kia), vừa không cần AEC phải xử lý trường hợp khó (loa ngoài + nhiều mic trong cùng phòng). Nếu phạm vi sau này mở rộng sang loa ngoài (ví dụ phát cho cả phòng nghe), AEC bắt buộc phải bật và cần test lại riêng.

### 12.3 Chỉ số chất lượng

| Chỉ số | Mục đích |
|---|---|
| `rms_dbfs` | Phát hiện âm quá nhỏ hoặc gain không hợp lý |
| `peak_dbfs` | Phát hiện gần clipping |
| `clipping_ratio` | Tỷ lệ sample bị clipping |
| `estimated_snr_db` | Ước lượng mức sạch của tiếng nói |
| `dropped_chunks` | Phát hiện gián đoạn capture/network |
| `noise_level` | Phân loại đơn giản: `low`, `moderate`, `high`, `severe` |

Các chỉ số là telemetry, không được dùng làm lý do tự động bỏ utterance trừ khi audio hoàn toàn không hợp lệ.

## 13. VAD state machine

```text
IDLE
  │ speech probability vượt ngưỡng
  ▼
POSSIBLE_SPEECH
  │ đủ minimum speech duration
  ▼
SPEAKING
  │ xác suất giảm; bắt đầu hangover
  ▼
POSSIBLE_END
  ├── speech quay lại ─────────────► SPEAKING
  └── đủ end silence ──────────────► END → IDLE
```

Khuyến nghị ban đầu, cần tune bằng dữ liệu thực tế:

| Tham số | Giá trị khởi đầu |
|---|---|
| Frame | `20 ms` |
| Speech start probability | `0.60–0.70` |
| Speech end probability | `0.30–0.45` |
| Minimum speech | `100–150 ms` |
| Pre-roll | `250 ms` |
| End silence/hangover | `600 ms` |
| Maximum utterance | `≤ 28 s` (khuyến nghị `25 s`) |

Dùng hysteresis: ngưỡng bắt đầu cao hơn ngưỡng kết thúc để tránh state nhấp nháy trong môi trường ồn.

### 13.1 Vì sao maximum utterance liên quan đến giới hạn 30s của Whisper

Các model dòng Whisper (bao gồm `whisper-large-v3` và các bản fine-tune) có receptive field cố định `30 giây` cho mỗi lần forward pass. Đây không phải giới hạn về độ dài audio hỗ trợ, mà là kích thước log-mel spectrogram input mà encoder được huấn luyện để xử lý trong một lần. Model cụ thể dùng cho hackathon **đã chốt chính thức là `FPT.AI-whisper-large-v3-turbo`** (không còn ở giai đoạn xem xét), sẽ convert sang CTranslate2 và benchmark ngày 1 sáng (§20).

Hệ quả:

- Nếu một utterance từ Voice dài đúng hoặc vượt `30s`, STT phải tự chunk nội bộ (sliding window, chia theo VAD phụ, hoặc dùng long-form decoding của Whisper). Đây là trách nhiệm của đội STT, không phải của Voice.
- Voice giới hạn `maximum utterance` ở mức thấp hơn 30s (đề xuất `25–28s`) để:
  - Chừa margin cho việc audio chunk có thể đến trễ hoặc network jitter làm utterance thực tế dài hơn giá trị client đo được.
  - Tránh trường hợp utterance chạm đúng biên 30s, buộc STT phải chunk một đoạn rất ngắn còn lại (vài trăm ms), dễ giảm độ chính xác ở phần cuối câu.
  - Cho STT không gian để tự quyết định điểm cắt tốt hơn (ví dụ tại một khoảng ngắn im lặng bên trong utterance) nếu cần, thay vì bị cắt cứng tại đúng 30s.
- Nếu VAD chưa phát hiện được điểm dừng tự nhiên khi chạm giới hạn, Voice đóng utterance với `reason: "max_duration"` và mở utterance kế tiếp có `continuation_id` như mô tả ở mục 11. STT nhận được hai utterance liên tiếp thuộc cùng continuation, không phải một utterance 30s duy nhất.

**Ghi chú gửi đội STT:** giới hạn `25–28s` từ phía Voice không thay thế cho việc STT tự xử lý input dài hơn 30s trong trường hợp cần ghép nhiều utterance liên tiếp (cùng `continuation_id`) thành một ngữ cảnh dịch liên tục ở tầng orchestration. Voice chỉ đảm bảo không gửi một utterance đơn lẻ dài hơn ngưỡng an toàn; việc quản lý context xuyên utterance là của tầng STT/Translation.

## 14. Mất gói, thứ tự và backpressure

WebSocket chạy trên TCP nên giữ thứ tự, nhưng sequence vẫn cần thiết để:

- Phát hiện lỗi logic phía client.
- Khôi phục sau reconnect.
- Tránh xử lý trùng khi resend.
- Ghép log giữa Voice và STT.

1. `sequence` tăng trên toàn bộ `stream_id`, không reset theo utterance.
2. STT deduplicate theo `(stream_id, sequence)`.
3. Client giữ audio chưa ACK trong ring buffer `5–10 giây`.
4. Khi queue phía client vượt ngưỡng, không âm thầm bỏ gói.
5. Phát sự kiện `stream.degraded` nếu buffer gần đầy.
6. Nếu bắt buộc phải bỏ audio, gửi gap event với khoảng timeline bị mất.

```json
{
  "protocol_version": "1.3",
    "type": "stream.gap",
  "session_id": "meeting-001",
  "stream_id": "stream-speaker-a",
  "source_id": "mic-a",
  "from_sequence": 230,
  "to_sequence": 236,
  "start_time_ms": 12040,
  "duration_ms": 280,
  "reason": "client_buffer_overflow"
}
```

### 14.1 Backpressure phía server (ingestion gateway P4 xử lý chậm)

Phần trên chỉ xử lý trường hợp client bị nghẽn. Chiều ngược lại — ingestion gateway (P4) tự xử lý chậm và cần báo ngược cho client — cần một tín hiệu soft trước khi đi đến mức phải ngắt kết nối bằng `SERVER_BACKPRESSURE`.

**Nguyên tắc hai mức:**

1. **Soft signal — `stream.throttle`:** Ingestion gateway (P4) gửi khi hàng đợi xử lý nội bộ (audio buffer chờ decode/transcribe) vượt ngưỡng cảnh báo nhưng vẫn còn xử lý được. Client không dừng gửi audio (audio vẫn phải liên tục vì người dùng vẫn đang nói), nhưng nên tắt các tác vụ không thiết yếu (ví dụ giảm từ interim update UI, tạm hoãn gửi lại chunk debug) và tăng thời gian retry nếu đang resend.
2. **Hard signal — `error: SERVER_BACKPRESSURE`:** Ingestion gateway (P4) gửi và chủ động đóng kết nối khi hàng đợi vượt ngưỡng nghiêm trọng hoặc độ trễ xử lý ước tính vượt quá mức chấp nhận được cho hội thoại thực. Lúc này client phải coi như mất kết nối, buffer audio vào ring buffer resend, và thực hiện `stream.resume` sang kết nối/instance khác (lý tưởng là gateway có load balancing nhiều instance).

**Ngưỡng đề xuất (cần STT team xác nhận và tune theo hạ tầng thực tế):**

| Mức | Điều kiện kích hoạt | Hành động |
|---|---|---|
| Bình thường | Queue xử lý nội bộ < `2s` audio chờ | Không cần tín hiệu đặc biệt |
| Cảnh báo (`stream.throttle`) | Queue ước tính `2–5s` audio chờ xử lý, hoặc độ trễ interim result vượt `1.5x` mục tiêu latency | Gửi `stream.throttle`, tiếp tục nhận audio |
| Nghiêm trọng (`SERVER_BACKPRESSURE`) | Queue vượt `8–10s` audio chờ, hoặc memory/queue nội bộ gần giới hạn cấu hình | Gửi `error(SERVER_BACKPRESSURE)`, đóng kết nối có kiểm soát |

Các số trên là điểm khởi đầu để hai đội thảo luận, không phải giá trị cố định; ngưỡng thực tế phụ thuộc vào số GPU/instance và batch size của STT.

```json
{
  "protocol_version": "1.3",
    "type": "stream.throttle",
  "session_id": "meeting-001",
  "stream_id": "stream-speaker-a",
  "level": "warning",
  "estimated_queue_delay_ms": 3200,
  "suggested_action": "reduce_non_essential_traffic",
  "server_time": "2026-07-17T09:17:02.500Z"
}
```

```json
{
  "protocol_version": "1.3",
    "type": "error",
    "event_id": "evt-error-09",
  "session_id": "meeting-001",
  "stream_id": "stream-speaker-a",
  "code": "SERVER_BACKPRESSURE",
  "message": "STT queue delay exceeded 9000ms, closing connection",
  "recoverable": true,
  "retry_after_ms": 2000,
  "server_time": "2026-07-17T09:17:05.000Z"
}
```

Khi nhận `error(SERVER_BACKPRESSURE)` kèm `recoverable: true` và `retry_after_ms`, client chờ khoảng thời gian đó rồi mới `stream.resume`, tránh thời ngay lập tắc làm tăng thêm áp lực cho gateway đang quá tải.

## 15. Error event

```json
{
  "protocol_version": "1.3",
    "type": "error",
    "event_id": "evt-error-01",
  "session_id": "meeting-001",
  "stream_id": "stream-speaker-a",
  "source_id": "mic-a",
  "code": "MICROPHONE_DISCONNECTED",
  "message": "Audio input device became unavailable",
  "recoverable": true,
  "at_time_ms": 18420
}
```

Mã lỗi tối thiểu:

- `MICROPHONE_PERMISSION_DENIED`
- `MICROPHONE_DISCONNECTED`
- `UNSUPPORTED_AUDIO_FORMAT`
- `RESAMPLER_FAILURE`
- `WEBSOCKET_DISCONNECTED`
- `SERVER_BACKPRESSURE`
- `PROTOCOL_VERSION_UNSUPPORTED`
- `SESSION_NOT_FOUND`

## 16. Bảo mật và quyền riêng tư

- Chỉ truyền qua `WSS`.
- Token xác thực ngắn hạn; không đặt API key dài hạn trong web client.
- Không ghi raw audio mặc định trong production.
- Nếu bật recording để debug/demo, UI phải hiển thị trạng thái và có consent.
- Log metadata không chứa audio hoặc transcript nhạy cảm.
- Có retention policy và chức năng xóa theo `session_id`.
- Mỗi client chỉ được publish vào `session_id` và `source_id` đã được cấp quyền.

## 17. API nội bộ độc lập nền tảng

Các adapter web/mobile/desktop nên cùng triển khai interface logic:

```ts
interface AudioCaptureAdapter {
  start(config: CaptureConfig): Promise<void>;
  stop(): Promise<void>;
  onAudioFrame(handler: (frame: AudioFrame) => void): void;
  onDeviceState(handler: (state: DeviceState) => void): void;
}

interface AudioFrame {
  pcm: Int16Array;
  sampleRateHz: 16000;
  channels: 1;
  captureStartMs: number;
  durationMs: number;
}
```

Web implementation nên dùng:

- `navigator.mediaDevices.getUserMedia()` để xin microphone.
- `AudioWorklet` thay cho `ScriptProcessorNode` đã lỗi thời.
- Browser AEC/noise suppression/AGC constraints nếu khả dụng.
- Resampler đã kiểm thử khi input thực tế là `44.1/48 kHz`.

Ví dụ constraints:

```ts
const stream = await navigator.mediaDevices.getUserMedia({
  audio: {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
});
```

Các constraints là yêu cầu mong muốn; client phải kiểm tra `MediaTrackSettings` thực tế thay vì giả định trình duyệt đã áp dụng.

## 18. Tiêu chí chấp nhận giữa đội Voice và STT

### Functional

- STT nhận đúng PCM 16 kHz mono và decode không méo/tăng tốc/chậm tốc.
- Hai nguồn giữ `speaker_id`, `source_id`, `stream_id` riêng.
- STT nhận được hai utterance đồng thời khi hai người nói chồng.
- Từ đệm và ngập ngừng không bị Voice cố ý loại bỏ.
- Không mất đầu câu nhờ pre-roll.
- Không mất cuối câu do VAD đóng quá sớm.
- Reconnect không tạo transcript trùng.

### Performance

- Audio chunk được gửi trong vòng mục tiêu `<100 ms` sau capture.
- DSP trung bình `<20 ms` trên thiết bị demo.
- End-of-utterance được phát khoảng `500–700 ms` sau khi người nói dừng.
- Không tăng bộ nhớ vô hạn khi STT chậm.

### Robustness

- Hoạt động với tiếng quạt, điều hòa và hội thoại nền mức vừa phải.
- Có cảnh báo khi clipping, mic quá nhỏ hoặc noise quá cao.
- Mất microphone tạo error rõ ràng và có thể chọn lại thiết bị.
- Mất mạng ngắn có resend hoặc gap event minh bạch.

## 19. Bộ test tích hợp bắt buộc

1. Người A nói tiếng Việt, người B im lặng.
2. Người B nói tiếng Anh, người A im lặng.
3. A và B đổi lượt nhanh, khoảng nghỉ dưới một giây.
4. B chen một câu ngắn khi A đang nói.
5. A và B nói chồng trong `1–3 giây`.
6. Người nói dùng “ừm/ờ/uh/um” và dừng giữa câu.
7. Tiếng quạt/điều hòa liên tục.
8. Tiếng gõ bàn hoặc tiếng động xung ngắn.
9. TTS phát qua loa trong lúc microphone đang mở.
10. Rút microphone giữa utterance.
11. Mất mạng `2–5 giây`, sau đó reconnect.
12. STT cố ý xử lý chậm để kiểm tra backpressure.
13. Input browser `48 kHz` được resample đúng sang `16 kHz`.
14. Hai mic cùng thu vọng một người để đánh giá crosstalk.
15. Không ai nói trong `60–90 giây` (VAD giữ trạng thái `IDLE`) — xác nhận heartbeat ping/pong vẫn chạy và kết nối không bị proxy/load balancer đóng âm thầm.
16. Ngắt WebSocket đột ngột trong lúc `IDLE` (không có audio đang gửi) — xác nhận client phát hiện được qua mất pong, không phải chờ đến utterance kế tiếp mới biết mất kết nối.
17. Giả lập STT xử lý chậm dần đến ngưỡng cảnh báo — xác nhận client nhận `stream.throttle` trước khi bị `SERVER_BACKPRESSURE`.
18. Giả lập STT quá tải nghiêm trọng — xác nhận client nhận `error(SERVER_BACKPRESSURE)` kèm `retry_after_ms` và thực hiện `stream.resume` đúng sau thời gian chờ.
19. Một utterance chạm đúng giới hạn `maximum utterance` (`25–28s`) mà VAD chưa phát hiện điểm dừng — xác nhận continuation utterance được tạo đúng và STT xử lý liền mạch không mất từ ở điểm cắt.

Mỗi test cần lưu:

- Raw input (khi có consent).
- Cleaned output.
- Event timeline.
- Packet sequence/gap.
- STT transcript và latency.

## 20. Quyết định giữa Voice, STT và ingestion gateway (P4)

### 20.1 Đã chốt

| # | Quyết định | Ghi chú |
|---|---|---|
| D1 | Mỗi source một WebSocket riêng, không multiplex nhiều source trên 1 socket | §3.1, §6.1, §21 |
| D2 | Voice luôn gửi PCM 16 kHz mono; STT không cần resample | §3.3, §5.1 |
| D3 | ACK dang cumulative (highest_contiguous_sequence), phat mot lan sau moi utterance.end - khong ack theo chu ky thoi gian, khong ack tung chunk | §8.5 |
| D4 | Resend buffer mặc định `5s`. Voice tự own toàn bộ cơ chế này; không được làm trễ mốc audio E2E tối ngày 1 — nếu 15h ngày 1 chưa xong core events thì tự động rơi về bảng cắt MVP (§21) | §14, §21 |
| D5 | Voice sở hữu VAD và là tuyến duy nhất xác định ranh giới utterance, vì STT đã tắt `vad_filter` (Q-f) | §13 |
| D6 | `speaker_id` cấu hình tĩnh 1 mic = 1 speaker_id, không cần coordinator/diarization | §3.1, §3.2 |
| D7 | Overlap liên-stream do ingestion gateway (P4) tự suy ra từ `server_received_at`, không cần Voice gửi coordinator clock chung | §10.4 |
| D8 | Maximum utterance 25-28s (thap hon receptive field 30s cua Whisper). STT transcribe tung utterance rieng, KHONG ghep audio giua cac utterance - continuation_id duoc chuyen xuong tang Translation de giu ngu canh xuyen utterance, khong phai STT tu chunk noi bo | §13.1 |
| D9 | `language_hint` chỉ là gợi ý tĩnh, STT được phép override khi phát hiện code-switch tại runtime | §8.2 |
| D10 | `quality_summary` chỉ dùng để STT gắn cờ `low_confidence` (ví dụ SNR<10dB), không bao giờ dùng để từ chối transcribe | §12.3 |
| D11 | TTS phát mặc định qua headset của từng người, không qua loa ngoài | §12.2 |
| D12 | Voice resend cả `utterance.start` và `utterance.end` khi `stream.resume`, không chỉ audio.chunk, để tránh audio.chunk "mồ côi" sau reconnect | §8.6, §14 |
| D13 | `speech_probability` tại `utterance.start` tính theo cửa sổ xác nhận ≥120ms (không phải 1 frame đơn), kết hợp ZCR phụ trợ để giảm false-positive từ tiếng va đập | §13, nghiệm thu bằng test #8 |
| D14 | Đổi tên "STT gateway" → "ingestion gateway (P4)" xuyên suốt tài liệu | §2, §7, §8.7, §14.1 |
| D15 | Queue xử lý overlap theo `server_received_at` của `utterance.start` (thứ tự đến gateway), FIFO do P4 đẩy vào. Voice không delay nhân tạo phía client; trễ 1–2s khi overlap là do STT xử lý tuần tự, đã chấp nhận cho MVP | §10.4 |
| D16 | Mô hình `transcribe()` của P4→STT là **"periodic re-decode + final"** (không batch-một-lần, không streaming token-level) — chi tiết ở §20.3 | §20.3 (mới) |
| D17 | Cho phép raw audio recording trong demo (chế độ debug + consent hiển thị trên UI) để STT tune model + build test set. Retention: xóa toàn bộ sau hackathon | §16 |
| D18 | Latency target (PRD): partial ≤500ms từ lúc bắt đầu nói; final translation ≤2s sau end-of-speech; final transcript (riêng STT) ≤1s sau `utterance.end` | §18 |
| D19 | Nguong stream.throttle/SERVER_BACKPRESSURE cu the hoan sau hackathon - ha tang demo (1 laptop, 1 model instance) khong du de tune. So trong §14.1 giu nguyen la "de xuat", khong phai so chot | §14.1 |
| D20 | Khong co nhieu ingestion gateway instance de failover - chi 1 instance duy nhat cho demo. SERVER_BACKPRESSURE giu trong spec nhung demo se khong kich hoat | §14.1 |
| D21 | Heartbeat dùng default (`15–20s` / pong `5s`) cho mọi môi trường MVP, không chỉnh riêng LAN vs Wi-Fi hội trường | §8.7 |

### 20.2 Còn mở

Khong con cau hoi mo giua Voice va STT sau ban nay. Viec con lai thuoc ve trien khai (P4 xac nhan va implement server_received_at cho moi event/chunk theo D7/§10.4 - day la viec mo duy nhat ve kien truc, thuoc P4 khong thuoc Voice).

### 20.3 Mô hình `transcribe()` nội bộ P4→STT (tham khảo — không phải hợp đồng Voice↔gateway)

Interface: `transcribe(utterance_id, audio, language_hint, is_final)`.

Ten goi chinh thuc: **"periodic re-decode + final"** - khong phai batch-mot-lan-cuoi, cung khong phai streaming token-level, de tranh hieu nham chu "streaming":

1. Trong lúc utterance đang mở, P4 gọi `transcribe()` với `is_final=False`, truyền **toàn bộ audio tích lũy từ đầu utterance** (không phải chỉ chunk mới) → STT decode nhanh → emit **partial** cho UI.
2. Khi `utterance.end` tới, P4 gọi lần cuối với `is_final=True` trên toàn bộ audio → decode kỹ → emit **final**.

**Cập nhật 1.4 — nhịp partial tự điều tiết (đã triển khai):** benchmark thực tế (2026-07-17) cho thấy latency partial qua FPT Cloud p95 ~2.9s > nhịp 1s cố định → nhiều request bay song song và response về **sai thứ tự** (partial cũ đè text mới). Triển khai hiện tại thay nhịp cố định bằng hai guard ở gateway:

- `inFlightPartial`: không bắn partial mới khi partial trước chưa trả về — nhịp thực tế tự co giãn theo latency mạng (đo được ~0.4–1.1s/partial sau warmup).
- `finalized`: partial trả về **sau** khi final đã phát bị drop, không bao giờ có `stt.partial` sau `stt.final`.

**Sliding window phía STT (đã triển khai):** partial chỉ re-decode `6s` audio cuối (`PARTIAL_WINDOW_S`) thay vì toàn bộ buffer đang lớn dần → chi phí partial là O(1) theo độ dài utterance. Hệ quả cho UI: text partial là "cửa sổ đuôi", với câu dài hơn 6s phần đầu sẽ biến mất khỏi partial — UI phải hiển thị partial như dòng tạm (thay thế), không phải dòng tích lũy; final luôn là toàn văn. Final vẫn decode toàn bộ audio.

Hệ quả latency (số đo thật, xem §20.4): partial ~0.4–1.1s sau warmup; final ~0.6s + 450–600ms end-silence của VAD — đạt budget `≤1s` sau `utterance.end` (D18), nhưng partial ≤500ms từ lúc bắt đầu nói (D18) chỉ đạt sau warmup và với mạng ổn định.

### 20.4 Kết quả kiểm chứng model FPT & routing STT (bổ sung 1.4, đo thật 2026-07-17/18)

**Hành vi model đã kiểm chứng bằng call thật:**

| Model (trên `mkp-api.fptcloud.com`) | VI | EN | Ghi chú |
|---|---|---|---|
| `FPT.AI-whisper-large-v3-turbo` (fine-tune) | ✅ rất tốt | ❌ ra phonetic VN ("hello everyone" → "he lô e ri goăn") | Bỏ qua tham số `language`; không hỗ trợ `verbose_json` (trả 503); audio nhiễu/không phải giọng nói → 500 |
| `whisper-large-v3-turbo` (bản gốc) | ✅ tốt (bắt buộc truyền `language=vi`) | ✅ tốt | **Không truyền `language`** → tự DỊCH audio VI sang EN thay vì transcribe — lý do cấm hint `auto` |

**Routing đã chốt trong `stt/stt_service/service.py` (BACKEND=auto):**

| language_hint | partial | final |
|---|---|---|
| `vi` | `fpt` (fine-tune — nhanh, VI chuẩn) | `fpt_final` (bản gốc — code-switch) |
| `en` | `fpt_final` | `fpt_final` |
| khác/`auto` | chuẩn hóa thành `vi` | chuẩn hóa thành `vi` |

Fallback tự động fpt ↔ fpt_final khi backend chính lỗi (timeout/5xx). Groq bị 403 với IP Việt Nam nên loại khỏi routing mặc định (engine vẫn còn trong code).

**Tầng Translation (thuộc D8, đã có triển khai đầu tiên):** folder `translation/` ở root repo — `src/translator.ts` (logic thuần, timeout 8s), `src/prompts.ts` (prompt business meeting + glossary giữ thuật ngữ EN), `cli.ts` (debug không cần mic/STT). Gateway gọi sau `stt.final`, phát event `translation.final` (không thuộc wire contract Voice↔gateway — là event nội bộ demo). Model `Llama-3.3-70B-Instruct` trên FPT, đo thật ~0.6–1.2s/câu. Việc còn mở: ghép ngữ cảnh theo `continuation_id` (D8), streaming token.

**Latency E2E đo thật (simulate_client, 10s audio EN, 2026-07-18):** partial đầu (warmup) 1.14s, các partial sau 0.39–0.55s, final 0.58s, translation 1.14s. Tổng từ `utterance.end` đến bản dịch: ~1.7s.

**Cấu trúc repo tương ứng các tầng:** `voice/` (capture→VAD→stream + gateway demo tại `voice/src/mock-server/`), `stt/` (STT service :8001), `translation/` (dịch text), `backend/` (NestJS session/room — sẽ tiếp quản gateway + translation sau hackathon), `frontend/` (UI React, chờ backend Socket.IO).

## 21. MVP đề xuất cho hackathon

Để giảm rủi ro trong hai ngày:

- Hai web client, mỗi client trên một máy, mỗi máy cắm một tai nghe có mic riêng (§3.1, đã chốt).
- Mỗi source một WebSocket.
- Browser capture với AEC/noise suppression/AGC; kiểm tra settings thực tế.
- Normalize thành PCM signed 16-bit, mono, 16 kHz.
- AudioWorklet + VAD với pre-roll `250 ms`, end silence `600 ms`.
- Binary frame gồm JSON metadata và PCM payload.
- Các event tối thiểu: `session.start`, `source.register`, `utterance.start`, `audio.chunk`, `utterance.end`, `stream.ack`, `heartbeat.ping`/`heartbeat.pong`, `error`.
- `stream.throttle` có thể trì hoãn sau MVP nếu thiếu thời gian, nhưng `SERVER_BACKPRESSURE` và heartbeat nên có ngay vì ảnh hưởng trực tiếp đến độ ổn định demo live.
- Maximum utterance đặt `25s` (không phải `30s`) để an toàn với receptive field của Whisper.
- Ring buffer resend `5 giây`.
- Lưu raw/clean audio chỉ trong chế độ debug có consent.

Sau MVP mới bổ sung Opus và adaptive noise processing. Diarization cho mic chung **không** nằm trong roadmap của bản hackathon này vì cấu hình 2 mic định hướng đã loại bỏ nhu cầu này (xem §3.2).
