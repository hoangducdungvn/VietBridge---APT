# 4. Domain Models & State Machines

## 4.1 TranslationSession

```ts
type SessionStatus =
  | 'waiting'
  | 'active'
  | 'closing'
  | 'closed'
  | 'error';

interface TranslationSession {
  sessionId: string;
  roomCode: string;
  status: SessionStatus;
  participantIds: string[];
  activeTurnId?: string;
  recentTurnIds: string[];
  glossary: Record<string, string>;
  createdAt: number;
  startedAt?: number;
  lastActivityAt: number;
  closedAt?: number;
}
```

Quy tắc:

- MVP tối đa 2 participant.
- Một session tối đa 1 active turn.
- `activeTurnId` phải được xóa khi turn hoàn tất, thất bại hoặc bị hủy.
- Session `closed` không nhận turn mới.

## 4.2 Participant

```ts
type LanguageCode = 'vi' | 'en';
type ParticipantRole = 'host' | 'guest';
type ConnectionStatus = 'online' | 'offline';

interface Participant {
  participantId: string;
  sessionId: string;
  displayName: string;
  role: ParticipantRole;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  socketId?: string;
  connectionStatus: ConnectionStatus;
  joinedAt: number;
  lastSeenAt: number;
}
```

Quy tắc:

- `targetLanguage` luôn là ngôn ngữ còn lại.
- `vi → en`.
- `en → vi`.
- Một participant chỉ thuộc một session trong MVP.

## 4.3 ConversationTurn

```ts
type TurnStatus =
  | 'started'
  | 'streaming'
  | 'speech_ended'
  | 'stt_final'
  | 'translating'
  | 'completed'
  | 'failed'
  | 'cancelled';

interface ConversationTurn {
  turnId: string;
  sessionId: string;
  participantId: string;
  sequence: number;
  status: TurnStatus;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  partialText?: string;
  sourceText?: string;
  translatedText?: string;
  confidence?: number;
  errorCode?: string;
  startedAt: number;
  firstAudioAt?: number;
  lastAudioAt?: number;
  speechEndedAt?: number;
  firstPartialAt?: number;
  sttFinalAt?: number;
  translationStartedAt?: number;
  translationCompletedAt?: number;
  completedAt?: number;
}
```

## 4.4 BilingualMessage

```ts
interface BilingualMessage {
  messageId: string;
  sessionId: string;
  turnId: string;
  sequence: number;
  speaker: {
    participantId: string;
    displayName: string;
  };
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  sourceText: string;
  translatedText: string;
  latency: {
    sttFirstPartialMs?: number;
    sttFinalMs?: number;
    translationMs?: number;
    endToEndMs?: number;
  };
  createdAt: number;
}
```

## 4.5 Session state machine

```text
waiting
  ↓ participant thứ hai join
active
  ↓ host end hoặc TTL
closing
  ↓ cleanup xong
closed
```

Lỗi recoverable:

```text
active → error → active
```

Không được:

```text
closed → active
```

## 4.6 Turn state machine

```text
started
  ↓ audio đầu tiên
streaming
  ↓ turn.end
speech_ended
  ↓ STT final
stt_final
  ↓ gọi Translation
translating
  ↓ Translation thành công
completed
```

Nhánh lỗi:

```text
started/streaming/speech_ended/stt_final/translating
  → failed
```

Hủy:

```text
started/streaming
  → cancelled
```

## 4.7 Quy tắc trạng thái

- Partial STT tới sau `completed` phải bỏ qua.
- `turn.end` lặp lại phải idempotent.
- `turn.start` khi có active turn phải reject.
- Audio chunk không có active turn phải reject hoặc drop có log.
- Translation result sai `turnId` phải bỏ qua.
- Turn chỉ được thêm vào context khi `completed`.
