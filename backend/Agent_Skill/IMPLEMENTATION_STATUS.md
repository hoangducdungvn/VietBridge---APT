# Backend Implementation Status

## Completed phase

MVP bilingual translation vertical slice — Voice, STT, Translation, and speaker-relative display

## What was implemented

- Enforced exactly one `vi` and one `en` participant; equal host/guest languages return `409 LANGUAGE_PAIR_CONFLICT`.
- Added authenticated Socket.IO handshake using the opaque participant token without logging it.
- Added socket-to-session/participant binding, room join, reconnect replacement, online/offline presence, and `session.state`, `participant.joined`, and `participant.left` events.
- Added `turn.start`, `turn.accepted`, `turn.rejected`, `turn.end`, and `turn.cancel` orchestration with participant-scoped audio segments and no session-wide speaker lock.
- Added PCM16/16 kHz/mono validation, ordered sequence validation, binary buffering by `turnId`, 25-second and chunk-size limits, and cleanup on end/error/cancel/disconnect.
- Added a configurable mock/remote STT provider boundary and FastAPI multipart adapter.
- Added best-effort accumulated-audio partial STT at 2-second intervals and authoritative final STT, with only one partial request in flight.
- Serialized each turn's partial/final boundary so `turn.end` waits for an in-flight partial before sending authoritative final STT, preventing overlapping requests for the same audio segment.
- Added stale participant-turn recovery: Voice cancels an unended local turn before starting another, and Backend atomically supersedes any orphaned `started`/`streaming` segment instead of trapping the participant in repeated `PARTICIPANT_TURN_ACTIVE` errors.
- Fixed deployed Silero VAD initialization by letting Vite fingerprint and publish the matching ONNX Runtime `.mjs`/`.wasm` assets, exposed `AI VAD`/fallback state in the meeting UI, retained 1.5 seconds of natural pause, and flushed tail PCM before `turn.end`.
- Moved STT EOU analysis before trailing-silence trimming and preserved typed EOU metadata through the Backend provider, turn result, and room-wide STT events for production diagnostics.
- Added an STT upstream request gate with final-request priority and configurable `STT_MAX_CONCURRENT_REQUESTS` (default `1`), disabled fallback amplification for best-effort partials, and retained one fallback attempt for finals.
- Made FPT/Groq HTTP sessions thread-local and taught the standalone Voice mock gateway to surface structured STT errors returned inside HTTP 200 responses.
- Added provider timeout/unavailable/error mapping, provider latency metadata, cleanup on provider failure, and room-wide `stt.partial`/`stt.final` broadcasts.
- Wired final STT into the provider-agnostic Translation boundary and configured `TRANSLATION_PROVIDER=remote` to call the FPT chat-completions LLM with server-only credentials.
- Added room-wide `translation.started` and idempotent bilingual `message.final` events containing speaker identity, source/target languages, source/translated text, sequence, and latency metadata.
- Kept final source STT available when translation fails and mapped failures to recoverable `TRANSLATION_TIMEOUT` or `TRANSLATION_UNAVAILABLE` errors without exposing provider responses or keys.
- Ensured duplicate `turn.end` never triggers a second translation request or bilingual message and suppresses late translation output after a session is closed.
- Added a Socket.IO voice transport that buffers pre-roll until `turn.accepted`, sends ordered PCM from the existing AudioWorklet/VAD pipeline, and does not reset a local segment when the other participant's final result arrives.
- Replaced the primary meeting caption mock with microphone control and real source-language transcript rendering in both browsers.
- Reworked the meeting display around the local participant: the right green pane contains only that participant's original STT, while the left pane contains only the other participant's text translated into the local language.
- Added strict Frontend parsing for `message.final`, per-turn deduplication, sequence ordering, and cleanup of both source and translated conversation state when leaving or ending a meeting.
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

- Session and Participant own identity/language, Realtime owns transport/presence, Turn owns participant-scoped segmentation/buffering, Pipeline owns STT-to-Translation orchestration, and provider adapters own external calls. The Frontend renders messages relative to the authenticated participant rather than assuming a fixed language side.

## Files and modules created

- `src/realtime/realtime.gateway.ts` and the wired `RealtimeModule`.
- `src/pipeline/pipeline.service.ts` and the wired `PipelineModule`.
- `stt/stt_service/request_gate.py` plus concurrency-gate tests and `stt/.env.example` deployment configuration.
- `voice/src/vad/sileroVad.ts` ONNX Runtime asset URL wiring and `src/common/types/stt-eou.type.ts` EOU contract mapping.
- `src/providers/translation/translation.module.ts`, mock/remote Translation providers, and Translation orchestration tests.
- `src/providers/stt/stt-transcription-provider.interface.ts`, mock provider, remote FastAPI provider, and the wired `SttModule`.
- `src/turns/turn.types.ts`, `turn.store.ts`, `turns.service.ts`, `turns.service.spec.ts`, and the wired `TurnsModule`.
- Extended participant/session services for presence, identity lookup, realtime state, and language-pair enforcement.
- `src/sessions/lobby-room.catalog.ts` and `src/sessions/lobby-rooms.controller.ts` for the stable five-slot lobby contract.
- `test/realtime.e2e-spec.ts` plus updated REST e2e coverage.
- `frontend/src/infrastructure/websocket/SessionSocketClient.ts` and `frontend/src/presentation/views/MeetingRoomScreen.tsx` for bilingual event parsing and left/right speaker-relative rendering.
- Updated `Agent_Skill/API_SPECIFICATION.md` with the REST language rule and runnable Socket.IO contracts.

## Validation results

- Lint: PASS — `npm run lint` completed with 0 errors.
- Tests: PASS — `npm run test -- --runInBand` passed 12 suites and 57 tests, including EOU provider mapping and the partial/final race regression test; Python STT tests passed 7 tests including request serialization and final EOU metrics.
- Build: PASS — `npm run build` completed with 0 TypeScript errors.
- Frontend: PASS — lint, 21 tests, and production build completed, including the right-side local source transcript, left-side remote translation, Socket.IO readiness, scrolling, and end-meeting cleanup.
- Voice: PASS — TypeScript typecheck and production build completed with participant-isolated final/error handling.
- STT: PASS — Python unit tests and `compileall` completed; upstream calls are serialized with final priority by default.
- Live Socket.IO smoke: PASS — host and guest connected to one backend session, both were online, and both transports upgraded to WebSocket.
- LAN HTTPS gateway: PASS — trusted certificate hostname validation, `/health`, REST create/end, and Socket.IO WebSocket upgrade passed through the configured LAN HTTPS origin; the current Wi-Fi URL is `https://192.168.10.19:5173`.
- Post-fix deployed STT smoke: PENDING — redeploy Backend, STT, and Frontend, then repeat the two-device Vietnamese/English acceptance test.

## Not implemented yet

- Recent-turn conversation context, dynamic glossary management, persistent/replayable message history, and a dedicated observability latency service.
- Adaptive, language-specific VAD thresholds are not implemented; meeting clients currently use a shared 1.5-second end-silence threshold and a 25-second maximum utterance.
- Persistent storage, Redis, Kafka, WebRTC, video, TTS, summaries, and microservices.

## Recommended next phase

- Run the two-device bilingual acceptance test with Vietnamese/FPT STT, English/Groq STT, and FPT LLM translation; then implement bounded recent-turn Context and glossary support from `Agent_Skill/plan/08_IMPLEMENTATION_PLAN.md`.
