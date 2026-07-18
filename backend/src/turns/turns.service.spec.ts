import { HttpException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { StructuredLogger } from '../observability/structured-logger.service';
import { SessionsService } from '../sessions/sessions.service';
import { TurnStore } from './turn.store';
import { TurnsModule } from './turns.module';
import { TurnsService } from './turns.service';

const AUDIO_CONFIG = {
  channels: 1,
  codec: 'pcm_s16le',
  sampleRate: 16_000,
};

describe('TurnsService', () => {
  let moduleRef: TestingModule;
  let sessionsService: SessionsService;
  let turnStore: TurnStore;
  let turnsService: TurnsService;

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [TurnsModule],
    }).compile();
    moduleRef.get(StructuredLogger).setLogLevels([]);
    sessionsService = moduleRef.get(SessionsService);
    turnStore = moduleRef.get(TurnStore);
    turnsService = moduleRef.get(TurnsService);
  });

  afterEach(async () => moduleRef.close());

  it('grants independent simultaneous turns to both participants', () => {
    const pair = createActivePair(sessionsService);
    const hostTurn = turnsService.startTurn(
      pair.sessionId,
      pair.hostParticipantId,
      AUDIO_CONFIG,
    );
    const guestTurn = turnsService.startTurn(
      pair.sessionId,
      pair.guestParticipantId,
      AUDIO_CONFIG,
    );

    expect(hostTurn.sequence).toBe(1);
    expect(hostTurn.turnId).toMatch(/^turn_/);
    expect(guestTurn.sequence).toBe(2);
    expect(guestTurn.turnId).toMatch(/^turn_/);
    expect(hostTurn.turnId).not.toBe(guestTurn.turnId);
  });

  it('rejects only a duplicate capturing turn from the same participant', () => {
    const pair = createActivePair(sessionsService);
    turnsService.startTurn(
      pair.sessionId,
      pair.hostParticipantId,
      AUDIO_CONFIG,
    );

    expectApiError(
      () =>
        turnsService.startTurn(
          pair.sessionId,
          pair.hostParticipantId,
          AUDIO_CONFIG,
        ),
      'PARTICIPANT_TURN_ACTIVE',
    );
  });

  it('accepts a new segment while the previous segment is processing', () => {
    const pair = createActivePair(sessionsService);
    const first = turnsService.startTurn(
      pair.sessionId,
      pair.hostParticipantId,
      AUDIO_CONFIG,
    );
    turnsService.beginTurnEnd(
      pair.sessionId,
      pair.hostParticipantId,
      first.turnId,
    );

    expect(() =>
      turnsService.startTurn(
        pair.sessionId,
        pair.hostParticipantId,
        AUDIO_CONFIG,
      ),
    ).not.toThrow();
  });

  it('rejects audio without a known active turn', () => {
    const pair = createActivePair(sessionsService);

    expectApiError(
      () =>
        turnsService.appendAudio({
          audio: Buffer.alloc(320),
          participantId: pair.hostParticipantId,
          sequence: 0,
          sessionId: pair.sessionId,
          turnId: 'turn_00000000-0000-4000-8000-000000000000',
        }),
      'TURN_NOT_FOUND',
    );
  });

  it('buffers ordered PCM16 and cleans it after an idempotent end', () => {
    const pair = createActivePair(sessionsService);
    const accepted = turnsService.startTurn(
      pair.sessionId,
      pair.hostParticipantId,
      AUDIO_CONFIG,
    );
    turnsService.appendAudio({
      audio: Buffer.alloc(320),
      participantId: pair.hostParticipantId,
      sequence: 0,
      sessionId: pair.sessionId,
      turnId: accepted.turnId,
    });

    expect(turnStore.getBufferedByteLength(accepted.turnId)).toBe(320);
    const first = turnsService.endTurn(
      pair.sessionId,
      pair.hostParticipantId,
      accepted.turnId,
    );
    const duplicate = turnsService.endTurn(
      pair.sessionId,
      pair.hostParticipantId,
      accepted.turnId,
    );

    expect(first.duplicate).toBe(false);
    expect(duplicate).toEqual({ ...first, duplicate: true });
    expect(turnStore.getBufferedByteLength(accepted.turnId)).toBe(0);
    expect(
      turnStore.findCapturingByParticipant(
        pair.sessionId,
        pair.hostParticipantId,
      ),
    ).toBeUndefined();
    expect(
      sessionsService.getSessionById(pair.sessionId).recentTurnIds,
    ).toEqual([accepted.turnId]);
  });

  it('fails and cleans an out-of-order participant stream', () => {
    const pair = createActivePair(sessionsService);
    const accepted = turnsService.startTurn(
      pair.sessionId,
      pair.hostParticipantId,
      AUDIO_CONFIG,
    );
    turnsService.appendAudio({
      audio: Buffer.alloc(320),
      participantId: pair.hostParticipantId,
      sequence: 0,
      sessionId: pair.sessionId,
      turnId: accepted.turnId,
    });

    expectApiError(
      () =>
        turnsService.appendAudio({
          audio: Buffer.alloc(320),
          participantId: pair.hostParticipantId,
          sequence: 2,
          sessionId: pair.sessionId,
          turnId: accepted.turnId,
        }),
      'AUDIO_CHUNK_OUT_OF_ORDER',
    );

    expect(turnStore.getBufferedByteLength(accepted.turnId)).toBe(0);
    expect(
      turnStore.findCapturingByParticipant(
        pair.sessionId,
        pair.hostParticipantId,
      ),
    ).toBeUndefined();
    expect(() =>
      turnsService.startTurn(
        pair.sessionId,
        pair.guestParticipantId,
        AUDIO_CONFIG,
      ),
    ).not.toThrow();
  });

  it('cleans buffered audio when a turn is cancelled', () => {
    const pair = createActivePair(sessionsService);
    const accepted = turnsService.startTurn(
      pair.sessionId,
      pair.hostParticipantId,
      AUDIO_CONFIG,
    );
    turnsService.appendAudio({
      audio: Buffer.alloc(320),
      participantId: pair.hostParticipantId,
      sequence: 0,
      sessionId: pair.sessionId,
      turnId: accepted.turnId,
    });

    turnsService.cancelTurn(
      pair.sessionId,
      pair.hostParticipantId,
      accepted.turnId,
    );

    expect(turnStore.getBufferedByteLength(accepted.turnId)).toBe(0);
    expect(
      turnStore.findCapturingByParticipant(
        pair.sessionId,
        pair.hostParticipantId,
      ),
    ).toBeUndefined();
  });

  it('purges completed transcripts and active audio when the session ends', () => {
    const pair = createActivePair(sessionsService);
    const completed = turnsService.startTurn(
      pair.sessionId,
      pair.hostParticipantId,
      AUDIO_CONFIG,
    );
    turnsService.appendAudio({
      audio: Buffer.alloc(320),
      participantId: pair.hostParticipantId,
      sequence: 0,
      sessionId: pair.sessionId,
      turnId: completed.turnId,
    });
    turnsService.endTurn(
      pair.sessionId,
      pair.hostParticipantId,
      completed.turnId,
    );
    const active = turnsService.startTurn(
      pair.sessionId,
      pair.guestParticipantId,
      AUDIO_CONFIG,
    );
    turnsService.appendAudio({
      audio: Buffer.alloc(320),
      participantId: pair.guestParticipantId,
      sequence: 0,
      sessionId: pair.sessionId,
      turnId: active.turnId,
    });

    sessionsService.endSession(pair.sessionId);

    expect(turnStore.findById(completed.turnId)).toBeUndefined();
    expect(turnStore.findById(active.turnId)).toBeUndefined();
    expect(turnStore.getBufferedByteLength(active.turnId)).toBe(0);
    expect(
      sessionsService.getSessionById(pair.sessionId).recentTurnIds,
    ).toEqual([]);
  });
});

function createActivePair(service: SessionsService): {
  guestParticipantId: string;
  hostParticipantId: string;
  sessionId: string;
} {
  const created = service.createSession({
    displayName: 'Duong',
    sourceLanguage: 'vi',
  });
  const joined = service.joinSession(created.roomCode, {
    displayName: 'Alex',
    sourceLanguage: 'en',
  });
  return {
    guestParticipantId: joined.participantId,
    hostParticipantId: created.participantId,
    sessionId: created.sessionId,
  };
}

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
