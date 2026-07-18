import { Injectable } from '@nestjs/common';
import type { Participant } from './participant.types';

@Injectable()
export class ParticipantStore {
  private readonly participantsById = new Map<string, Participant>();

  save(participant: Participant): void {
    this.participantsById.set(participant.participantId, participant);
  }

  findById(participantId: string): Participant | undefined {
    return this.participantsById.get(participantId);
  }

  findBySocketId(socketId: string): Participant | undefined {
    return Array.from(this.participantsById.values()).find(
      (participant) => participant.socketId === socketId,
    );
  }

  clear(): void {
    this.participantsById.clear();
  }
}
