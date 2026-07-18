import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ParticipantTokenService } from '../auth/participant-token.service';
import { ApiHttpException } from '../common/errors/api-http.exception';
import { StructuredLogger } from '../observability/structured-logger.service';
import { ParticipantsService } from '../participants/participants.service';
import { SessionStore } from './session.store';
import { isLobbyRoomCode, LOBBY_ROOMS } from './lobby-room.catalog';
import type {
  CreateSessionInput,
  CreateSessionResponse,
  EndSessionResponse,
  JoinSessionResponse,
  LobbyRoomResponse,
  SessionParticipantInput,
  SessionParticipantView,
  SessionStateResponse,
  TranslationSession,
} from './session.types';

const MAX_PARTICIPANTS = 2;

@Injectable()
export class SessionsService {
  private conversationCleanupHandler: (sessionId: string) => void = () =>
    undefined;

  constructor(
    private readonly participantTokenService: ParticipantTokenService,
    private readonly participantsService: ParticipantsService,
    private readonly sessionStore: SessionStore,
    private readonly logger: StructuredLogger,
  ) {}

  createSession(input: CreateSessionInput): CreateSessionResponse {
    const operationStartedAt = Date.now();
    const now = Date.now();
    const session: TranslationSession = {
      createdAt: now,
      glossary: {},
      lastActivityAt: now,
      nextTurnSequence: 1,
      participantIds: [],
      recentTurnIds: [],
      roomCode: this.allocateLobbyRoom(input.roomCode),
      sessionId: `session_${randomUUID()}`,
      status: 'waiting',
    };
    const host = this.participantsService.createParticipant({
      displayName: input.displayName,
      role: 'host',
      sessionId: session.sessionId,
      sourceLanguage: input.sourceLanguage,
    });

    session.participantIds.push(host.participantId);
    this.sessionStore.save(session);
    const accessToken = this.participantTokenService.issueToken(
      session.sessionId,
      host.participantId,
    );

    this.logSessionEvent(
      'session.created',
      session.sessionId,
      host.participantId,
      operationStartedAt,
      'success',
    );

    return {
      accessToken,
      participantId: host.participantId,
      roomCode: session.roomCode,
      sessionId: session.sessionId,
      status: 'waiting',
    };
  }

  registerConversationCleanupHandler(
    handler: (sessionId: string) => void,
  ): void {
    this.conversationCleanupHandler = handler;
  }

  joinSession(
    roomCode: string,
    input: SessionParticipantInput,
  ): JoinSessionResponse {
    const operationStartedAt = Date.now();
    const session = this.getRequiredSessionByRoomCode(roomCode);

    if (session.status === 'closing' || session.status === 'closed') {
      throw new ApiHttpException(
        HttpStatus.CONFLICT,
        'SESSION_CLOSED',
        'The session is closed and cannot accept participants.',
      );
    }

    if (session.participantIds.length >= MAX_PARTICIPANTS) {
      throw new ApiHttpException(
        HttpStatus.CONFLICT,
        'SESSION_FULL',
        'The session already has the maximum number of participants.',
      );
    }

    const host = this.participantsService
      .getRequiredParticipants(session.participantIds)
      .find((participant) => participant.role === 'host');

    if (host === undefined) {
      throw new ApiHttpException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'INTERNAL_ERROR',
        'The session host could not be resolved.',
      );
    }

    if (host.sourceLanguage === input.sourceLanguage) {
      throw new ApiHttpException(
        HttpStatus.CONFLICT,
        'LANGUAGE_PAIR_CONFLICT',
        'The guest must use the opposite source language from the host.',
      );
    }

    const guest = this.participantsService.createParticipant({
      displayName: input.displayName,
      role: 'guest',
      sessionId: session.sessionId,
      sourceLanguage: input.sourceLanguage,
    });
    const now = Date.now();

    session.participantIds.push(guest.participantId);
    session.lastActivityAt = now;
    session.startedAt = now;
    session.status = 'active';
    this.sessionStore.save(session);

    const accessToken = this.participantTokenService.issueToken(
      session.sessionId,
      guest.participantId,
    );

    this.logSessionEvent(
      'session.joined',
      session.sessionId,
      guest.participantId,
      operationStartedAt,
      'success',
    );

