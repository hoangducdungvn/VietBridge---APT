import { HttpException, HttpStatus } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ParticipantTokenService } from '../auth/participant-token.service';
import type { ParticipantTokenClaims } from '../auth/participant-token.types';
import { ApiHttpException } from '../common/errors/api-http.exception';
import { validateCorsOrigin } from '../config/cors-origin';
import { StructuredLogger } from '../observability/structured-logger.service';
import type { Participant } from '../participants/participant.types';
import { ParticipantsService } from '../participants/participants.service';
import { PipelineService } from '../pipeline/pipeline.service';
import { SessionsService } from '../sessions/sessions.service';
import type { SessionParticipantView } from '../sessions/session.types';

interface EventContext {
  eventId: string;
  participantId: string;
  payload: Record<string, unknown>;
  sessionId: string;
  turnId?: string;
}

interface AudioChunkEvent {
  audio: unknown;
  participantId: string;
  sequence: number;
  sessionId: string;
  turnId: string;
}

@WebSocketGateway({
  cors: {
    credentials: true,
    origin: validateCorsOrigin,
  },
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  private server!: Server;

  private readonly claimsBySocketId = new Map<string, ParticipantTokenClaims>();

  constructor(
    private readonly logger: StructuredLogger,
    private readonly participantTokenService: ParticipantTokenService,
    private readonly participantsService: ParticipantsService,
    private readonly pipelineService: PipelineService,
    private readonly sessionsService: SessionsService,
  ) {}

  afterInit(server: Server): void {
    this.pipelineService.setPartialHandler((result) => {
      server.to(roomName(result.sessionId)).emit('stt.partial', {
        serverTimestamp: Date.now(),
        sessionId: result.sessionId,
        turnId: result.turnId,
        type: 'stt.partial',
        payload: {
          backend: result.backend,
          ...(result.eou === undefined ? {} : { eou: result.eou }),
          language: result.language,
          lowConfidence: result.lowConfidence,
          participantId: result.participantId,
          providerLatencyMs: result.providerLatencyMs,
          text: result.text,
        },
      });
    });
    this.pipelineService.setFinalHandler((result) => {
      server.to(roomName(result.sessionId)).emit('stt.final', {
        serverTimestamp: Date.now(),
        sessionId: result.sessionId,
        turnId: result.turnId,
        type: 'stt.final',
        payload: {
          backend: result.backend,
          ...(result.eou === undefined ? {} : { eou: result.eou }),
          language: result.language,
          lowConfidence: result.lowConfidence,
          participantId: result.participantId,
          providerLatencyMs: result.providerLatencyMs,
          text: result.text,
        },
      });
    });
    this.pipelineService.setTranslationStartedHandler((result) => {
      server.to(roomName(result.sessionId)).emit('translation.started', {
        serverTimestamp: Date.now(),
        sessionId: result.sessionId,
        turnId: result.turnId,
        type: 'translation.started',
        payload: {},
      });
    });
    this.pipelineService.setMessageFinalHandler((result) => {
      server.to(roomName(result.sessionId)).emit('message.final', {
        serverTimestamp: Date.now(),
        sessionId: result.sessionId,
        turnId: result.turnId,
        type: 'message.final',
        payload: {
          createdAt: result.createdAt,
          latency: result.latency,
          messageId: result.messageId,
          sequence: result.sequence,
          sourceLanguage: result.sourceLanguage,
          sourceText: result.sourceText,
          speaker: result.speaker,
          targetLanguage: result.targetLanguage,
          translatedText: result.translatedText,
        },
      });
    });
    server.use((socket, next) => {
      try {
        const accessToken = readAccessToken(socket.handshake.auth);
        const claims = this.participantTokenService.verifyToken(accessToken);
        const participant = this.participantsService.getRequiredParticipant(
          claims.participantId,
        );

        if (participant.sessionId !== claims.sessionId) {
          throw new ApiHttpException(
            HttpStatus.UNAUTHORIZED,
            'INVALID_TOKEN',
            'The participant token does not match its session.',
          );
        }

        this.claimsBySocketId.set(socket.id, claims);
        next();
      } catch (error: unknown) {
        const details = extractError(error);
        const handshakeError = new Error(details.code);
        Object.assign(handshakeError, {
          data: { code: details.code, message: details.message },
        });
        next(handshakeError);
      }
    });
  }

  async handleConnection(client: Socket): Promise<void> {
    const claims = this.claimsBySocketId.get(client.id);
    if (claims === undefined) {
      client.disconnect(true);
      return;
    }

    const participant = this.participantsService.getRequiredParticipant(
      claims.participantId,
    );
    const previousSocketId = participant.socketId;
    if (previousSocketId !== undefined && previousSocketId !== client.id) {
      this.server.sockets.sockets.get(previousSocketId)?.disconnect(true);
    }

    await client.join(roomName(claims.sessionId));
    this.participantsService.markOnline(claims.participantId, client.id);
    this.emitParticipantPresence('participant.joined', participant);
    this.emitSessionState(claims.sessionId);
    this.logRealtimeEvent('participant.connected', claims, null, 'success');
  }

  handleDisconnect(client: Socket): void {
    const claims = this.claimsBySocketId.get(client.id);
    this.claimsBySocketId.delete(client.id);
    if (claims === undefined) {
      return;
    }

    const participant = this.participantsService.markOfflineBySocketId(
      client.id,
    );
    if (participant === undefined) {
      return;
    }

    this.pipelineService.cancelOpenTurnsForParticipant(
      claims.sessionId,
      claims.participantId,
    );
    this.emitParticipantPresence('participant.left', participant);
    this.emitSessionState(claims.sessionId);
    this.logRealtimeEvent('participant.disconnected', claims, null, 'success');
  }

  @SubscribeMessage('turn.start')
  handleTurnStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() eventValue: unknown,
  ): void {
    try {
      const event = parseEventContext(eventValue, 'turn.start');
      const claims = this.assertEventIdentity(client, event);
      const result = this.pipelineService.startTurn(
        claims.sessionId,
        claims.participantId,
        event.payload.audioConfig,
      );

      client.emit('turn.accepted', {
        participantId: claims.participantId,
        serverTimestamp: Date.now(),
        sessionId: claims.sessionId,
        turnId: result.turnId,
        type: 'turn.accepted',
        payload: { sequence: result.sequence },
      });
    } catch (error: unknown) {
      const details = extractError(error);
      const claims = this.claimsBySocketId.get(client.id);
      client.emit('turn.rejected', {
        participantId: claims?.participantId,
        serverTimestamp: Date.now(),
        sessionId: claims?.sessionId ?? readOptionalSessionId(eventValue),
        type: 'turn.rejected',
        payload: details,
      });
    }
  }

  @SubscribeMessage('audio.chunk')
  handleAudioChunk(
    @ConnectedSocket() client: Socket,
    @MessageBody() eventValue: unknown,
  ): void {
    try {
      const event = parseAudioChunk(eventValue);
      const claims = this.getRequiredClaims(client);
      assertIdentity(claims, event.sessionId, event.participantId);
      this.pipelineService.appendAudio(event);
    } catch (error: unknown) {
      this.emitPipelineError(client, eventValue, error);
    }
  }

  @SubscribeMessage('turn.end')
  async handleTurnEnd(
    @ConnectedSocket() client: Socket,
    @MessageBody() eventValue: unknown,
  ): Promise<void> {
    try {
      const event = parseEventContext(eventValue, 'turn.end', true);
      const claims = this.assertEventIdentity(client, event);
      await this.pipelineService.endTurn(
        claims.sessionId,
        claims.participantId,
        event.turnId as string,
      );
    } catch (error: unknown) {
      this.emitPipelineError(client, eventValue, error);
    }
  }

  @SubscribeMessage('turn.cancel')
  handleTurnCancel(
    @ConnectedSocket() client: Socket,
    @MessageBody() eventValue: unknown,
  ): void {
    try {
      const event = parseEventContext(eventValue, 'turn.cancel', true);
      const claims = this.assertEventIdentity(client, event);
      this.pipelineService.cancelTurn(
        claims.sessionId,
        claims.participantId,
        event.turnId as string,
      );
    } catch (error: unknown) {
      this.emitPipelineError(client, eventValue, error);
    }
  }

  private getRequiredClaims(client: Socket): ParticipantTokenClaims {
    const claims = this.claimsBySocketId.get(client.id);
    if (claims === undefined) {
      throw new ApiHttpException(
        HttpStatus.UNAUTHORIZED,
        'INVALID_TOKEN',
        'The socket is not authenticated.',
      );
    }
    return claims;
  }

  private assertEventIdentity(
    client: Socket,
    event: EventContext,
  ): ParticipantTokenClaims {
    const claims = this.getRequiredClaims(client);
    assertIdentity(claims, event.sessionId, event.participantId);
    return claims;
  }

  private emitSessionState(sessionId: string): void {
    const state = this.sessionsService.getSessionStateById(sessionId);
    this.server.to(roomName(sessionId)).emit('session.state', {
      serverTimestamp: Date.now(),
      sessionId,
      type: 'session.state',
      payload: {
        participants: state.participants,
        status: state.status,
      },
    });
  }

  private emitParticipantPresence(
    type: 'participant.joined' | 'participant.left',
    participant: Participant,
  ): void {
    this.server.to(roomName(participant.sessionId)).emit(type, {
      participantId: participant.participantId,
      serverTimestamp: Date.now(),
      sessionId: participant.sessionId,
      type,
      payload: toParticipantView(participant),
    });
  }

  private emitPipelineError(
    client: Socket,
    eventValue: unknown,
    error: unknown,
  ): void {
    const details = extractError(error);
    const claims = this.claimsBySocketId.get(client.id);
    client.emit('pipeline.error', {
      participantId: claims?.participantId,
      serverTimestamp: Date.now(),
      sessionId: claims?.sessionId ?? readOptionalSessionId(eventValue),
      turnId: readOptionalTurnId(eventValue),
      type: 'pipeline.error',
      payload: { ...details, recoverable: details.code !== 'INVALID_TOKEN' },
    });
  }

  private logRealtimeEvent(
    event: string,
    claims: ParticipantTokenClaims,
    turnId: string | null,
    status: string,
  ): void {
    this.logger.log(
      {
        durationMs: null,
        errorCode: null,
        event,
        participantId: claims.participantId,
        sessionId: claims.sessionId,
        status,
        turnId,
      },
      RealtimeGateway.name,
    );
  }
}

