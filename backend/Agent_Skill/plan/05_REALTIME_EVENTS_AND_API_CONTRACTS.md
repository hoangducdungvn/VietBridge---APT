# 5. Realtime Events & REST API Contracts

## 5.1 Envelope chung

Tất cả JSON event:

```ts
interface RealtimeEvent<T> {
  type: string;
  eventId: string;
  sessionId: string;
  participantId?: string;
  turnId?: string;
  sequence?: number;
  clientTimestamp?: number;
  serverTimestamp?: number;
  payload: T;
}
```

## 5.2 Client → Backend events

### `session.connect`

```json
{
  "type": "session.connect",
  "eventId": "evt_001",
  "sessionId": "session_123",
  "participantId": "participant_a",
  "payload": {
    "accessToken": "short-lived-token"
  }
}
```

### `participant.ready`

```json
{
  "type": "participant.ready",
  "eventId": "evt_002",
  "sessionId": "session_123",
  "participantId": "participant_a",
  "payload": {}
}
```

### `turn.start`

```json
{
  "type": "turn.start",
  "eventId": "evt_003",
  "sessionId": "session_123",
  "participantId": "participant_a",
  "payload": {
    "audioConfig": {
      "codec": "pcm_s16le",
      "sampleRate": 16000,
      "channels": 1
    }
  }
}
```

### `audio.chunk`

Ưu tiên binary frame.

Metadata tối thiểu phải gắn được:

- `sessionId`
- `participantId`
- `turnId`
- `sequence`

Có thể gửi metadata JSON trước binary hoặc đóng custom binary header. Với hackathon, cách đơn giản là emit Socket.IO event có object metadata và Buffer.

### `turn.end`

```json
{
  "type": "turn.end",
  "eventId": "evt_010",
  "sessionId": "session_123",
  "participantId": "participant_a",
  "turnId": "turn_001",
  "payload": {}
}
```

### `turn.cancel`

```json
{
  "type": "turn.cancel",
  "eventId": "evt_011",
  "sessionId": "session_123",
  "participantId": "participant_a",
  "turnId": "turn_001",
  "payload": {}
}
```

### `glossary.update`

```json
{
  "type": "glossary.update",
  "eventId": "evt_012",
  "sessionId": "session_123",
  "participantId": "participant_a",
  "payload": {
    "terms": {
      "NIC": "National Innovation Center",
      "MoU": "Memorandum of Understanding"
    }
  }
}
```

## 5.3 Backend → Client events

### `session.state`

```json
{
  "type": "session.state",
  "sessionId": "session_123",
  "payload": {
    "status": "active",
    "participants": [
      {
        "participantId": "participant_a",
        "displayName": "Duong",
        "sourceLanguage": "vi",
        "connectionStatus": "online"
      },
      {
        "participantId": "participant_b",
        "displayName": "Alex",
        "sourceLanguage": "en",
        "connectionStatus": "online"
      }
    ]
  }
}
```

### `turn.accepted`

```json
{
  "type": "turn.accepted",
  "sessionId": "session_123",
  "participantId": "participant_a",
  "turnId": "turn_001",
  "payload": {
    "sequence": 1
  }
}
```

### `turn.rejected`

```json
{
  "type": "turn.rejected",
  "sessionId": "session_123",
  "participantId": "participant_b",
  "payload": {
    "code": "TURN_BUSY",
    "message": "Another participant is currently speaking."
  }
}
```

### `stt.partial`

```json
{
  "type": "stt.partial",
  "sessionId": "session_123",
  "turnId": "turn_001",
  "payload": {
    "participantId": "participant_a",
    "text": "Chúng tôi muốn..."
  }
}
```

### `stt.final`

```json
{
  "type": "stt.final",
  "sessionId": "session_123",
  "turnId": "turn_001",
  "payload": {
    "participantId": "participant_a",
    "text": "Chúng tôi muốn bắt đầu vào tháng Chín.",
    "language": "vi",
    "confidence": 0.94
  }
}
```

### `translation.started`

```json
{
  "type": "translation.started",
  "sessionId": "session_123",
  "turnId": "turn_001",
  "payload": {}
}
```

### `message.final`

```json
{
  "type": "message.final",
  "sessionId": "session_123",
  "turnId": "turn_001",
  "payload": {
    "messageId": "msg_001",
    "sequence": 1,
    "speaker": {
      "participantId": "participant_a",
      "displayName": "Duong"
    },
    "sourceLanguage": "vi",
    "targetLanguage": "en",
    "sourceText": "Chúng tôi muốn bắt đầu vào tháng Chín.",
    "translatedText": "We would like to begin in September.",
    "latency": {
      "sttFinalMs": 720,
      "translationMs": 360,
      "endToEndMs": 1180
    },
    "createdAt": 0
  }
}
```

### `pipeline.error`

```json
{
  "type": "pipeline.error",
  "sessionId": "session_123",
  "turnId": "turn_001",
  "payload": {
    "code": "TRANSLATION_TIMEOUT",
    "message": "Translation service timed out.",
    "recoverable": true
  }
}
```

## 5.4 REST API

### Tạo session

```http
POST /api/sessions
```

Request:

```json
{
  "displayName": "Duong",
  "sourceLanguage": "vi"
}
```

Response:

```json
{
  "sessionId": "session_123",
  "roomCode": "APT123",
  "participantId": "participant_a",
  "accessToken": "token",
  "status": "waiting"
}
```

### Join session

```http
POST /api/sessions/:roomCode/join
```

Request:

```json
{
  "displayName": "Alex",
  "sourceLanguage": "en"
}
```

Response:

```json
{
  "sessionId": "session_123",
  "participantId": "participant_b",
  "accessToken": "token",
  "status": "active"
}
```

### Session state

```http
GET /api/sessions/:roomCode
```

### End session

```http
POST /api/sessions/:sessionId/end
```

### Health

```http
GET /health
```

## 5.5 Error codes tối thiểu

- `SESSION_NOT_FOUND`
- `SESSION_FULL`
- `SESSION_CLOSED`
- `PARTICIPANT_NOT_FOUND`
- `INVALID_TOKEN`
- `TURN_BUSY`
- `TURN_NOT_FOUND`
- `INVALID_TURN_STATE`
- `INVALID_AUDIO_CONFIG`
- `AUDIO_CHUNK_OUT_OF_ORDER`
- `STT_UNAVAILABLE`
- `STT_TIMEOUT`
- `TRANSLATION_UNAVAILABLE`
- `TRANSLATION_TIMEOUT`
- `PROVIDER_ERROR`
- `INTERNAL_ERROR`
