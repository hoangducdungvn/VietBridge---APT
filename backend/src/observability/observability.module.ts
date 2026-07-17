import { Module } from '@nestjs/common';
import { StructuredLogger } from './structured-logger.service';

@Module({
  exports: [StructuredLogger],
  providers: [StructuredLogger],
})
export class ObservabilityModule {}
