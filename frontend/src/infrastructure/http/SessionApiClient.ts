import type {
  LanguageCode,
  ParticipantRole,
  ParticipantSession,
  SessionCredentialsInput,
  SessionParticipant,
  SessionState,
  SessionStatus
} from '@domain/entities/BackendSession';
import { env } from '@infrastructure/config/env';
import type { Participant, Room, RoomParticipants } from '@domain/entities/Room';

export class SessionApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'SessionApiError';
  }
}

export class SessionApiClient {
  async createSession(
    input: SessionCredentialsInput,
    roomCode?: string
  ): Promise<ParticipantSession> {
    const payload = requireRecord(
      await this.request('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({
          ...input,
          ...(roomCode === undefined ? {} : { roomCode: roomCode.trim().toUpperCase() })
        })
      })
    );

    return {
      accessToken: getString(payload, 'accessToken'),
      participantId: getString(payload, 'participantId'),
      role: 'host',
      roomCode: getString(payload, 'roomCode'),
      sessionId: getString(payload, 'sessionId'),
      sourceLanguage: input.sourceLanguage,
      targetLanguage: oppositeLanguage(input.sourceLanguage)
    };
  }

  async joinSession(roomCode: string, input: SessionCredentialsInput): Promise<ParticipantSession> {
    const normalizedRoomCode = roomCode.trim().toUpperCase();
    const payload = requireRecord(
      await this.request(`/api/sessions/${encodeURIComponent(normalizedRoomCode)}/join`, {
        method: 'POST',
        body: JSON.stringify(input)
      })
    );

    return {
      accessToken: getString(payload, 'accessToken'),
      participantId: getString(payload, 'participantId'),
      role: 'guest',
      roomCode: normalizedRoomCode,
      sessionId: getString(payload, 'sessionId'),
      sourceLanguage: input.sourceLanguage,
      targetLanguage: oppositeLanguage(input.sourceLanguage)
    };
  }

  async getSession(roomCode: string): Promise<SessionState> {
    const payload = requireRecord(
      await this.request(`/api/sessions/${encodeURIComponent(roomCode.trim().toUpperCase())}`)
    );
    return parseSessionState(payload);
  }

  async getLobbyRooms(): Promise<Room[]> {
    const payload = await this.request('/api/rooms');
    if (!Array.isArray(payload)) {
      throw invalidResponse('Invalid lobby room list.');
    }
    return payload.map(parseLobbyRoom);
  }

  async endSession(sessionId: string): Promise<void> {
    await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/end`, {
      method: 'POST'
    });
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response;

    try {
      response = await fetch(`${env.backendApiUrl}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...init.headers
        }
      });
    } catch {
      throw new SessionApiError(
        0,
        'BACKEND_UNAVAILABLE',
        'Cannot reach the VietBridge backend. Check that port 3000 is running.'
      );
    }

    const payload = await readJson(response);

    if (!response.ok) {
      const errorPayload = isRecord(payload) ? payload : {};
      throw new SessionApiError(
        response.status,
        readOptionalString(errorPayload, 'code') ?? 'REQUEST_FAILED',
        readOptionalString(errorPayload, 'message') ?? 'The backend rejected the request.'
      );
    }

    return payload;
  }
}

function parseLobbyRoom(value: unknown): Room {
  const room = requireRecord(value);
  const participantsValue = room.participants;
  if (!Array.isArray(participantsValue) || participantsValue.length > 2) {
    throw invalidResponse('Invalid lobby participant list.');
  }

  const participants = participantsValue.map(parseLobbyParticipant);
  const seats: RoomParticipants = [participants[0] ?? null, participants[1] ?? null];
  return {
    participants: seats,
    roomId: getString(room, 'roomCode'),
    roomName: getString(room, 'roomName')
  };
}

function parseLobbyParticipant(value: unknown): Participant {
  const participant = requireRecord(value);
  const connectionStatus = getString(participant, 'connectionStatus');
  const language = getString(participant, 'sourceLanguage');
  if (!isConnectionStatus(connectionStatus) || !isLanguage(language)) {
    throw invalidResponse('Invalid lobby participant.');
  }
  return {
    connectionStatus,
    id: getString(participant, 'participantId'),
    language
  };
}

export function parseSessionState(payload: Record<string, unknown>): SessionState {
  const participantsValue = payload.participants;
  if (!Array.isArray(participantsValue)) {
    throw new SessionApiError(0, 'INVALID_BACKEND_RESPONSE', 'Invalid participant state.');
  }

  const status = getString(payload, 'status');
  if (!isSessionStatus(status)) {
    throw new SessionApiError(0, 'INVALID_BACKEND_RESPONSE', 'Invalid session status.');
  }

  return {
    ...(typeof payload.closedAt === 'number' ? { closedAt: payload.closedAt } : {}),
    createdAt: getNumber(payload, 'createdAt'),
    participants: participantsValue.map(parseParticipant),
    roomCode: getString(payload, 'roomCode'),
    sessionId: getString(payload, 'sessionId'),
    ...(typeof payload.startedAt === 'number' ? { startedAt: payload.startedAt } : {}),
    status
  };
}

function parseParticipant(value: unknown): SessionParticipant {
  if (!isRecord(value)) {
    throw new SessionApiError(0, 'INVALID_BACKEND_RESPONSE', 'Invalid participant payload.');
  }

  const role = getString(value, 'role');
  const connectionStatus = getString(value, 'connectionStatus');
  const sourceLanguage = getString(value, 'sourceLanguage');
  const targetLanguage = getString(value, 'targetLanguage');

  if (!isRole(role) || !isConnectionStatus(connectionStatus)) {
    throw new SessionApiError(0, 'INVALID_BACKEND_RESPONSE', 'Invalid participant identity.');
  }
  if (!isLanguage(sourceLanguage) || !isLanguage(targetLanguage)) {
    throw new SessionApiError(0, 'INVALID_BACKEND_RESPONSE', 'Invalid participant language.');
  }

  return {
    connectionStatus,
    displayName: getString(value, 'displayName'),
    participantId: getString(value, 'participantId'),
    role,
    sourceLanguage,
    targetLanguage
  };
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => ({}));
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw invalidResponse('Invalid backend response.');
  return value;
}

function invalidResponse(message: string): SessionApiError {
  return new SessionApiError(0, 'INVALID_BACKEND_RESPONSE', message);
}

function getString(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== 'string') {
    throw new SessionApiError(0, 'INVALID_BACKEND_RESPONSE', `Missing response field: ${key}.`);
  }
  return field;
}

function readOptionalString(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === 'string' ? field : undefined;
}

function getNumber(value: Record<string, unknown>, key: string): number {
  const field = value[key];
  if (typeof field !== 'number') {
    throw new SessionApiError(0, 'INVALID_BACKEND_RESPONSE', `Missing response field: ${key}.`);
  }
  return field;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLanguage(value: string): value is LanguageCode {
  return value === 'vi' || value === 'en';
}

function isRole(value: string): value is ParticipantRole {
  return value === 'host' || value === 'guest';
}

function isConnectionStatus(value: string): value is SessionParticipant['connectionStatus'] {
  return value === 'online' || value === 'offline';
}

function isSessionStatus(value: string): value is SessionStatus {
  return ['waiting', 'active', 'closing', 'closed', 'error'].includes(value);
}

function oppositeLanguage(language: LanguageCode): LanguageCode {
  return language === 'vi' ? 'en' : 'vi';
}
