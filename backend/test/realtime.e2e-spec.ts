import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { io, Socket as ClientSocket } from 'socket.io-client';
import request, { type Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { ParticipantTokenService } from '../src/auth/participant-token.service';
import { StructuredLogger } from '../src/observability/structured-logger.service';
import { ParticipantStore } from '../src/participants/participant.store';
import { SessionStore } from '../src/sessions/session.store';
import { TurnStore } from '../src/turns/turn.store';

interface PairFixture {
  guestParticipantId: string;
  guestToken: string;
  hostParticipantId: string;
  hostToken: string;
  roomCode: string;
  sessionId: string;
}

describe('VietBridge realtime room and turns (e2e)', () => {
  let app: INestApplication<App>;
  let baseUrl: string;
  let participantStore: ParticipantStore;
  let sessionStore: SessionStore;
  let tokenService: ParticipantTokenService;
  let turnStore: TurnStore;
  let sockets: ClientSocket[];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.get(StructuredLogger).setLogLevels([]);
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    participantStore = app.get(ParticipantStore);
    sessionStore = app.get(SessionStore);
    tokenService = app.get(ParticipantTokenService);
    turnStore = app.get(TurnStore);
  });

  beforeEach(() => {
    participantStore.clear();
    sessionStore.clear();
    tokenService.clear();
    turnStore.clear();
    sockets = [];
  });

  afterEach(async () => {
    sockets.forEach((socket) => socket.disconnect());
    await delay(20);
  });

  it('rejects an invalid handshake token', async () => {
    const socket = createSocket('not-a-valid-token');
    const errorPromise = onceEvent<Error>(socket, 'connect_error');
    socket.connect();
    const error = await errorPromise;

    expect(error.message).toBe('INVALID_TOKEN');
    expect(socket.connected).toBe(false);
  });

  it('joins both participants to one room and broadcasts online/offline state', async () => {
    const pair = await createPair(app);
    const host = createSocket(pair.hostToken);
    const hostInitialStatePromise = onceEvent<unknown>(host, 'session.state');
    await connect(host);
    expect(getParticipants(await hostInitialStatePromise)).toEqual([
      expect.objectContaining({
        connectionStatus: 'online',
        participantId: pair.hostParticipantId,
      }),
      expect.objectContaining({
        connectionStatus: 'offline',
        participantId: pair.guestParticipantId,
      }),
    ]);

    const guest = createSocket(pair.guestToken);
    const hostJoinedPromise = onceEvent<unknown>(host, 'participant.joined');
    const hostActiveStatePromise = onceEvent<unknown>(host, 'session.state');
    const guestStatePromise = onceEvent<unknown>(guest, 'session.state');
    await connect(guest);

    expect(getRecord(await hostJoinedPromise).participantId).toBe(
      pair.guestParticipantId,
    );
    expect(getParticipants(await hostActiveStatePromise)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ connectionStatus: 'online', role: 'host' }),
        expect.objectContaining({ connectionStatus: 'online', role: 'guest' }),
      ]),
    );
    await guestStatePromise;

    const leftPromise = onceEvent<unknown>(host, 'participant.left');
    const offlineStatePromise = onceEvent<unknown>(host, 'session.state');
    guest.disconnect();
    expect(getRecord(await leftPromise).participantId).toBe(
      pair.guestParticipantId,
    );
    expect(getParticipants(await offlineStatePromise)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          connectionStatus: 'offline',
          participantId: pair.guestParticipantId,
        }),
      ]),
    );
  });

  it('processes both participants concurrently and isolates their audio', async () => {
    const pair = await createPair(app);
    const host = createSocket(pair.hostToken);
    const guest = createSocket(pair.guestToken);
    await connect(host);
    await connect(guest);

    const hostAcceptedPromise = onceEvent<unknown>(host, 'turn.accepted');
    const guestAcceptedPromise = onceEvent<unknown>(guest, 'turn.accepted');
    host.emit(
      'turn.start',
      turnEvent('turn.start', pair, pair.hostParticipantId),
    );
    guest.emit(
      'turn.start',
      turnEvent('turn.start', pair, pair.guestParticipantId),
    );

    const hostTurnId = getString(
      getRecord(await hostAcceptedPromise),
      'turnId',
    );
    const guestTurnId = getString(
      getRecord(await guestAcceptedPromise),
      'turnId',
    );
    expect(hostTurnId).not.toBe(guestTurnId);

    const audioErrorPromise = onceEvent<unknown>(guest, 'pipeline.error');
    guest.emit('audio.chunk', {
      audio: Buffer.alloc(320),
      participantId: pair.guestParticipantId,
      sequence: 0,
      sessionId: pair.sessionId,
      turnId: 'turn_00000000-0000-4000-8000-000000000000',
    });
    expect(getRecord(getRecord(await audioErrorPromise).payload).code).toBe(
      'TURN_NOT_FOUND',
    );

    host.emit('audio.chunk', {
      audio: Buffer.alloc(320),
      participantId: pair.hostParticipantId,
      sequence: 0,
      sessionId: pair.sessionId,
      turnId: hostTurnId,
    });
    guest.emit('audio.chunk', {
      audio: Buffer.alloc(320),
      participantId: pair.guestParticipantId,
      sequence: 0,
      sessionId: pair.sessionId,
      turnId: guestTurnId,
    });
    await delay(20);
    expect(turnStore.getBufferedByteLength(hostTurnId)).toBe(320);
    expect(turnStore.getBufferedByteLength(guestTurnId)).toBe(320);

    const hostFinalsPromise = collectEvents(host, 'stt.final', 2);
    const guestFinalsPromise = collectEvents(guest, 'stt.final', 2);
    const hostMessagesPromise = collectEvents(host, 'message.final', 2);
    const guestMessagesPromise = collectEvents(guest, 'message.final', 2);
    const hostEndEvent = turnEvent(
      'turn.end',
      pair,
      pair.hostParticipantId,
      hostTurnId,
    );
    const guestEndEvent = turnEvent(
      'turn.end',
      pair,
      pair.guestParticipantId,
      guestTurnId,
    );
    host.emit('turn.end', hostEndEvent);
    guest.emit('turn.end', guestEndEvent);

    const hostFinals = await hostFinalsPromise;
    const guestFinals = await guestFinalsPromise;
    const hostMessages = await hostMessagesPromise;
    const guestMessages = await guestMessagesPromise;
    expect(finalTurnIds(hostFinals)).toEqual(
      expect.arrayContaining([hostTurnId, guestTurnId]),
    );
    expect(finalTurnIds(guestFinals)).toEqual(
      expect.arrayContaining([hostTurnId, guestTurnId]),
    );
    expect(finalLanguages(hostFinals)).toEqual(
      expect.arrayContaining(['vi', 'en']),
    );
    expect(messageLanguages(hostMessages, 'sourceLanguage')).toEqual(
      expect.arrayContaining(['vi', 'en']),
    );
    expect(messageLanguages(hostMessages, 'targetLanguage')).toEqual(
      expect.arrayContaining(['en', 'vi']),
    );
    expect(messageSpeakerIds(hostMessages)).toEqual(
      expect.arrayContaining([pair.hostParticipantId, pair.guestParticipantId]),
    );
    expect(messageTurnIds(guestMessages)).toEqual(
      expect.arrayContaining([hostTurnId, guestTurnId]),
    );
    expect(
      hostMessages.every(
        (event) =>
          getString(getRecord(getRecord(event).payload), 'translatedText')
            .length > 0,
      ),
    ).toBe(true);
    expect(turnStore.getBufferedByteLength(hostTurnId)).toBe(0);
    expect(turnStore.getBufferedByteLength(guestTurnId)).toBe(0);

    let duplicateFinalCount = 0;
    let duplicateMessageCount = 0;
    host.on('stt.final', () => {
      duplicateFinalCount += 1;
    });
    host.on('message.final', () => {
      duplicateMessageCount += 1;
    });
    host.emit('turn.end', {
      ...hostEndEvent,
      eventId: 'event-duplicate-end',
    });
    await delay(400);
    expect(duplicateFinalCount).toBe(0);
    expect(duplicateMessageCount).toBe(0);
  });

  afterAll(async () => app.close());

  function createSocket(accessToken: string): ClientSocket {
    const socket = io(baseUrl, {
      auth: { accessToken },
      autoConnect: false,
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
    });
    sockets.push(socket);
    return socket;
  }
});

