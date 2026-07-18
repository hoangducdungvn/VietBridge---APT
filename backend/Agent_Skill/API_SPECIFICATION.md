# VietBridge Backend API Specification

This document is the source of truth for REST and Socket.IO APIs that are implemented and runnable in the current backend.

## Mandatory API documentation rule

- Every addition, modification, rename, or deletion of an API must update this file in the same code change.
- An API change includes method, URI, headers, authentication, rate limit, path/query/body validation, status code, request schema, response schema, error code, or observable behavior.
- Update both the API summary and the detailed endpoint section.
- Do not mark an API as available until its implementation passes lint, tests, and build.
- Do not document planned Socket.IO events or future APIs as available. Clearly label future behavior separately.

## Current implementation scope

- Completed through the MVP bilingual-message vertical slice: room, realtime turn/audio ingestion, remote STT, remote translation, and room-wide bilingual results.
- Transports currently available: REST over HTTP and Socket.IO on the same backend origin.
- Socket authentication, room membership, participant presence, concurrent participant audio segments, ordered PCM buffering, cleanup, FastAPI STT partial/final calls, FPT LLM translation, and room broadcasting are implemented.
- `translation.started` and bilingual `message.final` are implemented. Recent conversation context, dynamic glossary management, message replay, and production persistence are not implemented yet.
- State is stored in memory and is lost whenever the backend process restarts.

## Base URL

Default local URL:

```text
http://localhost:3000
```

The bind address is controlled by `HOST` (`127.0.0.1` by default) and the port by `PORT`. Postman examples use:

```text
{{baseUrl}} = http://localhost:3000
```

## Common conventions

### Request format

- JSON requests must use `Content-Type: application/json`.
- Unknown JSON body properties are rejected.
- `displayName` is trimmed and must contain 1–80 characters.
- Language codes are exactly `vi` or `en`.
- The lobby always exposes five fixed room slots: `APT001` through `APT005`. Lowercase path input is normalized to uppercase.
- Session IDs use `session_<uuid>`.

### Authentication

- Current REST endpoints do not require an `Authorization` header.
- Create and join responses return an opaque participant `accessToken`.
- A token is tied to its `sessionId` and `participantId`, expires after 15 minutes, and is revoked when the session ends.
- Socket.IO clients must send the token in `auth.accessToken`; invalid or expired tokens fail the handshake with `connect_error` code/message `INVALID_TOKEN`.
- Access tokens must not be logged or committed.

### Rate limiting

- `POST /api/sessions` and `POST /api/sessions/:roomCode/join` allow 20 requests per 60 seconds per client address and endpoint handler.
- Exceeding the limit returns HTTP `429` with code `RATE_LIMIT_EXCEEDED`.

### Browser origins

- Development accepts the frontend on `localhost`, loopback, or private-LAN IPv4 addresses using port `5173` or `4173`.
- Production accepts only the comma-separated origins explicitly configured in `CORS_ORIGIN`.
- The same policy applies to REST and Socket.IO handshakes.

### Error response

All handled HTTP errors use this format:

```json
{
  "statusCode": 400,
  "code": "VALIDATION_ERROR",
  "message": "Request validation failed.",
  "details": ["sourceLanguage must be one of the following values: vi, en"],
  "path": "/api/sessions",
  "timestamp": "2026-07-17T12:00:00.000Z"
}
```

`details` is optional and is normally present for validation failures.

## API summary

| Method | URI | Success | Description |
|---|---|---:|---|
| `GET` | `/health` | `200` | Check backend availability. |
| `GET` | `/api/rooms` | `200` | List all five lobby slots and their real occupancy. |
| `POST` | `/api/sessions` | `201` | Create a session and host in an empty lobby slot. |
| `GET` | `/api/sessions/:roomCode` | `200` | Get current session and participant state. |
| `POST` | `/api/sessions/:roomCode/join` | `200` | Join a guest as the second participant. |
| `POST` | `/api/sessions/:sessionId/end` | `200` | End a session idempotently. |

## GET `/health`

Checks whether the NestJS backend is running.

### Request

```http
GET {{baseUrl}}/health
```

No body or authentication is required.

### Success response — `200 OK`

```json
{
  "service": "vietbridge-backend",
  "status": "ok"
}
```

## POST `/api/sessions`

Creates a translation session and its host participant in an empty lobby slot. The new session starts in `waiting` state. Pass `roomCode` to create in a selected empty card; omit it to allocate the first empty slot.

### Request

```http
POST {{baseUrl}}/api/sessions
Content-Type: application/json
```

