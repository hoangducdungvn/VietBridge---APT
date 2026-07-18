import { Module } from '@nestjs/common';
import { SttModule } from '../providers/stt/stt.module';
import { TurnsModule } from '../turns/turns.module';
import { PipelineService } from './pipeline.service';

@Module({
  exports: [PipelineService],
  imports: [SttModule, TurnsModule],
  providers: [PipelineService],
})
export class PipelineModule {}
