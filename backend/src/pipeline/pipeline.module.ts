import { Module } from '@nestjs/common';
import { ParticipantsModule } from '../participants/participants.module';
import { SttModule } from '../providers/stt/stt.module';
import { TranslationModule } from '../providers/translation/translation.module';
import { SessionsModule } from '../sessions/sessions.module';
import { TurnsModule } from '../turns/turns.module';
import { PipelineService } from './pipeline.service';

@Module({
  exports: [PipelineService],
  imports: [
    ParticipantsModule,
    SessionsModule,
    SttModule,
    TranslationModule,
    TurnsModule,
  ],
  providers: [PipelineService],
})
export class PipelineModule {}
