import { Module } from '@nestjs/common';
import { ObservabilityModule } from '../observability/observability.module';
import { ParticipantsModule } from '../participants/participants.module';
import { SessionsModule } from '../sessions/sessions.module';
import { TurnStore } from './turn.store';
import { TurnsService } from './turns.service';

@Module({
  exports: [TurnStore, TurnsService],
  imports: [ObservabilityModule, ParticipantsModule, SessionsModule],
  providers: [TurnStore, TurnsService],
})
export class TurnsModule {}
