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

  getRequiredParticipants(participantIds: readonly string[]): Participant[] {
    return participantIds.map((participantId) => {
      const participant = this.participantStore.findById(participantId);

      if (participant === undefined) {
        throw new ApiHttpException(
          HttpStatus.NOT_FOUND,
          'PARTICIPANT_NOT_FOUND',
          'The participant was not found.',
        );
      }

      return participant;
    });
  }
}

function getTargetLanguage(sourceLanguage: LanguageCode): LanguageCode {
  return sourceLanguage === 'vi' ? 'en' : 'vi';
}