```json
{
  "displayName": "Duong",
  "roomCode": "APT001",
  "sourceLanguage": "vi"
}
```

### Success response — `201 Created`

```json
{
  "accessToken": "opaque-participant-token",
  "participantId": "participant_4c785513-9f3f-4df2-a6fb-475190aa5ce6",
  "roomCode": "APT001",
  "sessionId": "session_cb6493e6-934a-41ce-a881-71e944bb192c",
  "status": "waiting"
}
```

The host participant is stored with role `host`, connection status `offline`, and the inverse target language (`vi → en`, `en → vi`).

### Errors

- `400 VALIDATION_ERROR`: invalid/missing name, unsupported room slot, invalid language, or unknown body field.
- `409 ROOM_UNAVAILABLE`: the explicitly selected room is occupied.
- `409 LOBBY_FULL`: all five room slots are occupied when no room was selected.
- `429 RATE_LIMIT_EXCEEDED`: create limit exceeded.

## GET `/api/rooms`

Returns exactly five lobby cards in stable order. Empty and closed slots have no participants. Waiting/full slots derive occupancy from the current in-memory session and never expose display names or access tokens.

### Request

```http
GET {{baseUrl}}/api/rooms
```

### Success response — `200 OK`

```json
[
  {
    "occupancy": 1,
    "participants": [
      {
        "connectionStatus": "online",
        "participantId": "participant_4c785513-9f3f-4df2-a6fb-475190aa5ce6",
        "sourceLanguage": "vi"
      }
    ],
    "roomCode": "APT001",
    "roomName": "Room 1",
    "status": "waiting"
  },
  {
    "occupancy": 0,
    "participants": [],
    "roomCode": "APT002",
    "roomName": "Room 2",
    "status": "empty"
  }
]
```

The actual response continues through `APT005`. `status` is `empty`, `waiting`, or `full`; `occupancy` is `0`, `1`, or `2`.

## GET `/api/sessions/:roomCode`

Returns the current in-memory session state and its participants. It never returns access tokens.

### Request

```http
GET {{baseUrl}}/api/sessions/{{roomCode}}
```

Example:

```http
GET {{baseUrl}}/api/sessions/APT001
```

### Success response — `200 OK`

```json
{
  "createdAt": 1784293000000,
  "participants": [
    {
      "connectionStatus": "offline",
      "displayName": "Duong",
      "participantId": "participant_4c785513-9f3f-4df2-a6fb-475190aa5ce6",
      "role": "host",
      "sourceLanguage": "vi",
      "targetLanguage": "en"
    }
  ],
  "roomCode": "APT001",
  "sessionId": "session_cb6493e6-934a-41ce-a881-71e944bb192c",
  "status": "waiting"
}
```

Optional response fields:

- `startedAt`: present after the second participant joins.
- `closedAt`: present after the session ends.

Timestamp values in session state are Unix epoch milliseconds.

### Errors

- `400 VALIDATION_ERROR`: room code format is invalid.
- `404 SESSION_NOT_FOUND`: a valid room code does not identify a stored session.

## POST `/api/sessions/:roomCode/join`

Creates the guest participant, adds it to the session, and changes the session from `waiting` to `active`.

### Request

```http
POST {{baseUrl}}/api/sessions/{{roomCode}}/join
Content-Type: application/json
```

```json
{
  "displayName": "Alex",
  "sourceLanguage": "en"
}
```

### Success response — `200 OK`

```json
{
  "accessToken": "opaque-guest-token",
  "participantId": "participant_f84db7d2-9f58-4030-a8f9-49654bdbb44f",
  "sessionId": "session_cb6493e6-934a-41ce-a881-71e944bb192c",
  "status": "active"
}
```

### Errors

- `400 VALIDATION_ERROR`: invalid room code, name, language, or unknown body field.
- `404 SESSION_NOT_FOUND`: the room code is valid but not stored.
- `409 SESSION_CLOSED`: the session is closing or closed.
- `409 SESSION_FULL`: the session already contains two participants.
- `409 LANGUAGE_PAIR_CONFLICT`: the guest selected the same source language as the host.
- `429 RATE_LIMIT_EXCEEDED`: join limit exceeded.

### Language-pair behavior

- Each participant receives the inverse target language automatically.
- Host `vi` accepts only guest `en`; host `en` accepts only guest `vi`.
- A conflict does not create a participant or change the session out of `waiting`.

## POST `/api/sessions/:sessionId/end`

Ends an existing session, revokes all participant tokens belonging to it, and purges its in-memory conversation data.

