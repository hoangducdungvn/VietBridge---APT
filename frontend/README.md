# VietBridge Meeting Translator

VietBridge is a browser-based PWA scaffold for real-time Vietnamese-English business meeting translation. It is organized for a 2-day hackathon while keeping the codebase maintainable, testable, and ready for future language pairs.

## Stack

- React 18, TypeScript, Vite
- TailwindCSS for a readable meeting-room UI
- Zustand for application state
- Socket.IO client for streaming ASR and translation events
- Web Audio API and MediaRecorder API wrappers for capture
- VAD adapter boundary for turn-taking detection
- Vitest and React Testing Library for tests

## Architecture Layers

`src/domain` contains pure business concepts and use-cases. It does not import React, browser APIs, Socket.IO, or Zustand.

`src/application` coordinates domain use-cases, maps infrastructure DTOs into domain entities, and exposes state stores consumed by the UI.

`src/infrastructure` implements browser and network adapters such as WebSocket streaming, audio capture, VAD, speech synthesis, and environment config.

`src/presentation` contains React components, views, and hooks. Views compose application services and store state into screen-level experiences.

`src/shared` contains constants, shared types, and small utilities used across layers.

## Current Session Data Flow

1. The General lobby always renders five backend-owned slots (`APT001`–`APT005`) and refreshes their real occupancy through `GET /api/rooms`; no fake participant data is used.
2. Empty cards open the Create dialog, waiting cards open the Join dialog, and full cards are disabled. The header actions provide the same flows by room selection or code.
3. `useSessionStore` persists `sessionId`, room code, participant identity, token, role, and language direction in `sessionStorage`.
4. Reloading calls `GET /api/sessions/:roomCode` to restore current in-memory backend state.
5. Waiting-room invite copy uses the Clipboard API when available and a click-driven fallback for HTTP LAN origins.
6. Meeting audio waits for the authenticated Socket.IO connection, then requests microphone access automatically. The microphone button remains the retry/stop control.
7. The current participant's source-language transcript pane is highlighted in green and labeled `You`; the other participant remains neutral.
8. Transcript history exists only for the current in-memory meeting and is cleared immediately on leave, remote close, or End Meeting.
9. Each language pane owns a fixed transcript viewport with a visible scrollbar and automatically follows its latest finalized STT result.
10. `SessionSocketClient` authenticates with `auth.accessToken` and listens for `session.state` so both browsers update presence.
11. Each device keeps its own microphone capture active. VoicePipeline uses VAD only to segment local speech; backend accepts both participants concurrently without `TURN_BUSY`.
12. Backend STT partial/final results are rendered in both browsers. Translation is not implemented yet.

## Adding A New Language Pair

1. Add the language metadata to `src/shared/constants/languages.ts`.
2. Update `VITE_SUPPORTED_LANGUAGES` in the deployed environment.
3. Confirm the backend supports ASR, MT, and optional TTS for the new pair.
4. Extend translation direction validation in the domain layer if the pair needs custom business rules.
5. Add focused tests for mapping, store behavior, and UI labels.

The frontend should not need structural changes for a new pair because language support is treated as configuration plus domain validation.

## Getting Started

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local` and keep both backend URLs on the NestJS server for local development:

```env
VITE_BACKEND_API_URL=http://localhost:3000
VITE_BACKEND_WS_URL=http://localhost:3000
VITE_PUBLIC_APP_URL=http://localhost:5173
VITE_SUPPORTED_LANGUAGES=vi,en
```

Start `backend` on port `3000` before testing create/join in two browser windows.
For real microphone transcription, also start `stt-service` on port `8001` and set the backend to `STT_PROVIDER=remote`.

### Test from another machine on the same Wi-Fi

Use the trusted-HTTPS Vite gateway and same-origin backend proxy described in [`docs/deploy.md`](../docs/deploy.md). Plain `http://<LAN-IP>` is not a valid browser microphone context and must not be used for the two-device voice acceptance test.

## Useful Scripts

```bash
npm run build
npm run test
npm run lint
npm run format
```
