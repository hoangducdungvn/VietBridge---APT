import { HttpException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ParticipantTokenService } from '../auth/participant-token.service';
import { StructuredLogger } from '../observability/structured-logger.service';
import { SessionsModule } from './sessions.module';
import { SessionsService } from './sessions.service';

describe('SessionsService', () => {
  let moduleRef: TestingModule;
  let service: SessionsService;
  let tokenService: ParticipantTokenService;

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [SessionsModule],
    }).compile();
    service = moduleRef.get(SessionsService);
    tokenService = moduleRef.get(ParticipantTokenService);
    moduleRef.get(StructuredLogger).setLogLevels([]);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('creates a waiting session with a host participant', () => {
    const created = service.createSession({
      displayName: 'Duong',
      sourceLanguage: 'vi',
    });
    const state = service.getSession(created.roomCode);

    expect(created.accessToken.length).toBeGreaterThan(0);
    expect(created.participantId).toMatch(/^participant_/);
    expect(created.roomCode).toMatch(/^APT[A-Z0-9]{3}$/);
    expect(created.sessionId).toMatch(/^session_/);
    expect(created.status).toBe('waiting');
    expect(state.status).toBe('waiting');
    expect(state.participants).toEqual([
      expect.objectContaining({
        connectionStatus: 'offline',
        participantId: created.participantId,
        role: 'host',
        sourceLanguage: 'vi',
        targetLanguage: 'en',
      }),
    ]);
  });

  it('always exposes five rooms and allocates each slot once', () => {
    expect(service.getLobbyRooms()).toEqual([
      expect.objectContaining({ roomCode: 'APT001', status: 'empty' }),
      expect.objectContaining({ roomCode: 'APT002', status: 'empty' }),
      expect.objectContaining({ roomCode: 'APT003', status: 'empty' }),
      expect.objectContaining({ roomCode: 'APT004', status: 'empty' }),
      expect.objectContaining({ roomCode: 'APT005', status: 'empty' }),
    ]);

    const sessions = Array.from({ length: 5 }, (_, index) =>
      service.createSession({
        displayName: `Host ${index}`,
        sourceLanguage: 'vi',
      }),
    );
    expect(sessions.map((session) => session.roomCode)).toEqual([
      'APT001',
      'APT002',
      'APT003',
      'APT004',
      'APT005',
    ]);
    expectApiError(
      () =>
        service.createSession({
          displayName: 'Sixth host',
          sourceLanguage: 'vi',
        }),
      'LOBBY_FULL',
    );

    service.endSession(sessions[2].sessionId);
    expect(
      service.createSession({
        displayName: 'Replacement host',
        roomCode: 'APT003',
        sourceLanguage: 'en',
      }).roomCode,
    ).toBe('APT003');
  });

  it('joins a second participant and activates the session', () => {
    const created = service.createSession({
      displayName: 'Duong',
      sourceLanguage: 'vi',
    });
    const joined = service.joinSession(created.roomCode, {
      displayName: 'Alex',
      sourceLanguage: 'en',
    });
    const state = service.getSession(created.roomCode);

    expect(joined.status).toBe('active');
    expect(state.status).toBe('active');
    expect(state.participants).toHaveLength(2);
    expect(state.participants[1]).toEqual(
      expect.objectContaining({
        participantId: joined.participantId,
        role: 'guest',
        sourceLanguage: 'en',
        targetLanguage: 'vi',
      }),
    );
  });

  it('rejects a guest using the same source language as the host', () => {
    const created = service.createSession({
      displayName: 'Duong',
      sourceLanguage: 'vi',
    });

    expectApiError(
      () =>
        service.joinSession(created.roomCode, {
          displayName: 'Same language guest',
          sourceLanguage: 'vi',
        }),
      'LANGUAGE_PAIR_CONFLICT',
    );

    expect(service.getSession(created.roomCode).participants).toHaveLength(1);
  });

  it('supports the reverse English host and Vietnamese guest pair', () => {
    const created = service.createSession({
      displayName: 'Alex',
      sourceLanguage: 'en',
    });
    service.joinSession(created.roomCode, {
      displayName: 'Duong',
      sourceLanguage: 'vi',
    });

    expect(service.getSession(created.roomCode).participants).toEqual([
      expect.objectContaining({ role: 'host', sourceLanguage: 'en' }),
      expect.objectContaining({ role: 'guest', sourceLanguage: 'vi' }),
    ]);
  });

  it('rejects a third participant', () => {
    const created = service.createSession({
      displayName: 'Duong',
      sourceLanguage: 'vi',
    });
    service.joinSession(created.roomCode, {
      displayName: 'Alex',
      sourceLanguage: 'en',
    });

    expectApiError(
      () =>
        service.joinSession(created.roomCode, {
          displayName: 'Third participant',
          sourceLanguage: 'vi',
        }),
      'SESSION_FULL',
    );
  });

  it('rejects joining a closed session', () => {
    const created = service.createSession({
      displayName: 'Duong',
      sourceLanguage: 'vi',
    });
    service.endSession(created.sessionId);

    expectApiError(
      () =>
        service.joinSession(created.roomCode, {
          displayName: 'Alex',
          sourceLanguage: 'en',
        }),
      'SESSION_CLOSED',
    );
  });

  it('ends a session idempotently', () => {
    const created = service.createSession({
      displayName: 'Duong',
      sourceLanguage: 'vi',
    });
    const firstResult = service.endSession(created.sessionId);
    const firstState = service.getSession(created.roomCode);
    const secondResult = service.endSession(created.sessionId);
    const secondState = service.getSession(created.roomCode);

    expect(firstResult).toEqual({
      sessionId: created.sessionId,
      status: 'closed',
    });
    expect(secondResult).toEqual(firstResult);
    expect(secondState.closedAt).toBe(firstState.closedAt);
  });

  it('issues a token tied to the session and participant and revokes it on end', () => {
    const created = service.createSession({
      displayName: 'Duong',
      sourceLanguage: 'vi',
    });

    expect(tokenService.verifyToken(created.accessToken)).toEqual(
      expect.objectContaining({
        participantId: created.participantId,
        sessionId: created.sessionId,
      }),
    );

    service.endSession(created.sessionId);
    expectApiError(
      () => tokenService.verifyToken(created.accessToken),
      'INVALID_TOKEN',
    );
  });
});

function expectApiError(action: () => unknown, expectedCode: string): void {
  try {
    action();
    throw new Error(`Expected API error ${expectedCode}.`);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(HttpException);

    if (error instanceof HttpException) {
      expect(error.getResponse()).toEqual(
        expect.objectContaining({ code: expectedCode }),
      );
    }
  }
}
