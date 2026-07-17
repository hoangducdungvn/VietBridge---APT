import { Transform, type TransformFnParams } from 'class-transformer';
import { IsString, Matches } from 'class-validator';

export class SessionIdParamsDto {
  @Transform(normalizeSessionId)
  @IsString()
  @Matches(
    /^session_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  )
  sessionId!: string;
}

function normalizeSessionId({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}
