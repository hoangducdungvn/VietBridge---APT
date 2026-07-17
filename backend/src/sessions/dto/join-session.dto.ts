import { Transform, type TransformFnParams } from 'class-transformer';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import type { LanguageCode } from '../../common/types/language-code.type';

export class JoinSessionDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  displayName!: string;

  @IsIn(['vi', 'en'])
  sourceLanguage!: LanguageCode;
}

function trimString({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}
