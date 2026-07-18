import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InMemoryRateLimitService } from '../common/rate-limit/in-memory-rate-limit.service';
import { ObservabilityModule } from '../observability/observability.module';
import { ParticipantsModule } from '../participants/participants.module';
import { SessionMutationRateLimitGuard } from './session-mutation-rate-limit.guard';
import { LobbyRoomsController } from './lobby-rooms.controller';
import { SessionStore } from './session.store';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

@Module({
  controllers: [LobbyRoomsController, SessionsController],
  exports: [SessionStore, SessionsService],
  imports: [AuthModule, ObservabilityModule, ParticipantsModule],
  providers: [
    InMemoryRateLimitService,
    SessionMutationRateLimitGuard,
    SessionStore,
    SessionsService,
  ],
})
export class SessionsModule {}
