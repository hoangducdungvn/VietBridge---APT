import type { TranscriptSegment } from './TranscriptSegment';
import type { Speaker } from './Speaker';
import type { TranslationPair } from './TranslationPair';

// Aggregate root for meeting state independent of UI or transport details.
export interface MeetingSession {
  id: string;
  title: string;
  activePair: TranslationPair;
  speakers: Speaker[];
  transcript: TranscriptSegment[];
  startedAt: number;
  endedAt?: number;
}
