import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { ParticipantSession, SessionState } from '@domain/entities/BackendSession';

interface SessionStoreState {
  activeSession: ParticipantSession | null;
  serverState: SessionState | null;
  clearSession: () => void;
  setActiveSession: (session: ParticipantSession) => void;
  setServerState: (state: SessionState) => void;
}

export const useSessionStore = create<SessionStoreState>()(
  persist(
    (set) => ({
      activeSession: null,
      serverState: null,
      clearSession: () => set({ activeSession: null, serverState: null }),
      setActiveSession: (activeSession) => set({ activeSession }),
      setServerState: (serverState) => set({ serverState })
    }),
    {
      name: 'vietbridge-active-session',
      storage: createJSONStorage(() => sessionStorage)
    }
  )
);
