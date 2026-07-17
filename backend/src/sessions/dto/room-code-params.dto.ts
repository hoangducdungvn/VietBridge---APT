import { Transform, type TransformFnParams } from 'class-transformer';
import { IsString, Matches } from 'class-validator';

export class RoomCodeParamsDto {
  @Transform(normalizeRoomCode)
  @IsString()
  @Matches(/^APT[A-Z0-9]{3}$/)
  roomCode!: string;
}

function normalizeRoomCode({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim().toUpperCase() : value;
}
