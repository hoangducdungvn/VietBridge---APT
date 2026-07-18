import { Injectable } from '@nestjs/common';
import type { TranslationSession } from './session.types';

@Injectable()
export class SessionStore {
  private readonly sessionIdsByRoomCode = new Map<string, string>();
  private readonly sessionsById = new Map<string, TranslationSession>();

  save(session: TranslationSession): void {
    const existingSessionId = this.sessionIdsByRoomCode.get(session.roomCode);

    if (
      existingSessionId !== undefined &&
      existingSessionId !== session.sessionId &&
      this.sessionsById.get(existingSessionId)?.status !== 'closed'
    ) {
      throw new Error('The room code is already assigned to another session.');
    }

    this.sessionsById.set(session.sessionId, session);
    this.sessionIdsByRoomCode.set(session.roomCode, session.sessionId);
  }

  findById(sessionId: string): TranslationSession | undefined {
    return this.sessionsById.get(sessionId);
  }

  findByRoomCode(roomCode: string): TranslationSession | undefined {
    const sessionId = this.sessionIdsByRoomCode.get(roomCode);
    return sessionId === undefined
      ? undefined
      : this.sessionsById.get(sessionId);
  }

  hasRoomCode(roomCode: string): boolean {
    return this.sessionIdsByRoomCode.has(roomCode);
  }

  clear(): void {
    this.sessionIdsByRoomCode.clear();
    this.sessionsById.clear();
  }
}
