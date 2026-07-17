import { create } from 'zustand';
import type { TranscriptSegment } from '@domain/entities/TranscriptSegment';
import type { StreamStatus, TranslationDirection } from '@shared/types';
import { DEFAULT_TRANSLATION_DIRECTION } from '@shared/constants/languages';

interface MeetingState {
  direction: TranslationDirection;
  isListening: boolean;
  status: StreamStatus;
  segments: TranscriptSegment[];
  setDirection: (direction: TranslationDirection) => void;
  setListening: (isListening: boolean) => void;
  setStatus: (status: StreamStatus) => void;
  upsertSegment: (segment: TranscriptSegment) => void;
}

// Zustand store exposing meeting transcript and streaming state to React views.
export const useMeetingStore = create<MeetingState>((set) => ({
  direction: DEFAULT_TRANSLATION_DIRECTION,
  isListening: false,
  status: 'idle',
  segments: [],
  setDirection: (direction) => set({ direction }),
  setListening: (isListening) => set({ isListening }),
  setStatus: (status) => set({ status }),
  upsertSegment: (segment) =>
    set((state) => {
      const index = state.segments.findIndex((item) => item.id === segment.id);

      if (index === -1) {
        return { segments: [...state.segments, segment] };
      }

      const nextSegments = [...state.segments];
      nextSegments[index] = segment;
      return { segments: nextSegments };
    })
}));
