export type LanguageCode = 'vi' | 'en';

export type TranslationDirection = `${LanguageCode}-${LanguageCode}`;

export type StreamStatus = 'idle' | 'connecting' | 'listening' | 'translating' | 'error';
