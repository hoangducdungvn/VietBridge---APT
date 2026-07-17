// Socket event names shared by infrastructure adapters and backend contracts.
export const SOCKET_EVENTS = {
  audioChunk: 'audio-chunk',
  transcriptPartial: 'transcript-partial',
  transcriptFinal: 'transcript-final',
  translationResult: 'translation-result'
} as const;