The operation is idempotent: calling it again for an already closed session returns the same successful state.

On the first successful end, the backend removes completed transcript text, active/buffered audio turns, recent turn IDs, partial-STT scheduling state, and glossary/context placeholders for that session. Participant identity and the closed session shell remain only for idempotency; the lobby slot becomes empty and reusable.

### Request

```http
POST {{baseUrl}}/api/sessions/{{sessionId}}/end
```

No body or authentication is currently required.

### Success response — `200 OK`

```json
{
  "sessionId": "session_cb6493e6-934a-41ce-a881-71e944bb192c",
  "status": "closed"
}
```

### Errors

- `400 VALIDATION_ERROR`: session ID format is invalid.
- `404 SESSION_NOT_FOUND`: the session ID is valid but not stored.

## Socket.IO realtime API

Socket.IO uses the same origin as REST (`http://localhost:3000` by default). Connect with the opaque token returned by create/join:

```ts
io('http://localhost:3000', {
  auth: { accessToken },
  transports: ['websocket']
});
```

An invalid, expired, or revoked token fails the handshake with `connect_error` and code/message `INVALID_TOKEN`. The token is never included in normal event payloads or logs.

### Available server events

- `session.state`: current session status and participant presence.
- `participant.joined`: a participant socket became online.
- `participant.left`: a participant socket became offline.
- `turn.accepted`: this participant's audio segment was created.
- `turn.rejected`: this participant's start request was invalid or duplicated.
- `pipeline.error`: invalid identity, turn state, audio, sequence, STT, or translation processing.
- `stt.partial`: a best-effort source transcript after roughly each 2 seconds of accumulated speech.
- `stt.final`: the authoritative source transcript after a successful `turn.end`.
- `translation.started`: final STT was accepted and translation has started.
- `message.final`: the authoritative bilingual source/translation message for one completed turn.

Server JSON events follow the documented envelope with `type`, `sessionId`, optional participant/turn identifiers, `serverTimestamp`, and `payload`.

### Client `turn.start`

```json
{
  "type": "turn.start",
  "eventId": "evt-start-1",
  "sessionId": "session_...",
  "participantId": "participant_...",
  "payload": {
    "audioConfig": {
      "codec": "pcm_s16le",
      "sampleRate": 16000,
      "channels": 1
    }
  }
}
```

There is no session-wide active-speaker lock and `TURN_BUSY` is not emitted. Host and guest may each stream an audio segment at the same time from separate devices. A participant may have only one segment in `started`/`streaming` state. A new `turn.start` from that participant supersedes and cleans up any stale capturing segment before returning a new `turn.accepted`; a previous segment already in final-STT processing does not block the next segment.

### Client `audio.chunk`

```ts
socket.emit('audio.chunk', {
  sessionId,
  participantId,
  turnId,
  sequence: 0,
  audio: pcm16Buffer
});
```

- `audio` must be binary PCM signed 16-bit, 16 kHz, mono; Base64 and raw-audio logging are not used.
- Sequence starts at `0` and must increase by exactly one.
- Each chunk is limited to 64,000 bytes and each turn to approximately 25 seconds (800,000 PCM bytes).
- Unknown turns, wrong ownership, invalid binary data, and out-of-order chunks emit `pipeline.error`.
- A stream error fails only the owning participant's segment and clears its in-memory audio; the other participant's stream is unaffected.

### Client `turn.end` and `turn.cancel`

```json
{
  "type": "turn.end",
  "eventId": "evt-end-1",
  "sessionId": "session_...",
  "participantId": "participant_...",
  "turnId": "turn_...",
  "payload": {}
}
```

`turn.end` is idempotent: a duplicate does not emit another `stt.final`, call translation again, or emit another `message.final`. End/final, cancel, and error paths clear that segment's buffered audio. Disconnecting a participant cancels and cleans all of that participant's open segments without touching the other participant.

With `STT_PROVIDER=remote`, `turn.end` sends all accumulated raw PCM to `${STT_BASE_URL}/v1/transcribe` as multipart fields `file`, `utterance_id`, `language_hint`, and `is_final`. The language hint comes from the authenticated participant record, never from an audio event.

### Server `stt.partial` and `stt.final`

```json
{
  "type": "stt.final",
  "sessionId": "session_...",
  "turnId": "turn_...",
  "serverTimestamp": 1784293000000,
  "payload": {
    "backend": "fpt",
    "language": "vi",
    "lowConfidence": false,
    "participantId": "participant_...",
    "providerLatencyMs": 918.4,
    "text": "Xin chào"
  }
}
```

