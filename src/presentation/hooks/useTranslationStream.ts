import { useEffect, useMemo } from 'react';
import { TranscriptStreamService } from '@application/services/TranscriptStreamService';
import { useMeetingStore } from '@application/store/useMeetingStore';
import { WebAudioStreamRepository } from '@infrastructure/audio/WebAudioStreamRepository';
import { SocketTranslationRepository } from '@infrastructure/websocket/SocketTranslationRepository';

// Hook wiring socket transcript events into the meeting store.
export function useTranslationStream() {
  const upsertSegment = useMeetingStore((state) => state.upsertSegment);
  const service = useMemo(
    () => new TranscriptStreamService(new WebAudioStreamRepository(), new SocketTranslationRepository()),
    []
  );

  useEffect(() => {
    const socket = new SocketTranslationRepository();
    const unsubscribers = [
      socket.onTranscriptPartial(upsertSegment),
      socket.onTranscriptFinal(upsertSegment),
      socket.onTranslationResult(upsertSegment)
    ];

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      socket.disconnect();
    };
  }, [upsertSegment]);

  return service;
}
