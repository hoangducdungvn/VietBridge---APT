import { Controller, Get } from '@nestjs/common';
import type { LobbyRoomResponse } from './session.types';
import { SessionsService } from './sessions.service';

@Controller('api/rooms')
export class LobbyRoomsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Get()
  getLobbyRooms(): LobbyRoomResponse[] {
    return this.sessionsService.getLobbyRooms();
  }
}
