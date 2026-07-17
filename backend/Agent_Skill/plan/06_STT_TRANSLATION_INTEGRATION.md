# 6. STT & Translation Integration

## 6.1 Mục tiêu

Backend phải tách provider-specific code khỏi business logic.

Không gọi trực tiếp provider trong gateway.

## 6.2 STT Provider Interface

```ts
interface AudioConfig {
  codec: string;
  sampleRate: number;
  channels: number;
}

interface SttPartialResult {
  sessionId: string;
  turnId: string;
  text: string;
  confidence?: number;
  providerLatencyMs?: number;
}

interface SttFinalResult {
  sessionId: string;
  turnId: string;
  text: string;
  language: 'vi' | 'en';
  confidence?: number;
  providerLatencyMs?: number;
}

interface StreamingSttProvider {
  startTurn(input: {
    sessionId: string;
    turnId: string;
    participantId: string;
    language: 'vi' | 'en';
    audioConfig: AudioConfig;
  }): Promise<void>;

  sendAudio(input: {
    sessionId: string;
    turnId: string;
    sequence: number;
    audio: Buffer;
  }): Promise<void>;

  finishTurn(input: {
    sessionId: string;
    turnId: string;
  }): Promise<void>;

  cancelTurn(input: {
    sessionId: string;
    turnId: string;
  }): Promise<void>;

  closeSession(sessionId: string): Promise<void>;
}
```

Provider adapter phải expose event/callback cho:

- Partial.
- Final.
- Error.
- Disconnect.

## 6.3 STT contract với team khác

Input:

- `sessionId`
- `turnId`
- `participantId`
- `language`
- `audioConfig`
- Ordered binary audio chunks
- Finalize signal

Output:

- Partial transcript
- Final transcript
- Confidence nếu có
- Error code
- Provider latency nếu có

## 6.4 Translation Provider Interface

```ts
interface ContextTurn {
  sourceLanguage: 'vi' | 'en';
  sourceText: string;
  translatedText: string;
}

interface TranslationInput {
  requestId: string;
  sessionId: string;
  turnId: string;
  sourceLanguage: 'vi' | 'en';
  targetLanguage: 'vi' | 'en';
  sourceText: string;
  context: ContextTurn[];
  glossary: Record<string, string>;
}

interface TranslationResult {
  requestId: string;
  sessionId: string;
  turnId: string;
  sourceLanguage: 'vi' | 'en';
  targetLanguage: 'vi' | 'en';
  translatedText: string;
  providerLatencyMs?: number;
}

interface TranslationProvider {
  translate(input: TranslationInput): Promise<TranslationResult>;
}
```

## 6.5 Yêu cầu Translation

- Bảo toàn số liệu.
- Bảo toàn phần trăm.
- Bảo toàn đơn vị tiền.
- Giữ tên riêng.
- Tôn trọng glossary.
- Dịch tự nhiên theo ngữ cảnh kinh doanh.
- Không thêm giải thích.
- Không trả markdown.
- Không thay đổi JSON schema.
- Timeout rõ ràng.
- Retry tối đa 1 lần trong MVP.

## 6.6 Context strategy

Chỉ gửi 4–8 completed turns gần nhất.

Không gửi partial turns.

Không gửi raw audio.

Có thể format:

```json
[
  {
    "sourceLanguage": "vi",
    "sourceText": "Chúng tôi đang thảo luận về dự án Alpha.",
    "translatedText": "We are discussing Project Alpha."
  }
]
```

## 6.7 Mock adapters

Phải triển khai mock trước provider thật.

### Mock STT

- `startTurn`: lưu state.
- `sendAudio`: chấp nhận Buffer.
- Có thể phát partial cố định hoặc theo fixture.
- `finishTurn`: trả final sau delay cấu hình.

### Mock Translation

- Nhận source text.
- Trả bản dịch fixture.
- Có delay mô phỏng latency.
- Có chế độ mô phỏng timeout/error.

## 6.8 Timeout

Biến môi trường:

```env
STT_START_TIMEOUT_MS=5000
STT_FINAL_TIMEOUT_MS=8000
TRANSLATION_TIMEOUT_MS=5000
```

## 6.9 Retry

- STT streaming disconnect: reconnect tối đa 1 lần nếu provider hỗ trợ.
- Translation timeout: retry 1 lần với cùng `requestId`.
- Không retry audio chunks vô hạn.
