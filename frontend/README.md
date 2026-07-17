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

## Data Flow

1. `MeetingRoomView` renders meeting controls and transcript state from `useMeetingStore`.
2. `useAudioCapture` starts the infrastructure audio repository.
3. Audio chunks are sent through the `IAudioStreamRepository` port into application services.
4. `TranscriptStreamService` streams audio to `ITranslationSocketRepository`.
5. `SocketTranslationRepository` emits `audio-chunk` and listens for `transcript-partial`, `transcript-final`, and `translation-result`.
6. Incoming DTOs are mapped into domain-friendly transcript segments.
7. Zustand stores publish updates to the React UI.

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

Copy `.env.example` to `.env.local` and point `VITE_BACKEND_WS_URL` at the streaming backend when it is available.

## Useful Scripts

```bash
npm run build
npm run test
npm run lint
npm run format
```
