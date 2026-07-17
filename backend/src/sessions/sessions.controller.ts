import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CreateSessionDto } from './dto/create-session.dto';
import { JoinSessionDto } from './dto/join-session.dto';
import { RoomCodeParamsDto } from './dto/room-code-params.dto';
import { SessionIdParamsDto } from './dto/session-id-params.dto';
import { SessionMutationRateLimitGuard } from './session-mutation-rate-limit.guard';
import type {
  CreateSessionResponse,
  EndSessionResponse,
  JoinSessionResponse,
  SessionStateResponse,
} from './session.types';
import { SessionsService } from './sessions.service';

@Controller('api/sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Post()
  @UseGuards(SessionMutationRateLimitGuard)
  createSession(@Body() input: CreateSessionDto): CreateSessionResponse {
    return this.sessionsService.createSession(input);
  }

  @Post(':roomCode/join')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionMutationRateLimitGuard)
  joinSession(
    @Param() params: RoomCodeParamsDto,
    @Body() input: JoinSessionDto,
  ): JoinSessionResponse {
    return this.sessionsService.joinSession(params.roomCode, input);
  }

  @Get(':roomCode')
  getSession(@Param() params: RoomCodeParamsDto): SessionStateResponse {
    return this.sessionsService.getSession(params.roomCode);
  }

  @Post(':sessionId/end')
  @HttpCode(HttpStatus.OK)
  endSession(@Param() params: SessionIdParamsDto): EndSessionResponse {
    return this.sessionsService.endSession(params.sessionId);
  }
}
