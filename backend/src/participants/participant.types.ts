import type { LanguageCode } from '../common/types/language-code.type';

export type ParticipantRole = 'host' | 'guest';
export type ConnectionStatus = 'online' | 'offline';

export interface Participant {
  connectionStatus: ConnectionStatus;
  displayName: string;
  joinedAt: number;
  lastSeenAt: number;
  participantId: string;
  role: ParticipantRole;
  sessionId: string;
  socketId?: string;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
}

export interface CreateParticipantInput {
  displayName: string;
  role: ParticipantRole;
  sessionId: string;
  sourceLanguage: LanguageCode;
}