function readAccessToken(authValue: unknown): string {
  if (
    !isRecord(authValue) ||
    typeof authValue.accessToken !== 'string' ||
    authValue.accessToken.length === 0
  ) {
    throw new ApiHttpException(
      HttpStatus.UNAUTHORIZED,
      'INVALID_TOKEN',
      'A participant access token is required.',
    );
  }
  return authValue.accessToken;
}

function parseEventContext(
  value: unknown,
  expectedType: string,
  requiresTurnId = false,
): EventContext {
  if (
    !isRecord(value) ||
    value.type !== expectedType ||
    !isRecord(value.payload)
  ) {
    throw invalidEvent(expectedType);
  }

  const eventId = readNonEmptyString(value, 'eventId');
  const sessionId = readNonEmptyString(value, 'sessionId');
  const participantId = readNonEmptyString(value, 'participantId');
  const turnId = readOptionalNonEmptyString(value, 'turnId');
  if (requiresTurnId && turnId === undefined) {
    throw invalidEvent(expectedType);
  }

  return {
    eventId,
    participantId,
    payload: value.payload,
    sessionId,
    ...(turnId === undefined ? {} : { turnId }),
  };
}

function parseAudioChunk(value: unknown): AudioChunkEvent {
  if (!isRecord(value)) {
    throw invalidEvent('audio.chunk');
  }
  const sequence = value.sequence;
  if (typeof sequence !== 'number') {
    throw invalidEvent('audio.chunk');
  }

  return {
    audio: value.audio,
    participantId: readNonEmptyString(value, 'participantId'),
    sequence,
    sessionId: readNonEmptyString(value, 'sessionId'),
    turnId: readNonEmptyString(value, 'turnId'),
  };
}

