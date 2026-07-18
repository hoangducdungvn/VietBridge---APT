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
4. `SessionSocketClient` authenticates with `auth.accessToken` and listens for `session.state` so both browsers update presence.
5. The meeting microphone uses VoicePipeline and the existing authenticated Socket.IO connection for `turn.start`, PCM `audio.chunk`, and `turn.end`.
6. Backend STT partial/final results are rendered in both browsers. Translation is not implemented yet.

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

### Test from another machine on the same Wi-Fi

Vite listens on the LAN by default. Find the host machine IPv4 address with `ipconfig`, then set only the local ignored `frontend/.env` public URL:

```env
VITE_PUBLIC_APP_URL=http://192.168.1.8:5173
```

Replace `192.168.1.8` with the current host IPv4 address and restart Vite after changing `.env`. Open that LAN URL on the host before creating a room. The copied invite includes the room code and required opposite language. Backend URLs configured as localhost are automatically rewritten to the page's LAN hostname in the recipient browser.

Browser microphone APIs require a secure context. `http://localhost:5173` is accepted by browsers, but a second machine opening `http://<LAN-IP>:5173` may have microphone access blocked. For a two-machine voice test, serve the frontend through trusted HTTPS or explicitly allow that development origin in the test browser; the UI now reports this condition instead of showing a false active microphone.

## Useful Scripts

```bash
npm run build
npm run test
npm run lint
npm run format
```
