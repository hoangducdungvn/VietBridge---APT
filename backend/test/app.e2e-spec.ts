import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { App } from 'supertest/types';
import { ParticipantTokenService } from './../src/auth/participant-token.service';
import { StructuredLogger } from './../src/observability/structured-logger.service';
import { ParticipantStore } from './../src/participants/participant.store';
import { SessionStore } from './../src/sessions/session.store';
import { AppModule } from './../src/app.module';

describe('VietBridge backend (e2e)', () => {
  let app: INestApplication<App>;
  let participantStore: ParticipantStore;
  let sessionStore: SessionStore;
  let tokenService: ParticipantTokenService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    app.get(StructuredLogger).setLogLevels([]);
    participantStore = app.get(ParticipantStore);
    sessionStore = app.get(SessionStore);
    tokenService = app.get(ParticipantTokenService);
  });

  beforeEach(() => {
    participantStore.clear();
    sessionStore.clear();
    tokenService.clear();
  });

  it('starts the application', () => {
    expect(app).toBeDefined();
  });

  it('GET /health reports a healthy application', () => {
    return request(app.getHttpServer()).get('/health').expect(200).expect({
      service: 'vietbridge-backend',
      status: 'ok',
    });
  });

  it('GET /api/rooms always returns the five lobby slots', async () => {
    const initialResponse = await request(app.getHttpServer())
      .get('/api/rooms')
      .expect(200);
    const initialRooms = getArrayBody(initialResponse);
    expect(initialRooms).toHaveLength(5);
    expect(initialRooms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ roomCode: 'APT001', status: 'empty' }),
        expect.objectContaining({ roomCode: 'APT005', status: 'empty' }),
      ]),
    );

    await request(app.getHttpServer())
      .post('/api/sessions')
      .send({
        displayName: 'Duong',
        roomCode: 'APT004',
        sourceLanguage: 'vi',
      })
      .expect(201);
    const occupiedResponse = await request(app.getHttpServer())
      .get('/api/rooms')
      .expect(200);
    expect(getArrayBody(occupiedResponse)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          occupancy: 1,
          roomCode: 'APT004',
          status: 'waiting',
        }),
      ]),
    );
  });

  it('supports the complete Phase 2 session REST lifecycle', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/api/sessions')
      .send({
        displayName: '  Duong  ',
        sourceLanguage: 'vi',
      })
      .expect(201);
    const created = getBody(createResponse);
    const sessionId = getString(created, 'sessionId');
    const roomCode = getString(created, 'roomCode');

    expect(getString(created, 'accessToken').length).toBeGreaterThan(0);
    expect(getString(created, 'participantId')).toMatch(/^participant_/);
    expect(roomCode).toMatch(/^APT[A-Z0-9]{3}$/);
    expect(sessionId).toMatch(/^session_/);
    expect(created.status).toBe('waiting');

    const waitingStateResponse = await request(app.getHttpServer())
      .get(`/api/sessions/${roomCode.toLowerCase()}`)
      .expect(200);
    expect(getBody(waitingStateResponse)).toEqual(
      expect.objectContaining({
        participants: [
          expect.objectContaining({
            connectionStatus: 'offline',
            displayName: 'Duong',
            role: 'host',
            sourceLanguage: 'vi',
            targetLanguage: 'en',
          }),
        ],
        roomCode,
        sessionId,
        status: 'waiting',
      }),
    );

    const joinResponse = await request(app.getHttpServer())
      .post(`/api/sessions/${roomCode}/join`)
      .send({
        displayName: 'Alex',
        sourceLanguage: 'en',
      })
      .expect(200);
    const joined = getBody(joinResponse);
    expect(getString(joined, 'accessToken').length).toBeGreaterThan(0);
    expect(getString(joined, 'participantId')).toMatch(/^participant_/);
    expect(joined.sessionId).toBe(sessionId);
    expect(joined.status).toBe('active');

    const activeStateResponse = await request(app.getHttpServer())
      .get(`/api/sessions/${roomCode}`)
      .expect(200);
    const activeState = getBody(activeStateResponse);
    expect(activeState.status).toBe('active');
    expect(activeState.participants).toEqual([
      expect.objectContaining({ role: 'host', targetLanguage: 'en' }),
      expect.objectContaining({ role: 'guest', targetLanguage: 'vi' }),
    ]);

    const fullResponse = await request(app.getHttpServer())
      .post(`/api/sessions/${roomCode}/join`)
      .send({
        displayName: 'Third participant',
        sourceLanguage: 'vi',
      })
      .expect(409);
    expect(getBody(fullResponse).code).toBe('SESSION_FULL');

    await request(app.getHttpServer())
      .post(`/api/sessions/${sessionId}/end`)
      .expect(200, { sessionId, status: 'closed' });
    await request(app.getHttpServer())
      .post(`/api/sessions/${sessionId}/end`)
      .expect(200, { sessionId, status: 'closed' });

    const closedJoinResponse = await request(app.getHttpServer())
      .post(`/api/sessions/${roomCode}/join`)
      .send({
        displayName: 'Late guest',
        sourceLanguage: 'en',
      })
      .expect(409);
    expect(getBody(closedJoinResponse).code).toBe('SESSION_CLOSED');
  });

  it('enforces one Vietnamese and one English participant', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/api/sessions')
      .send({ displayName: 'Duong', sourceLanguage: 'vi' })
      .expect(201);
    const created = getBody(createResponse);
    const roomCode = getString(created, 'roomCode');

    const conflictResponse = await request(app.getHttpServer())
      .post(`/api/sessions/${roomCode}/join`)
      .send({ displayName: 'Minh', sourceLanguage: 'vi' })
      .expect(409);

    expect(getBody(conflictResponse)).toEqual(
      expect.objectContaining({
        code: 'LANGUAGE_PAIR_CONFLICT',
        statusCode: 409,
      }),
    );

    await request(app.getHttpServer())
      .post(`/api/sessions/${roomCode}/join`)
      .send({ displayName: 'Alex', sourceLanguage: 'en' })
      .expect(200);
  });

  it('validates session input and returns the global error format', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/sessions')
      .send({
        displayName: '   ',
        sourceLanguage: 'fr',
        unexpected: true,
      })
      .expect(400);
    const error = getBody(response);

    expect(error).toEqual(
      expect.objectContaining({
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed.',
        path: '/api/sessions',
        statusCode: 400,
      }),
    );
    expect(getString(error, 'timestamp').length).toBeGreaterThan(0);
    expect(Array.isArray(error.details)).toBe(true);
  });

  it('returns SESSION_NOT_FOUND for an unknown valid room code', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/sessions/APT000')
      .expect(404);

    expect(getBody(response)).toEqual(
      expect.objectContaining({
        code: 'SESSION_NOT_FOUND',
        statusCode: 404,
      }),
    );
  });

  afterAll(async () => {
    await app.close();
  });
});

function getBody(response: Response): Record<string, unknown> {
  const body = response.body as unknown;

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('Expected the response body to be a JSON object.');
  }

  return body as Record<string, unknown>;
}

function getArrayBody(response: Response): unknown[] {
  const body = response.body as unknown;
  if (!Array.isArray(body)) {
    throw new Error('Expected the response body to be an array.');
  }
  return body;
}

function getString(body: Record<string, unknown>, key: string): string {
  const value = body[key];

  if (typeof value !== 'string') {
    throw new Error(`Expected response field ${key} to be a string.`);
  }

  return value;
}
