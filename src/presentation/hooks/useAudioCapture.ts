import { useMemo } from 'react';
import { MeetingSessionService } from '@application/services/MeetingSessionService';
import { WebAudioStreamRepository } from '@infrastructure/audio/WebAudioStreamRepository';

// Hook that bridges React views to the application service controlling audio capture.
export function useAudioCapture() {
  return useMemo(() => new MeetingSessionService(new WebAudioStreamRepository()), []);
}
