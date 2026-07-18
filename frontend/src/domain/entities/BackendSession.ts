export type LanguageCode = 'vi' | 'en';
export type ParticipantRole = 'host' | 'guest';
export type ConnectionStatus = 'online' | 'offline';
export type SessionStatus = 'waiting' | 'active' | 'closing' | 'closed' | 'error';

export interface SessionParticipant {
  connectionStatus: ConnectionStatus;
  displayName: string;
  participantId: string;
  role: ParticipantRole;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
}

export interface SessionState {
  closedAt?: number;
  createdAt: number;
  participants: SessionParticipant[];
  roomCode: string;
  sessionId: string;
  startedAt?: number;
  status: SessionStatus;
}

export interface ParticipantSession {
  accessToken: string;
  participantId: string;
  role: ParticipantRole;
  roomCode: string;
  sessionId: string;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
}

export interface SessionCredentialsInput {
  displayName: string;
  sourceLanguage: LanguageCode;
}
