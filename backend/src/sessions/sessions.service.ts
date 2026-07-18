import { randomInt, randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ParticipantTokenService } from '../auth/participant-token.service';
import { ApiHttpException } from '../common/errors/api-http.exception';
import { StructuredLogger } from '../observability/structured-logger.service';
import { ParticipantsService } from '../participants/participants.service';
import { SessionStore } from './session.store';
import type {
  CreateSessionResponse,
  EndSessionResponse,
  JoinSessionResponse,
  SessionParticipantInput,
  SessionParticipantView,
  SessionStateResponse,
  TranslationSession,
} from './session.types';

const MAX_PARTICIPANTS = 2;
const ROOM_CODE_PREFIX = 'APT';
const ROOM_CODE_RANDOM_SPACE = 36 ** 3;
const ROOM_CODE_GENERATION_ATTEMPTS = 100;

@Injectable()
export class SessionsService {
  constructor(
    private readonly participantTokenService: ParticipantTokenService,
    private readonly participantsService: ParticipantsService,
    private readonly sessionStore: SessionStore,
    private readonly logger: StructuredLogger,
  ) {}

  createSession(input: SessionParticipantInput): CreateSessionResponse {
    const operationStartedAt = Date.now();
    const now = Date.now();
    const session: TranslationSession = {
      createdAt: now,
      glossary: {},
      lastActivityAt: now,
      participantIds: [],
      recentTurnIds: [],
      roomCode: this.generateUniqueRoomCode(),
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

    if (host !== undefined && host.sourceLanguage === input.sourceLanguage) {
      throw new ApiHttpException(
        HttpStatus.CONFLICT,
        'LANGUAGE_PAIR_CONFLICT',
        'The guest source language must be different from the host source language.',
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

  getSession(roomCode: string): SessionStateResponse {
    return this.toSessionState(this.getRequiredSessionByRoomCode(roomCode));
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
    delete session.activeTurnId;
    session.closedAt = now;
    session.lastActivityAt = now;
    session.status = 'closed';
    this.sessionStore.save(session);
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

  private generateUniqueRoomCode(): string {
    for (
      let attempt = 0;
      attempt < ROOM_CODE_GENERATION_ATTEMPTS;
      attempt += 1
    ) {
      const randomPart = randomInt(ROOM_CODE_RANDOM_SPACE)
        .toString(36)
        .padStart(3, '0')
        .toUpperCase();
      const roomCode = `${ROOM_CODE_PREFIX}${randomPart}`;

      if (!this.sessionStore.hasRoomCode(roomCode)) {
        return roomCode;
      }
    }

    throw new ApiHttpException(
      HttpStatus.INTERNAL_SERVER_ERROR,
      'INTERNAL_ERROR',
      'Unable to allocate a unique room code.',
    );
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
