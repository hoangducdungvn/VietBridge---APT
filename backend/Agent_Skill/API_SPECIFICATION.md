# VietBridge Backend API Specification

This document is the source of truth for REST APIs that are implemented and runnable in the current backend.

## Mandatory API documentation rule

- Every addition, modification, rename, or deletion of an API must update this file in the same code change.
- An API change includes method, URI, headers, authentication, rate limit, path/query/body validation, status code, request schema, response schema, error code, or observable behavior.
- Update both the API summary and the detailed endpoint section.
- Do not mark an API as available until its implementation passes lint, tests, and build.
- Do not document planned Socket.IO events or future APIs as available. Clearly label future behavior separately.

## Current implementation scope

- Completed through Phase 2 — Session & Participant.
- Transport currently available: REST over HTTP.
- Socket.IO, reconnect, turns, audio, STT, Translation, Context, and Messaging APIs are not implemented yet.
- State is stored in memory and is lost whenever the backend process restarts.

## Base URL

Default local URL:

```text
http://localhost:3000
```

The port is controlled by `PORT`. Postman examples use:

```text
{{baseUrl}} = http://localhost:3000
```

## Common conventions

### Request format

- JSON requests must use `Content-Type: application/json`.
- Unknown JSON body properties are rejected.
- `displayName` is trimmed and must contain 1–80 characters.
- Language codes are exactly `vi` or `en`.
- Room codes use `APTxxx`, where each `x` is an uppercase letter or digit. Lowercase path input is normalized to uppercase.
- Session IDs use `session_<uuid>`.

### Authentication

- Current REST endpoints do not require an `Authorization` header.
- Create and join responses return an opaque participant `accessToken`.
- A token is tied to its `sessionId` and `participantId`, expires after 15 minutes, and is revoked when the session ends.
- Token verification will be used by the Socket.IO handshake in Phase 3; it is not yet exposed as a REST operation.
- Access tokens must not be logged or committed.

### Rate limiting

- `POST /api/sessions` and `POST /api/sessions/:roomCode/join` allow 20 requests per 60 seconds per client address and endpoint handler.
- Exceeding the limit returns HTTP `429` with code `RATE_LIMIT_EXCEEDED`.

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
| `POST` | `/api/sessions` | `201` | Create a session and its host participant. |
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

Creates a translation session and its host participant. The new session starts in `waiting` state.

### Request

```http
POST {{baseUrl}}/api/sessions
Content-Type: application/json
```

```json
{
  "displayName": "Duong",
  "sourceLanguage": "vi"
}
```

### Success response — `201 Created`

```json
{
  "accessToken": "opaque-participant-token",
  "participantId": "participant_4c785513-9f3f-4df2-a6fb-475190aa5ce6",
  "roomCode": "APT123",
  "sessionId": "session_cb6493e6-934a-41ce-a881-71e944bb192c",
  "status": "waiting"
}
```

The host participant is stored with role `host`, connection status `offline`, and the inverse target language (`vi → en`, `en → vi`).

### Errors

- `400 VALIDATION_ERROR`: invalid/missing name, invalid language, or unknown body field.
- `429 RATE_LIMIT_EXCEEDED`: create limit exceeded.
- `500 INTERNAL_ERROR`: a unique room code could not be allocated or an unexpected error occurred.

## GET `/api/sessions/:roomCode`

Returns the current in-memory session state and its participants. It never returns access tokens.

### Request

```http
GET {{baseUrl}}/api/sessions/{{roomCode}}
```

Example:

```http
GET {{baseUrl}}/api/sessions/APT123
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
  "roomCode": "APT123",
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
- `429 RATE_LIMIT_EXCEEDED`: join limit exceeded.

### Current language-pair behavior

- Each participant receives the inverse target language automatically.
- The current implementation does not yet reject a guest whose source language matches the host's source language.
- Enforcing exactly one `vi` participant and one `en` participant requires a documented API error contract and a corresponding service/test update.

## POST `/api/sessions/:sessionId/end`

Ends an existing session and revokes all participant tokens belonging to it.

The operation is idempotent: calling it again for an already closed session returns the same successful state.

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

## Recommended Postman flow

1. Call `GET /health`.
2. Call `POST /api/sessions` and store `roomCode`, `sessionId`, and the host `accessToken`.
3. Call `GET /api/sessions/:roomCode` and verify `waiting` with one host.
4. Call `POST /api/sessions/:roomCode/join` and store the guest `accessToken`.
5. Call `GET /api/sessions/:roomCode` and verify `active` with two participants.
6. Attempt a third join and verify `409 SESSION_FULL`.
7. Call `POST /api/sessions/:sessionId/end` twice and verify both responses are `200 closed`.
8. Attempt to join the closed room and verify `409 SESSION_CLOSED`.

## Change history

| Phase | Change |
|---|---|
| Phase 1 | Added `GET /health`. |
| Phase 2 | Added create, state, join, and end-session REST APIs. |