async function createPair(app: INestApplication<App>): Promise<PairFixture> {
  const createResponse = await request(app.getHttpServer())
    .post('/api/sessions')
    .send({ displayName: 'Duong', sourceLanguage: 'vi' })
    .expect(201);
  const created = getBody(createResponse);
  const roomCode = getString(created, 'roomCode');
  const joinResponse = await request(app.getHttpServer())
    .post(`/api/sessions/${roomCode}/join`)
    .send({ displayName: 'Alex', sourceLanguage: 'en' })
    .expect(200);
  const joined = getBody(joinResponse);

  return {
    guestParticipantId: getString(joined, 'participantId'),
    guestToken: getString(joined, 'accessToken'),
    hostParticipantId: getString(created, 'participantId'),
    hostToken: getString(created, 'accessToken'),
    roomCode,
    sessionId: getString(created, 'sessionId'),
  };
}

function turnEvent(
  type: 'turn.start' | 'turn.end',
  pair: PairFixture,
  participantId: string,
  turnId?: string,
): Record<string, unknown> {
  return {
    eventId: `event-${type}-${participantId}`,
    participantId,
    payload:
      type === 'turn.start'
        ? {
            audioConfig: {
              channels: 1,
              codec: 'pcm_s16le',
              sampleRate: 16_000,
            },
          }
        : {},
    sessionId: pair.sessionId,
    ...(turnId === undefined ? {} : { turnId }),
    type,
  };
}

