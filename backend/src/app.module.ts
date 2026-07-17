import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { AudioModule } from './audio/audio.module';
import { AuthModule } from './auth/auth.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { ApplicationValidationPipe } from './common/validation/application-validation.pipe';
import { validateEnvironment } from './config/environment.validation';
import { ContextModule } from './context/context.module';
import { HealthModule } from './health/health.module';
import { MessagingModule } from './messaging/messaging.module';
import { ObservabilityModule } from './observability/observability.module';
import { ParticipantsModule } from './participants/participants.module';
import { PipelineModule } from './pipeline/pipeline.module';
import { SttModule } from './providers/stt/stt.module';
import { TranslationModule } from './providers/translation/translation.module';
import { RealtimeModule } from './realtime/realtime.module';
import { SessionsModule } from './sessions/sessions.module';
import { TurnsModule } from './turns/turns.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      validate: validateEnvironment,
    }),
    ObservabilityModule,
    HealthModule,
    AuthModule,
    SessionsModule,
    ParticipantsModule,
    RealtimeModule,
    TurnsModule,
    AudioModule,
    PipelineModule,
    SttModule,
    TranslationModule,
    ContextModule,
    MessagingModule,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useClass: ApplicationValidationPipe,
    },
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class AppModule {}
