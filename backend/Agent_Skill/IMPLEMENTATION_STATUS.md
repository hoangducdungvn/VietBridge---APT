# Backend Implementation Status

## Completed phase

MVP STT vertical slice — Five-room lobby through source-transcript broadcast

## What was implemented

- Enforced exactly one `vi` and one `en` participant; equal host/guest languages return `409 LANGUAGE_PAIR_CONFLICT`.
- Added authenticated Socket.IO handshake using the opaque participant token without logging it.
- Added socket-to-session/participant binding, room join, reconnect replacement, online/offline presence, and `session.state`, `participant.joined`, and `participant.left` events.
- Added `turn.start`, `turn.accepted`, `turn.rejected`, `turn.end`, and `turn.cancel` orchestration with participant-scoped audio segments and no session-wide speaker lock.
- Added PCM16/16 kHz/mono validation, ordered sequence validation, binary buffering by `turnId`, 25-second and chunk-size limits, and cleanup on end/error/cancel/disconnect.
- Added a configurable mock/remote STT provider boundary and FastAPI multipart adapter.
- Added best-effort accumulated-audio partial STT at 2-second intervals and authoritative final STT, with only one partial request in flight.
- Added provider timeout/unavailable/error mapping, provider latency metadata, cleanup on provider failure, and room-wide `stt.partial`/`stt.final` broadcasts.
- Added a Socket.IO voice transport that buffers pre-roll until `turn.accepted`, sends ordered PCM from the existing AudioWorklet/VAD pipeline, and does not reset a local segment when the other participant's final result arrives.
- Replaced the primary meeting caption mock with microphone control and real source-language transcript rendering in both browsers.
- Added LAN-safe frontend serving, REST/Socket.IO CORS, share links containing the required guest language, and runtime backend-host resolution for two-machine testing.
- Added a backend-owned five-room lobby (`APT001`–`APT005`) whose cards always exist and report real empty/waiting/full occupancy through `GET /api/rooms`.
- Added selected-slot session creation, conflict handling for occupied slots, and automatic slot reuse after a session ends.
- Reconnected the existing frontend room cards to backend state; empty cards open a Create modal, waiting cards open a Join modal, and full cards are disabled.
- Added Zoom-style Create/Join dialogs with display-name input, room selection/code entry, and automatic opposite-language pairing for guests.
- Made invite copying reliable on localhost/HTTPS and HTTP LAN origins by falling back to a user-initiated document copy, with a visible manual-copy error when both methods fail.
- Made Socket.IO connect only after handlers are registered, use polling-first transport with WebSocket upgrade, retry transient disconnects, and surface backend handshake errors in the meeting UI.
- Made the microphone wait for an authenticated room socket and start automatically on meeting entry/reconnect; permission, insecure-origin, and browser autoplay failures remain actionable through the microphone retry button.
- Marked the current participant's source-language STT pane with a green surface, border, avatar, and explicit `You`/`Your source language` labels.
- Made end-session purge all backend turn/transcript/audio/partial state and clear frontend transcript state immediately, preventing history from leaking into a later room.
- Added independent, keyboard-focusable transcript scroll areas for both language panes with visible slim scrollbars and automatic smooth follow-up to the latest finalized STT result.
- Removed `TURN_BUSY` and the cross-participant microphone handoff. Both devices keep their own microphone capture active and may stream/STT concurrently.
- Added optional trusted-HTTPS Vite serving and same-origin REST/Socket.IO proxy configuration for two-device LAN microphone tests.
- Configured the host-only Backend/STT topology (`127.0.0.1:3000` and `127.0.0.1:8001`) behind the LAN-facing HTTPS Vite gateway on port `5173`.
- Added unit and Socket.IO e2e coverage for language conflict, invalid token, presence, simultaneous participant streams, invalid audio ownership, duplicate end, and buffer cleanup.

## Why this foundation exists

- Session and Participant own identity/language, Realtime owns transport/presence, Turn owns participant-scoped segmentation/buffering, Pipeline owns STT orchestration, and provider adapters own external calls. This keeps translation and context additions out of controllers and gateways.

## Files and modules created

- `src/realtime/realtime.gateway.ts` and the wired `RealtimeModule`.
- `src/pipeline/pipeline.service.ts` and the wired `PipelineModule`.
- `src/providers/stt/stt-transcription-provider.interface.ts`, mock provider, remote FastAPI provider, and the wired `SttModule`.
- `src/turns/turn.types.ts`, `turn.store.ts`, `turns.service.ts`, `turns.service.spec.ts`, and the wired `TurnsModule`.
- Extended participant/session services for presence, identity lookup, realtime state, and language-pair enforcement.
- `src/sessions/lobby-room.catalog.ts` and `src/sessions/lobby-rooms.controller.ts` for the stable five-slot lobby contract.
- `test/realtime.e2e-spec.ts` plus updated REST e2e coverage.
- Updated `Agent_Skill/API_SPECIFICATION.md` with the REST language rule and runnable Socket.IO contracts.

## Validation results

- Lint: PASS — `npm run lint` completed with 0 errors.
- Tests: PASS — `npm run test -- --runInBand` passed 5 suites and 29 tests, including concurrent host/guest audio and room-wide final broadcasts.
- Build: PASS — `npm run build` completed with 0 TypeScript errors.
- Frontend: PASS — lint, 20 tests, and production build completed for lobby, invite copy, Socket.IO readiness, automatic microphone, local-pane identification, transcript scrolling, and end-meeting cleanup.
- Voice: PASS — TypeScript typecheck and production build completed with participant-isolated final/error handling.
- Live Socket.IO smoke: PASS — host and guest connected to one backend session, both were online, and both transports upgraded to WebSocket.
- LAN HTTPS gateway: PASS — trusted certificate hostname validation, `/health`, REST create/end, and Socket.IO WebSocket upgrade passed through the configured LAN HTTPS origin; the current Wi-Fi URL is `https://192.168.10.19:5173`.
- Integrated STT smoke: PASS — English WAV routed to Groq and the same non-empty final transcript was broadcast to both Socket.IO clients.

## Not implemented yet

- Mock/real Translation, bilingual `message.final`, conversation context, glossary, and latency metrics.
- VAD tuning: each device currently closes its own utterance after 600 ms of silence, so hesitant speech can still be split into multiple transcript segments; this no longer blocks the other participant.
- Persistent storage, Redis, Kafka, WebRTC, video, TTS, summaries, and microservices.

## Recommended next phase

- Run the two-browser MVP STT acceptance test with real Vietnamese/FPT and English/Groq speech, then implement the next Translation Pipeline phase from `Agent_Skill/plan/08_IMPLEMENTATION_PLAN.md`.
