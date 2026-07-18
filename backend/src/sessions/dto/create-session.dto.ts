import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { LanguageCode } from '../../common/types/language-code.type';

export class CreateSessionDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  displayName!: string;

  @IsOptional()
  @IsString()
  @Matches(/^APT00[1-5]$/)
  roomCode?: string;

  @IsIn(['vi', 'en'])
  sourceLanguage!: LanguageCode;
}

function trimString({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}