- Both events are broadcast to all connected participants in the session room.
- Partial requests re-decode the accumulated turn audio and allow at most one request in flight per turn.
- A final supersedes pending partial output. Provider failure emits `pipeline.error` with `STT_TIMEOUT`, `STT_PROVIDER_UNAVAILABLE`, or `STT_PROVIDER_ERROR` and cleans only the failed segment.
- The backend never logs or persists raw audio or provider API keys.

### Server `translation.started` and `message.final`

After a non-empty `stt.final`, the backend resolves the authenticated speaker's target language, emits `translation.started`, calls the configured Translation provider once, and broadcasts one `message.final` to both participants:

```json
{
  "type": "message.final",
  "sessionId": "session_...",
  "turnId": "turn_...",
  "serverTimestamp": 1784293001200,
  "payload": {
    "messageId": "message_...",
    "sequence": 1,
    "speaker": {
      "participantId": "participant_...",
      "displayName": "Duong"
    },
    "sourceLanguage": "vi",
    "targetLanguage": "en",
    "sourceText": "Xin chào",
    "translatedText": "Hello",
    "latency": {
      "sttFinalMs": 918.4,
      "translationMs": 642,
      "endToEndMs": 1710
    },
    "createdAt": 1784293001190
  }
}
```

- `sourceLanguage` and `targetLanguage` come from the authenticated participant record; clients cannot override the translation direction in audio events.
- `sequence` is allocated when the turn starts and lets clients retain conversation order even when two devices finish concurrently.
- With `TRANSLATION_PROVIDER=remote`, the backend calls `LLM_URL` using `FPT_API_KEY`, `LLM_MODEL`, and `TRANSLATION_TIMEOUT_MS`. The key remains server-side.
- `NODE_ENV=test` always selects the mock Translation provider. `TRANSLATION_PROVIDER=mock` is also available for local orchestration tests.
- A provider timeout emits recoverable `pipeline.error` code `TRANSLATION_TIMEOUT`; other provider failures emit `TRANSLATION_UNAVAILABLE`. The already-broadcast source `stt.final` remains available, but no incomplete `message.final` is emitted.
- Empty final STT text is not sent to the Translation provider.

## Recommended Postman flow

1. Call `GET /health`.
2. Call `GET /api/rooms` and verify `APT001`–`APT005` are returned.
3. Call `POST /api/sessions` with an empty `roomCode`; store `sessionId` and the host `accessToken`.
4. Call `GET /api/rooms` and verify that card is `waiting` with occupancy `1`.
5. Attempt a join with the host language and verify `409 LANGUAGE_PAIR_CONFLICT`.
6. Join with the opposite language and store the guest `accessToken`.
7. Call `GET /api/rooms` and verify that card is `full` with occupancy `2`.
8. Attempt a third join and verify `409 SESSION_FULL`.
9. Call `POST /api/sessions/:sessionId/end` twice and verify both responses are `200 closed`.
10. Call `GET /api/rooms` and verify the ended slot is empty and reusable.

Use the frontend or the automated Socket.IO e2e suite for realtime events; Postman is sufficient for the REST flow.

## Change history

| Phase | Change |
|---|---|
| Phase 1 | Added `GET /health`. |
| Phase 2 | Added create, state, join, and end-session REST APIs. |
| Language rule | Added `409 LANGUAGE_PAIR_CONFLICT` for equal host/guest source languages. |
| Phase 3 | Added authenticated Socket.IO room membership and participant presence events. |
| Phase 4 | Added turn lock, ordered PCM ingestion, cleanup, idempotent end, and mock `stt.final`. |
| MVP STT | Added FastAPI multipart adapter, 2-second partial scheduling, real final STT, latency/error mapping, and room-wide source transcript events. |
| LAN invite fix | Allowed development frontend origins on private LAN addresses so invite links work across two machines. |
| Five-room lobby | Added fixed `APT001`–`APT005` slots, `GET /api/rooms`, selected-slot creation, real occupancy, and reusable ended slots. |
| Meeting cleanup | End-session now purges all in-memory turn audio/transcript/partial state; the frontend clears visible transcript state immediately. |
| Independent microphones | Removed the session-wide speaker lock and `TURN_BUSY`; both participants may stream and finish STT segments concurrently. |
| MVP Translation | Added remote FPT LLM translation, `translation.started`, idempotent bilingual `message.final`, language-safe routing, latency metadata, and frontend speaker-relative rendering. |
