import { Module } from '@nestjs/common';
import { ParticipantTokenService } from './participant-token.service';

@Module({
  exports: [ParticipantTokenService],
  providers: [ParticipantTokenService],
})
export class AuthModule {}
