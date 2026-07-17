export type LanguageCode = 'vi' | 'en' | string;

export type TranslationDirection = `${LanguageCode}-${LanguageCode}`;

export type StreamStatus = 'idle' | 'connecting' | 'listening' | 'translating' | 'error';
