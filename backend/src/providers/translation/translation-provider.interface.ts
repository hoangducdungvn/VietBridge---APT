import { TranslationInput, TranslationResult } from './translation.types';

export interface TranslationProvider {
  translate(input: TranslationInput): Promise<TranslationResult>;
}
