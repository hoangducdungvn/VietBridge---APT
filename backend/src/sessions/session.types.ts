import type { LanguageCode } from '../common/types/language-code.type';
import type {
  ConnectionStatus,
  ParticipantRole,
} from '../participants/participant.types';

export type SessionStatus =
  | 'waiting'
  | 'active'
  | 'closing'
  | 'closed'
  | 'error';

export interface TranslationSession {
  activeTurnId?: string;
  closedAt?: number;
  createdAt: number;
  glossary: Record<string, string>;
  lastActivityAt: number;
  nextTurnSequence: number;
  participantIds: string[];
  recentTurnIds: string[];
  roomCode: string;
  sessionId: string;
  startedAt?: number;
  status: SessionStatus;
}

export interface SessionParticipantInput {
  displayName: string;
  sourceLanguage: LanguageCode;
}

export interface CreateSessionInput extends SessionParticipantInput {
  roomCode?: string;
}

export interface LobbyRoomParticipant {
  connectionStatus: ConnectionStatus;
  participantId: string;
  sourceLanguage: LanguageCode;
}

export interface LobbyRoomResponse {
  occupancy: number;
  participants: LobbyRoomParticipant[];
  roomCode: string;
  roomName: string;
  status: 'empty' | 'waiting' | 'full';
}

export interface CreateSessionResponse {
  accessToken: string;
  participantId: string;
  roomCode: string;
  sessionId: string;
  status: 'waiting';
}

export interface JoinSessionResponse {
  accessToken: string;
  participantId: string;
  sessionId: string;
  status: 'active';
}

export interface SessionParticipantView {
  connectionStatus: ConnectionStatus;
  displayName: string;
  participantId: string;
  role: ParticipantRole;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
}

export interface SessionStateResponse {
  closedAt?: number;
  createdAt: number;
  participants: SessionParticipantView[];
  roomCode: string;
  sessionId: string;
  startedAt?: number;
  status: SessionStatus;
}

export interface EndSessionResponse {
  sessionId: string;
  status: 'closed';
}
