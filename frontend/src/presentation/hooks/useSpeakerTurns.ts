// Hook placeholder for exposing VAD-derived speaker turn state to meeting UI components.
export function useSpeakerTurns() {
  return {
    activeSpeakerLabel: 'Meeting audio',
    isSpeakerActive: false
  };
}
