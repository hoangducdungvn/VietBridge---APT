# VietBridge

VietBridge is organized as a small monorepo with independent frontend and backend applications.

## Workspace

- `frontend/`: React 18, TypeScript, Vite, TailwindCSS, Zustand, and Socket.IO client
- `backend/`: NestJS API and real-time meeting services

## Frontend

```bash
cd frontend
npm install
npm run dev
```

## Backend

```bash
cd backend
npm install
npm run start:dev
```

Each application owns its package files, environment example, tests, and build configuration.
