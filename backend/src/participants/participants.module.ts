import { Module } from '@nestjs/common';
import { ParticipantStore } from './participant.store';
import { ParticipantsService } from './participants.service';

@Module({
  exports: [ParticipantStore, ParticipantsService],
  providers: [ParticipantStore, ParticipantsService],
})
export class ParticipantsModule {}
