import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiHttpException } from '../common/errors/api-http.exception';
import type { LanguageCode } from '../common/types/language-code.type';
import { ParticipantStore } from './participant.store';
import type { CreateParticipantInput, Participant } from './participant.types';

@Injectable()
export class ParticipantsService {
  constructor(private readonly participantStore: ParticipantStore) {}

  createParticipant(input: CreateParticipantInput): Participant {
    const now = Date.now();
    const participant: Participant = {
      connectionStatus: 'offline',
      displayName: input.displayName,
      joinedAt: now,
      lastSeenAt: now,
      participantId: `participant_${randomUUID()}`,
      role: input.role,
      sessionId: input.sessionId,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: getTargetLanguage(input.sourceLanguage),
    };

    this.participantStore.save(participant);
    return participant;
  }

  getRequiredParticipant(participantId: string): Participant {
    const participant = this.participantStore.findById(participantId);

    if (participant === undefined) {
      throw new ApiHttpException(
        HttpStatus.NOT_FOUND,
        'PARTICIPANT_NOT_FOUND',
        'The participant was not found.',
      );
    }

    return participant;
  }

  getRequiredParticipants(participantIds: readonly string[]): Participant[] {
    return participantIds.map((participantId) =>
      this.getRequiredParticipant(participantId),
    );
  }

  markOnline(participantId: string, socketId: string): Participant {
    const participant = this.getRequiredParticipant(participantId);
    participant.connectionStatus = 'online';
    participant.lastSeenAt = Date.now();
    participant.socketId = socketId;
    this.participantStore.save(participant);
    return participant;
  }

  markOfflineBySocketId(socketId: string): Participant | undefined {
    const participant = this.participantStore.findBySocketId(socketId);

    if (participant === undefined || participant.socketId !== socketId) {
      return undefined;
    }

    participant.connectionStatus = 'offline';
    participant.lastSeenAt = Date.now();
    delete participant.socketId;
    this.participantStore.save(participant);
    return participant;
  }
}

function getTargetLanguage(sourceLanguage: LanguageCode): LanguageCode {
  return sourceLanguage === 'vi' ? 'en' : 'vi';
}