function connect(socket: ClientSocket): Promise<void> {
  const promise = onceEvent<void>(socket, 'connect');
  socket.connect();
  return promise;
}

function onceEvent<T>(socket: ClientSocket, eventName: string): Promise<T> {
  return new Promise<T>((resolve) => {
    socket.once(eventName, (payload: T) => resolve(payload));
  });
}

function collectEvents<T>(
  socket: ClientSocket,
  eventName: string,
  count: number,
): Promise<T[]> {
  return new Promise<T[]>((resolve) => {
    const events: T[] = [];
    const listener = (payload: T) => {
      events.push(payload);
      if (events.length === count) {
        socket.off(eventName, listener);
        resolve(events);
      }
    };
    socket.on(eventName, listener);
  });
}

function finalTurnIds(events: unknown[]): string[] {
  return events.map((event) => getString(getRecord(event), 'turnId'));
}

function finalLanguages(events: unknown[]): string[] {
  return events.map((event) =>
    getString(getRecord(getRecord(event).payload), 'language'),
  );
}

function messageLanguages(
  events: unknown[],
  key: 'sourceLanguage' | 'targetLanguage',
): string[] {
  return events.map((event) =>
    getString(getRecord(getRecord(event).payload), key),
  );
}

function messageSpeakerIds(events: unknown[]): string[] {
  return events.map((event) => {
    const payload = getRecord(getRecord(event).payload);
    return getString(getRecord(payload.speaker), 'participantId');
  });
}

function messageTurnIds(events: unknown[]): string[] {
  return events.map((event) => getString(getRecord(event), 'turnId'));
}

function getParticipants(event: unknown): unknown[] {
  const payload = getRecord(getRecord(event).payload);
  if (!Array.isArray(payload.participants)) {
    throw new Error('Expected realtime participants array.');
  }
  return payload.participants;
}

function getBody(response: Response): Record<string, unknown> {
  return getRecord(response.body as unknown);
}

function getRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected an object.');
  }
  return value as Record<string, unknown>;
}

function getString(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== 'string') {
    throw new Error(`Expected ${key} to be a string.`);
  }
  return field;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
