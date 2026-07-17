import { create } from 'zustand';

interface SettingsState {
  ttsEnabled: boolean;
  noiseSuppressionEnabled: boolean;
  setTtsEnabled: (enabled: boolean) => void;
  setNoiseSuppressionEnabled: (enabled: boolean) => void;
}

// Zustand store for user preferences that affect capture, playback, and display.
export const useSettingsStore = create<SettingsState>((set) => ({
  ttsEnabled: false,
  noiseSuppressionEnabled: true,
  setTtsEnabled: (ttsEnabled) => set({ ttsEnabled }),
  setNoiseSuppressionEnabled: (noiseSuppressionEnabled) => set({ noiseSuppressionEnabled })
}));
