import { Injectable } from '@nestjs/common';
import type { StoredTurn } from './turn.types';

@Injectable()
export class TurnStore {
  private readonly turnsById = new Map<string, StoredTurn>();

  save(turn: StoredTurn): void {
    this.turnsById.set(turn.turnId, turn);
  }

  findById(turnId: string): StoredTurn | undefined {
    return this.turnsById.get(turnId);
  }

  findCapturingByParticipant(
    sessionId: string,
    participantId: string,
  ): StoredTurn | undefined {
    return [...this.turnsById.values()].find(
      (turn) =>
        turn.sessionId === sessionId &&
        turn.participantId === participantId &&
        (turn.status === 'started' || turn.status === 'streaming'),
    );
  }

  findOpenByParticipant(
    sessionId: string,
    participantId: string,
  ): StoredTurn[] {
    return [...this.turnsById.values()].filter(
      (turn) =>
        turn.sessionId === sessionId &&
        turn.participantId === participantId &&
        (turn.status === 'started' ||
          turn.status === 'streaming' ||
          turn.status === 'processing'),
    );
  }

  getBufferedByteLength(turnId: string): number {
    return this.turnsById.get(turnId)?.audioBytes ?? 0;
  }

  deleteBySessionId(sessionId: string): string[] {
    const deletedTurnIds: string[] = [];
    for (const [turnId, turn] of this.turnsById) {
      if (turn.sessionId !== sessionId) continue;
      turn.audioChunks = [];
      turn.audioBytes = 0;
      this.turnsById.delete(turnId);
      deletedTurnIds.push(turnId);
    }
    return deletedTurnIds;
  }

  clear(): void {
    this.turnsById.clear();
  }
}