function assertIdentity(
  claims: ParticipantTokenClaims,
  sessionId: string,
  participantId: string,
): void {
  if (
    claims.sessionId !== sessionId ||
    claims.participantId !== participantId
  ) {
    throw new ApiHttpException(
      HttpStatus.UNAUTHORIZED,
      'INVALID_TOKEN',
      'Event identity does not match the authenticated participant.',
    );
  }
}

function extractError(error: unknown): { code: string; message: string } {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (isRecord(response)) {
      return {
        code:
          typeof response.code === 'string' ? response.code : 'REQUEST_FAILED',
        message:
          typeof response.message === 'string'
            ? response.message
            : 'The realtime request was rejected.',
      };
    }
  }

  return { code: 'INTERNAL_ERROR', message: 'Internal realtime error.' };
}

function toParticipantView(participant: Participant): SessionParticipantView {
  return {
    connectionStatus: participant.connectionStatus,
    displayName: participant.displayName,
    participantId: participant.participantId,
    role: participant.role,
    sourceLanguage: participant.sourceLanguage,
    targetLanguage: participant.targetLanguage,
  };
}

function invalidEvent(type: string): ApiHttpException {
  return new ApiHttpException(
    HttpStatus.BAD_REQUEST,
    'INVALID_TURN_STATE',
    `Invalid ${type} event payload.`,
  );
}

function readNonEmptyString(
  value: Record<string, unknown>,
  key: string,
): string {
  const field = value[key];
  if (typeof field !== 'string' || field.trim() === '') {
    throw invalidEvent('realtime');
  }
  return field;
}

function readOptionalNonEmptyString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const field = value[key];
  return typeof field === 'string' && field.trim() !== '' ? field : undefined;
}

function readOptionalSessionId(value: unknown): string | undefined {
  return isRecord(value) && typeof value.sessionId === 'string'
    ? value.sessionId
    : undefined;
}

function readOptionalTurnId(value: unknown): string | undefined {
  return isRecord(value) && typeof value.turnId === 'string'
    ? value.turnId
    : undefined;
}

function roomName(sessionId: string): string {
  return `session:${sessionId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