    return {
      accessToken,
      participantId: guest.participantId,
      sessionId: session.sessionId,
      status: 'active',
    };
  }

  getLobbyRooms(): LobbyRoomResponse[] {
    return LOBBY_ROOMS.map((room) => {
      const session = this.sessionStore.findByRoomCode(room.roomCode);
      if (session === undefined || session.status === 'closed') {
        return {
          occupancy: 0,
          participants: [],
          roomCode: room.roomCode,
          roomName: room.roomName,
          status: 'empty' as const,
        };
      }
      const participants = this.participantsService
        .getRequiredParticipants(session.participantIds)
        .map((participant) => ({
          connectionStatus: participant.connectionStatus,
          participantId: participant.participantId,
          sourceLanguage: participant.sourceLanguage,
        }));
      return {
        occupancy: participants.length,
        participants,
        roomCode: room.roomCode,
        roomName: room.roomName,
        status: participants.length >= MAX_PARTICIPANTS ? 'full' : 'waiting',
      };
    });
  }

  getSession(roomCode: string): SessionStateResponse {
    return this.toSessionState(this.getRequiredSessionByRoomCode(roomCode));
  }

  getSessionById(sessionId: string): TranslationSession {
    const session = this.sessionStore.findById(sessionId);

    if (session === undefined) {
      throw new ApiHttpException(
        HttpStatus.NOT_FOUND,
        'SESSION_NOT_FOUND',
        'The session was not found.',
      );
    }

    return session;
  }

  getSessionStateById(sessionId: string): SessionStateResponse {
    return this.toSessionState(this.getSessionById(sessionId));
  }

  endSession(sessionId: string): EndSessionResponse {
    const operationStartedAt = Date.now();
    const session = this.sessionStore.findById(sessionId);

    if (session === undefined) {
      throw new ApiHttpException(
        HttpStatus.NOT_FOUND,
        'SESSION_NOT_FOUND',
        'The session was not found.',
      );
    }

    if (session.status === 'closed') {
      this.logSessionEvent(
        'session.end.duplicate',
        session.sessionId,
        null,
        operationStartedAt,
        'ignored',
      );
      return {
        sessionId: session.sessionId,
        status: 'closed',
      };
    }

    const now = Date.now();
    session.status = 'closing';
    session.glossary = {};
    session.recentTurnIds = [];
    session.closedAt = now;
    session.lastActivityAt = now;
    session.status = 'closed';
    this.sessionStore.save(session);
    this.conversationCleanupHandler(session.sessionId);
    this.participantTokenService.revokeSession(session.sessionId);

    this.logSessionEvent(
      'session.ended',
      session.sessionId,
      null,
      operationStartedAt,
      'success',
    );

    return {
      sessionId: session.sessionId,
      status: 'closed',
    };
  }

  private allocateLobbyRoom(requestedRoomCode?: string): string {
    if (requestedRoomCode !== undefined) {
      const normalizedRoomCode = requestedRoomCode.toUpperCase();
      if (
        !isLobbyRoomCode(normalizedRoomCode) ||
        !this.isLobbyRoomAvailable(normalizedRoomCode)
      ) {
        throw new ApiHttpException(
          HttpStatus.CONFLICT,
          'ROOM_UNAVAILABLE',
          'The selected lobby room is no longer empty.',
        );
      }
      return normalizedRoomCode;
    }

    const availableRoom = LOBBY_ROOMS.find((room) =>
      this.isLobbyRoomAvailable(room.roomCode),
    );
    if (availableRoom === undefined) {
      throw new ApiHttpException(
        HttpStatus.CONFLICT,
        'LOBBY_FULL',
        'All five lobby rooms are currently occupied.',
      );
    }
    return availableRoom.roomCode;
  }

  private isLobbyRoomAvailable(roomCode: string): boolean {
    const session = this.sessionStore.findByRoomCode(roomCode);
    return session === undefined || session.status === 'closed';
  }

  private getRequiredSessionByRoomCode(roomCode: string): TranslationSession {
    const session = this.sessionStore.findByRoomCode(roomCode.toUpperCase());

    if (session === undefined) {
      throw new ApiHttpException(
        HttpStatus.NOT_FOUND,
        'SESSION_NOT_FOUND',
        'The session was not found.',
      );
    }

    return session;
  }

  private toSessionState(session: TranslationSession): SessionStateResponse {
    const participants = this.participantsService
      .getRequiredParticipants(session.participantIds)
      .map<SessionParticipantView>((participant) => ({
        connectionStatus: participant.connectionStatus,
        displayName: participant.displayName,
        participantId: participant.participantId,
        role: participant.role,
        sourceLanguage: participant.sourceLanguage,
        targetLanguage: participant.targetLanguage,
      }));

    return {
      ...(session.closedAt === undefined ? {} : { closedAt: session.closedAt }),
      createdAt: session.createdAt,
      participants,
      roomCode: session.roomCode,
      sessionId: session.sessionId,
      ...(session.startedAt === undefined
        ? {}
        : { startedAt: session.startedAt }),
      status: session.status,
    };
  }

  private logSessionEvent(
    event: string,
    sessionId: string,
    participantId: string | null,
    operationStartedAt: number,
    status: string,
  ): void {
    this.logger.log(
      {
        durationMs: Date.now() - operationStartedAt,
        errorCode: null,
        event,
        participantId,
        sessionId,
        status,
        turnId: null,
      },
      SessionsService.name,
    );
  }
}
