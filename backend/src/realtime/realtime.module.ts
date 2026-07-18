import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ObservabilityModule } from '../observability/observability.module';
import { ParticipantsModule } from '../participants/participants.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { SessionsModule } from '../sessions/sessions.module';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [
    AuthModule,
    ObservabilityModule,
    ParticipantsModule,
    PipelineModule,
    SessionsModule,
  ],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
